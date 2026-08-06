// Analyze all selected policy documents together and extract stable asset candidates.
//
// The PDFs are downloaded from the private policy-documents bucket and submitted
// unchanged to a server-side native document-analysis provider. Provider names,
// model identifiers, and file references are never returned to the client.
// Results are persisted in document_extraction_sessions, extracted_documents, and
// asset_candidates.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCandidateContext,
  buildCandidateIdentity,
  createNativeDocumentAnalyzer,
  KimiK3Provider,
  GeminiFlashLiteProvider,
  MemoryFileBytesLoader,
  sanitizeProviderError,
  ConfigAndConsentPrivacyPreparation,
  privacyPreparationConfigFromEnv,
  SupabaseAuthorizationStore,
  SupabaseFileLifecycleStore,
  buildMandateReviewSeeds,
  partitionDocumentDigests,
  parsePendingCandidateRecord,
  pendingRecordToEntityCandidate,
  mapResolutionStatus,
  occupancyForEntity,
  candidateDisplayLabel,
  isExactFingerprint,
  computeCanonicalFingerprint,
  buildExistingAssetReference,
  buildDraftDecisionPayload,
} from "../_shared/document-extraction.js";
import type {
  CandidateComparisonContext,
  CandidateIdentity,
  DetectedInsuranceEntity,
  ExistingHouseholdAsset,
  InsuranceDocumentAnalysisInput,
  PendingEntityCandidate,
  ProcessingConsentCheck,
  PublicDocumentError,
} from "./types.ts";

interface PendingCandidateRecord {
  id: string;
  asset_type: "vehicle" | "property";
  identity_fingerprint: string;
  display_label: string;
  session_id: string;
  source_document_ids: string[];
  draft_decision: string | null;
  draft_identity_confirmed: boolean | null;
  draft_existing_asset_id: string | null;
  draft_existing_asset_type: "vehicle" | "property" | null;
  approved_asset_id: string | null;
  approved_asset_type: "vehicle" | "property" | null;
  selected_facts_json: Record<string, unknown>;
  conflicts_json: unknown[];
  case_id: string | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(error: string | PublicDocumentError, status: number) {
  const body =
    typeof error === "string"
      ? { code: "DOCUMENT_PROCESSING_FAILED", message: error, retryable: false }
      : error;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isCleanupReadinessReady(): Promise<boolean> {
  // Always perform a live, authenticated health invocation of the cleanup worker.
  // A cached positive readiness result must never be the sole authorization for
  // raw external transmission.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return false;
  }

  try {
    const healthUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cleanup-provider-files`;
    const resp = await fetch(healthUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ health_check: true }),
    });
    if (!resp.ok) {
      return false;
    }
    const health = await resp.json();
    return (
      health.status === "ok" && health.provider_ready === true && health.readiness?.ready === true
    );
  } catch {
    return false;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // @ts-ignore: Deno's crypto.subtle.digest accepts Uint8Array views at runtime.
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function loadExistingAssets(
  admin: any,
  householdId: string,
): Promise<ExistingHouseholdAsset[]> {
  const { data: vehicles, error: vehicleErr } = await admin
    .from("vehicles")
    .select("id, year, make, model, vin")
    .eq("household_id", householdId);
  if (vehicleErr) throw new Error(vehicleErr.message);

  const { data: properties, error: propertyErr } = await admin
    .from("properties")
    .select("id, address_line1, city, province, postal_code, owner_occupied")
    .eq("household_id", householdId);
  if (propertyErr) throw new Error(propertyErr.message);

  const assets: ExistingHouseholdAsset[] = [];
  for (const v of vehicles ?? []) {
    const identity = {
      vin: typeof v.vin === "string" ? v.vin : null,
      year: typeof v.year === "number" ? v.year : null,
      make: typeof v.make === "string" ? v.make : null,
      model: typeof v.model === "string" ? v.model : null,
      trim: null,
    };
    const candidateIdentity = (await buildCandidateIdentity(
      identity,
      "vehicle",
    )) as CandidateIdentity;
    const fingerprint =
      candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;
    assets.push({
      id: String(v.id),
      assetType: "vehicle",
      identityFingerprint: fingerprint,
      displayLabel:
        [identity.year, identity.make, identity.model].filter(Boolean).join(" ") || undefined,
      candidateIdentity,
      identity,
    });
  }
  for (const p of properties ?? []) {
    const identity = {
      fullAddress: typeof p.address_line1 === "string" ? p.address_line1 : null,
      city: typeof p.city === "string" ? p.city : null,
      province: typeof p.province === "string" ? p.province : null,
      postalCode: typeof p.postal_code === "string" ? p.postal_code : null,
      occupancy: (p.owner_occupied === false ? "rental" : "principal_residence") as
        | "principal_residence"
        | "rental",
    };
    const candidateIdentity = (await buildCandidateIdentity(
      identity,
      "property",
    )) as CandidateIdentity;
    const fingerprint =
      candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;
    assets.push({
      id: String(p.id),
      assetType: "property",
      identityFingerprint: fingerprint,
      displayLabel: identity.fullAddress ?? undefined,
      candidateIdentity,
      identity,
    });
  }
  return assets;
}

async function loadPendingCandidateRecords(
  admin: any,
  householdId: string,
  excludeSessionId?: string,
): Promise<PendingCandidateRecord[]> {
  const query = admin
    .from("asset_candidates")
    .select(
      "id, asset_type, identity_fingerprint, display_label, session_id, source_document_ids, draft_decision, draft_identity_confirmed, draft_existing_asset_id, draft_existing_asset_type, approved_asset_id, approved_asset_type, selected_facts_json, conflicts_json",
    )
    .eq("household_id", householdId)
    .in("review_status", ["pending", "reviewing"])
    .in("decision", ["undecided", "not_sure"]);
  if (excludeSessionId) {
    query.neq("session_id", excludeSessionId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const records: PendingCandidateRecord[] = (data ?? ([] as unknown[])).map(
    (c: unknown) => parsePendingCandidateRecord(c) as PendingCandidateRecord,
  );
  if (records.length === 0) return [];

  const sessionIds = Array.from(new Set(records.map((r) => r.session_id).filter(Boolean)));
  const { data: sessions, error: sessionErr } = await admin
    .from("document_extraction_sessions")
    .select("id, case_id")
    .in("id", sessionIds);
  if (sessionErr) throw new Error(sessionErr.message);

  const caseBySession = new Map<string, string | null>();
  for (const session of sessions ?? []) {
    caseBySession.set(String(session.id), session.case_id ? String(session.case_id) : null);
  }
  for (const record of records) {
    record.case_id = caseBySession.get(record.session_id) ?? null;
  }
  return records;
}

async function loadPendingCandidates(
  admin: any,
  householdId: string,
  excludeSessionId?: string,
): Promise<PendingEntityCandidate[]> {
  const records = await loadPendingCandidateRecords(admin, householdId, excludeSessionId);
  return records.map((r) => pendingRecordToEntityCandidate(r) as PendingEntityCandidate);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const householdId = body.household_id as string | undefined;
  const batchIdRaw = body.batch_id as string | undefined;
  let sessionIdRaw = body.session_id as string | undefined;
  const rawDocIds = body.policy_document_ids ?? [body.policy_document_id];

  if (!householdId || !isUuid(householdId)) {
    return jsonError("Missing or invalid household_id", 400);
  }
  if (sessionIdRaw && !isUuid(sessionIdRaw)) {
    return jsonError("Invalid session_id", 400);
  }
  if (batchIdRaw && !isUuid(batchIdRaw)) {
    return jsonError("Invalid batch_id", 400);
  }

  let policyDocumentIds: string[] = [];
  if (batchIdRaw) {
    policyDocumentIds = [];
  } else if (Array.isArray(rawDocIds)) {
    policyDocumentIds = rawDocIds.filter(
      (id): id is string => typeof id === "string" && isUuid(id),
    );
  } else if (typeof rawDocIds === "string" && isUuid(rawDocIds)) {
    policyDocumentIds = [rawDocIds];
  } else {
    return jsonError("Missing or invalid policy_document_ids", 400);
  }
  if (!batchIdRaw && policyDocumentIds.length === 0) {
    return jsonError("At least one policy_document_id is required", 400);
  }

  const { data: household, error: householdErr } = await supabase
    .from("households")
    .select("id, owner_profile_id")
    .eq("id", householdId)
    .maybeSingle();
  if (householdErr || !household) {
    return jsonError("Household not found", 404);
  }

  const isHouseholdActor =
    household.owner_profile_id === user.id ||
    (await supabase
      .from("household_members")
      .select("id")
      .eq("household_id", householdId)
      .eq("profile_id", user.id)
      .maybeSingle()
      .then((r) => !!r.data));
  if (!isHouseholdActor) {
    return jsonError("Household access denied", 403);
  }

  let batch: Record<string, any> | null = null;
  let currentCaseId: string | null = null;
  if (batchIdRaw) {
    const { data: batchRow, error: batchError } = await admin
      .from("document_processing_batches")
      .select("*")
      .eq("id", batchIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (batchError || !batchRow) return jsonError("Document batch not found", 404);
    if (batchRow.mode_snapshot !== "dangerous") {
      return jsonError("Automatic processing is not enabled for this batch", 403);
    }
    if (
      !["queued", "processing_unavailable", "reading_policy_documents"].includes(
        String(batchRow.status),
      )
    ) {
      if (batchRow.status === "ready_for_review") {
        return jsonResponse({ batch_id: batchIdRaw, status: "ready_for_review" });
      }
      return jsonError("Document batch is not available for processing", 409);
    }

    const { data: batchItems, error: itemError } = await admin
      .from("document_processing_batch_items")
      .select("policy_document_id")
      .eq("batch_id", batchIdRaw);
    if (itemError) return jsonError("Failed to load document batch", 500);
    policyDocumentIds = Array.from(
      new Set(
        (batchItems ?? []).map((item: { policy_document_id: string }) =>
          String(item.policy_document_id),
        ),
      ),
    );
    if (policyDocumentIds.length === 0) return jsonError("Document batch is empty", 400);
    sessionIdRaw = String(batchRow.session_id);
    currentCaseId = batchRow.case_id ?? null;
    batch = batchRow as Record<string, any>;

    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_document_processing_batch_v1",
      {
        p_batch_id: batchIdRaw,
        p_household_id: householdId,
        p_lease_seconds: 3600,
      },
    );
    if (claimError) return jsonError("Failed to claim document processing batch", 500);
    if (claimed !== true) {
      return jsonResponse({ batch_id: batchIdRaw, status: "reading_policy_documents" }, 202);
    }
  }

  const { data: currentSetting } = await admin
    .from("household_document_processing_settings")
    .select(
      "dangerous_mode_enabled, setting_version, disclosure_version, configured_provider, configured_model_id",
    )
    .eq("household_id", householdId)
    .maybeSingle();
  if (currentSetting?.dangerous_mode_enabled !== true) {
    if (batchIdRaw) {
      await admin
        .from("document_processing_batches")
        .update({
          status: "processing_unavailable",
          retryable: false,
          error_code: "DOCUMENT_PROCESSING_AUTHORIZATION_REQUIRED",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchIdRaw);
    }
    return jsonError("Automatic document processing is not enabled", 403);
  }

  const configuredProvider = String(
    batch?.configured_provider ??
      currentSetting?.configured_provider ??
      Deno.env.get("CONFIGURED_PROVIDER") ??
      "gemini",
  ).toLowerCase();
  const configuredModelId = String(
    batch?.configured_model_id ??
      currentSetting?.configured_model_id ??
      Deno.env.get("DOCUMENT_MODEL_PRIMARY") ??
      Deno.env.get("GEMINI_MODEL_ID") ??
      Deno.env.get("KIMI_MODEL_ID") ??
      "",
  );
  const isGemini =
    configuredProvider.includes("gemini") ||
    configuredProvider.includes("google") ||
    configuredModelId.toLowerCase().includes("gemini") ||
    configuredModelId.toLowerCase().includes("flash");

  const { data: docRows, error: docsErr } = await supabase
    .from("policy_documents")
    .select("id, storage_path, file_name, mime_type, size_bytes, household_id, content_sha256")
    .in("id", policyDocumentIds)
    .eq("household_id", householdId);
  if (docsErr) {
    return jsonError("Failed to load policy documents", 500);
  }
  if (!docRows || docRows.length !== policyDocumentIds.length) {
    return jsonError("One or more policy documents not found", 404);
  }

  // Download PDF bytes and compute digests for all requested documents.
  const bytesByReference: Record<string, Uint8Array> = {};
  const digestByDocId: Record<string, string> = {};
  const filenameByDocId: Record<string, string> = {};
  const mimeTypeByDocId: Record<string, string> = {};
  const sizeByDocId: Record<string, number> = {};
  for (const docRow of docRows) {
    const { data: fileData, error: downloadErr } = await admin.storage
      .from("policy-documents")
      .download(docRow.storage_path);
    if (downloadErr || !fileData) {
      return jsonError("Failed to download document", 502);
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const digest = await sha256Hex(bytes);
    if (docRow.content_sha256 !== digest) {
      return jsonError("Document integrity verification failed", 409);
    }
    bytesByReference[docRow.id] = bytes;
    digestByDocId[docRow.id] = digest;
    filenameByDocId[docRow.id] = docRow.file_name ?? docRow.id;
    mimeTypeByDocId[docRow.id] = docRow.mime_type ?? "application/octet-stream";
    sizeByDocId[docRow.id] = Number(docRow.size_bytes ?? 0);
  }

  // Check for existing extracted documents by digest to avoid re-parsing duplicates.
  const { data: existingExtractedDocs } = await admin
    .from("extracted_documents")
    .select("id, file_digest, session_id, policy_document_id")
    .eq("household_id", householdId)
    .in("file_digest", Object.values(digestByDocId));

  const existingByDigest = new Map<string, { id: string; session_id: string }>();
  const extractedIdsByDigest = new Map<string, Set<string>>();
  const sessionIdsForDuplicates = new Set<string>();
  for (const row of existingExtractedDocs ?? []) {
    const digest = String(row.file_digest);
    const extractedId = String(row.id);
    const sessionId = String(row.session_id);
    sessionIdsForDuplicates.add(sessionId);
    const ids = extractedIdsByDigest.get(digest) ?? new Set<string>();
    ids.add(extractedId);
    extractedIdsByDigest.set(digest, ids);
    if (!existingByDigest.has(digest)) {
      existingByDigest.set(digest, { id: extractedId, session_id: sessionId });
    }
  }

  const { duplicateDocumentIds: duplicatedDocIds, newDocumentIds: newDocIds } =
    partitionDocumentDigests(policyDocumentIds, digestByDocId, new Set(existingByDigest.keys()));

  const uploadedDocuments: InsuranceDocumentAnalysisInput["uploadedDocuments"] = newDocIds.map(
    (id) => ({
      documentId: id,
      filename: filenameByDocId[id],
      mimeType: mimeTypeByDocId[id],
      fileReference: id,
    }),
  );

  // If every document is a duplicate, return the existing sessions and candidates.
  if (newDocIds.length === 0) {
    let duplicateSessionId = batchIdRaw ? undefined : sessionIdRaw;
    if (duplicateSessionId) {
      const { data: session } = await admin
        .from("document_extraction_sessions")
        .select("id")
        .eq("id", duplicateSessionId)
        .eq("household_id", householdId)
        .maybeSingle();
      if (!session) {
        return jsonError("Session not found", 404);
      }
    } else if (sessionIdsForDuplicates.size > 0) {
      duplicateSessionId = Array.from(sessionIdsForDuplicates)[0];
    }
    if (!duplicateSessionId || sessionIdsForDuplicates.size === 0) {
      return jsonError("No existing session found for duplicate documents", 404);
    }

    const requestedExtractedIds = new Set<string>();
    for (const id of duplicatedDocIds) {
      const digest = digestByDocId[id];
      for (const extractedId of extractedIdsByDigest.get(digest) ?? []) {
        requestedExtractedIds.add(extractedId);
      }
    }

    const { data: existingCandidates } = await admin
      .from("asset_candidates")
      .select(
        "id, session_id, asset_type, identity_fingerprint, display_label, occupancy, match_classification, decision, review_status, source_document_ids",
      )
      .in("session_id", Array.from(sessionIdsForDuplicates))
      .eq("household_id", householdId);

    const overlappingCandidates = (existingCandidates ?? []).filter((c) => {
      const sources = Array.isArray(c.source_document_ids)
        ? (c.source_document_ids as string[])
        : [];
      return sources.some((sid) => requestedExtractedIds.has(String(sid)));
    });

    const reusableSessionId =
      overlappingCandidates.find((candidate) => candidate.session_id)?.session_id ??
      (sessionIdsForDuplicates.size === 1 ? duplicateSessionId : null);

    if (batchIdRaw) {
      await admin
        .from("document_processing_batches")
        .update({
          ...(reusableSessionId ? { session_id: reusableSessionId } : {}),
          status: "ready_for_review",
          retryable: false,
          completed_at: new Date().toISOString(),
          worker_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchIdRaw);
    }
    return jsonResponse({
      batch_id: batchIdRaw ?? null,
      session_id: reusableSessionId,
      session_ids: Array.from(sessionIdsForDuplicates),
      extracted_document_ids: duplicatedDocIds.map(
        (id) => existingByDigest.get(digestByDocId[id])!.id,
      ),
      duplicate: true,
      candidates: overlappingCandidates,
    });
  }

  const privacyConfig = privacyPreparationConfigFromEnv(Deno.env.get);
  if (batch?.disclosure_version) {
    privacyConfig.privacyNoticeVersion = String(batch.disclosure_version);
  }
  let consentQuery = admin
    .from("document_processing_consent")
    .select(
      "id, household_id, profile_id, purpose, privacy_notice_version, foreign_processing_acknowledged, automated_processing_acknowledged, processor_contract_version, raw_processing_approved, withdrawn_at",
    )
    .eq("household_id", householdId)
    .eq("purpose", "insurance_policy_extraction")
    .order("consented_at", { ascending: false });
  if (batch?.consent_id) {
    // A later enable event may supersede this immutable batch snapshot. That
    // must not corrupt in-flight work; an explicit disable is still caught by
    // the live setting check immediately before every transmission.
    consentQuery = consentQuery
      .eq("id", String(batch.consent_id))
      .in("status", ["active", "superseded"]);
  } else {
    consentQuery = consentQuery.eq("profile_id", user.id).eq("status", "active");
  }
  const { data: consentRows, error: consentErr } = await consentQuery.limit(1);

  if (consentErr) {
    return jsonError("Failed to verify document processing consent", 500);
  }

  const consent: ProcessingConsentCheck | undefined =
    consentRows && consentRows.length > 0
      ? {
          id: consentRows[0].id ? String(consentRows[0].id) : undefined,
          householdId: String(consentRows[0].household_id),
          profileId: consentRows[0].profile_id ? String(consentRows[0].profile_id) : undefined,
          purpose: String(consentRows[0].purpose),
          privacyNoticeVersion: String(consentRows[0].privacy_notice_version),
          processorContractVersion: String(consentRows[0].processor_contract_version),
          foreignProcessingAcknowledged: Boolean(consentRows[0].foreign_processing_acknowledged),
          automatedProcessingAcknowledged: Boolean(
            consentRows[0].automated_processing_acknowledged,
          ),
          rawProcessingApproved: Boolean(consentRows[0].raw_processing_approved),
          withdrawnAt: consentRows[0].withdrawn_at ? String(consentRows[0].withdrawn_at) : null,
        }
      : undefined;

  if (batch && consent) {
    // Preserve the consent/processor contract snapshot for this batch. Future
    // settings use newer consent without silently changing in-flight terms.
    privacyConfig.privacyNoticeVersion = consent.privacyNoticeVersion;
    privacyConfig.processorContractVersion = consent.processorContractVersion;
  }

  const prep = new ConfigAndConsentPrivacyPreparation(
    {
      ...privacyConfig,
      cleanupReadinessCheck: isGemini ? undefined : async () => isCleanupReadinessReady(),
    },
    consent,
  );
  const authorizationStore = new SupabaseAuthorizationStore(admin);
  let authorization;
  try {
    for (const uploaded of uploadedDocuments) {
      const bytes = bytesByReference[uploaded.documentId];
      await prep.prepare({
        documentId: uploaded.documentId,
        filename: uploaded.filename,
        mimeType: uploaded.mimeType,
        bytes,
      });
    }
    authorization = await prep.authorize(user.id, authorizationStore);
  } catch (err) {
    console.error("EXTRACT-PRE-AUTH-ERROR", err);
    const sanitized = sanitizeProviderError(err) as PublicDocumentError;
    if (batchIdRaw) {
      await admin
        .from("document_processing_batches")
        .update({
          status: "processing_unavailable",
          retryable: false,
          error_code: sanitized.code,
          completed_at: new Date().toISOString(),
          worker_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchIdRaw);
    }
    return jsonError(sanitized, 403);
  }

  const analysisRunId = crypto.randomUUID();
  await authorizationStore.updateAuthorization(authorization.id, {
    analysisRequestId: analysisRunId,
    authorizationResult: "processing_started",
  });
  if (batchIdRaw) {
    await admin
      .from("document_processing_batches")
      .update({
        authorization_id: authorization.id,
        consent_id: consent?.id ?? batch?.consent_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchIdRaw);
  }

  let sessionId = sessionIdRaw;
  if (!sessionId) {
    const { data: session, error: sessionErr } = await admin
      .from("document_extraction_sessions")
      .insert({ household_id: householdId, status: "open", created_by: user.id })
      .select()
      .single();
    if (sessionErr || !session) {
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: "authorized_no_transmission",
      });
      return jsonError("Failed to create extraction session", 500);
    }
    sessionId = session.id;
  } else {
    const { data: session } = await supabase
      .from("document_extraction_sessions")
      .select("id, case_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) {
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: "authorized_no_transmission",
      });
      return jsonError("Session not found", 404);
    }
    currentCaseId = session.case_id ?? null;
  }

  const [existingAssets, pendingCandidates] = await Promise.all([
    loadExistingAssets(admin, householdId),
    loadPendingCandidates(admin, householdId, sessionId),
  ]);

  const fileLifecycleStore = new SupabaseFileLifecycleStore(admin);
  let provider: InstanceType<typeof KimiK3Provider> | InstanceType<typeof GeminiFlashLiteProvider>;

  if (isGemini) {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey || !configuredModelId) {
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: "authorized_no_transmission",
      });
      if (batchIdRaw) {
        await admin
          .from("document_processing_batches")
          .update({
            status: "processing_unavailable",
            retryable: false,
            error_code: "DOCUMENT_MODEL_UNAVAILABLE",
            completed_at: new Date().toISOString(),
            worker_lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchIdRaw);
      }
      return jsonError(
        sanitizeProviderError(
          new Error("Gemini document analysis service is not configured"),
        ) as PublicDocumentError,
        503,
      );
    }
    provider = new GeminiFlashLiteProvider({
      apiKey: geminiApiKey,
      baseUrl: Deno.env.get("GEMINI_API_BASE_URL") ?? undefined,
      requestedModel: configuredModelId,
    });
  } else {
    const kimiApiKey = Deno.env.get("KIMI_K3_API_KEY");
    if (!kimiApiKey || !configuredModelId || !configuredModelId.toLowerCase().includes("kimi-k3")) {
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: "authorized_no_transmission",
      });
      if (batchIdRaw) {
        await admin
          .from("document_processing_batches")
          .update({
            status: "processing_unavailable",
            retryable: false,
            error_code: "DOCUMENT_MODEL_UNAVAILABLE",
            completed_at: new Date().toISOString(),
            worker_lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchIdRaw);
      }
      return jsonError(
        sanitizeProviderError(
          new Error("Document analysis service is not configured"),
        ) as PublicDocumentError,
        503,
      );
    }
    provider = new KimiK3Provider({
      apiKey: kimiApiKey,
      baseUrl: Deno.env.get("KIMI_API_BASE_URL") ?? undefined,
      requestedModel: configuredModelId,
    });
  }
  const analyzer = createNativeDocumentAnalyzer({
    provider,
    bytesLoader: new MemoryFileBytesLoader(bytesByReference),
    requireNativeInput: Deno.env.get("DOCUMENT_ANALYSIS_REQUIRE_NATIVE_INPUT") !== "false",
    authorization,
    fileLifecycleStore,
    analysisRequestId: analysisRunId,
    preTransmissionCheck: async () => {
      const [{ data: liveSetting }, { data: liveConsent }, { data: liveAuthorization }] =
        await Promise.all([
          admin
            .from("household_document_processing_settings")
            .select("dangerous_mode_enabled")
            .eq("household_id", householdId)
            .maybeSingle(),
          admin
            .from("document_processing_consent")
            .select(
              "id, status, withdrawn_at, privacy_notice_version, processor_contract_version, foreign_processing_acknowledged, automated_processing_acknowledged, raw_processing_approved",
            )
            .eq("id", consent?.id ?? "00000000-0000-0000-0000-000000000000")
            .eq("household_id", householdId)
            .maybeSingle(),
          admin
            .from("document_processing_authorizations")
            .select("id, authorization_result, consent_id, household_id")
            .eq("id", authorization.id)
            .eq("household_id", householdId)
            .maybeSingle(),
        ]);
      const consentIsCurrent =
        liveConsent !== null &&
        ["active", "superseded"].includes(String(liveConsent?.status ?? "")) &&
        !liveConsent.withdrawn_at &&
        liveConsent.privacy_notice_version === consent?.privacyNoticeVersion &&
        liveConsent.processor_contract_version === consent?.processorContractVersion &&
        liveConsent.foreign_processing_acknowledged === true &&
        liveConsent.automated_processing_acknowledged === true &&
        liveConsent.raw_processing_approved === true;
      const authorizationIsCurrent =
        liveAuthorization?.consent_id === consent?.id &&
        ["authorized", "processing_started"].includes(
          String(liveAuthorization?.authorization_result ?? ""),
        );
      if (
        liveSetting?.dangerous_mode_enabled !== true ||
        !consentIsCurrent ||
        !authorizationIsCurrent
      ) {
        throw new Error("Document processing authorization is no longer valid");
      }
    },
  });

  const work = async (): Promise<Response> => {
    let analysis: any;
    try {
      if (batchIdRaw) {
        await admin
          .from("document_processing_batches")
          .update({ status: "comparing_policies", updated_at: new Date().toISOString() })
          .eq("id", batchIdRaw);
      }
      analysis = (await analyzer.analyze({
        householdId,
        uploadedDocuments,
        existingAssets,
        pendingCandidates,
        priorDocumentSummaries: [],
        jurisdiction: "AB",
      })) as any;
    } catch (err) {
      console.error("EXTRACT-ANALYZE-ERROR", err);
      const sanitized = sanitizeProviderError(err) as PublicDocumentError;
      const isUnsupported = sanitized.code === "DOCUMENT_FILE_UNSUPPORTED";
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: isUnsupported ? "blocked_no_transmission" : "processing_failed",
      });
      if (batchIdRaw) {
        const { count: transmissionClaims } = await admin
          .from("document_analysis_provider_files")
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", analysisRunId);
        const retryable = Number(transmissionClaims ?? 0) === 0;
        await admin
          .from("document_processing_batches")
          .update({
            status: "processing_unavailable",
            retryable,
            next_retry_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
            error_code: sanitized.code,
            completed_at: new Date().toISOString(),
            worker_lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchIdRaw);
      }
      return jsonError(sanitized, 502);
    }

    if (batchIdRaw) {
      await admin
        .from("document_processing_batches")
        .update({ status: "validating_extracted_details", updated_at: new Date().toISOString() })
        .eq("id", batchIdRaw);
    }

    // Build the analysis-run payload. A single RPC call will persist the run,
    // extracted documents, and candidate upserts atomically.
    const validatedOutput = { ...analysis };
    delete (validatedOutput as Record<string, unknown>).rawResponse;

    const analysisJson = {
      modelProvider: analysis.modelProvider,
      modelId: analysis.modelId,
      attemptedModelProvider: analysis.attemptedModelProvider,
      attemptedModelId: analysis.attemptedModelId,
      fallbackReason: analysis.fallbackReason,
      promptVersion: analysis.promptVersion ?? "1.0.0",
      outputSchemaVersion: analysis.outputSchemaVersion ?? "1.0.0",
      attemptCount: analysis.attemptCount ?? 1,
      validatedOutput,
      warnings: analysis.warnings,
      providerMetadata: analysis.providerMetadata,
    };

    const documentsJson: unknown[] = [];

    // Prepare extracted document rows with pre-generated UUIDs. The single persistence
    // RPC will insert them atomically.
    const extractedDocRows: { id: string; policy_document_id: string }[] = [];
    const extractedDocIdByInputId = new Map<string, string>();
    for (const analyzedDoc of analysis.documents) {
      const docId = analyzedDoc.documentId;
      const extractedId = crypto.randomUUID();

      documentsJson.push({
        id: extractedId,
        policy_document_id: docId,
        file_digest: analyzedDoc.fileDigest,
        page_count: analyzedDoc.pageCount,
        classification: analyzedDoc.classification,
        parser_id: analyzedDoc.parserId,
        parser_version: analyzedDoc.parserVersion,
        pages_json: [],
      });
      extractedDocRows.push({ id: extractedId, policy_document_id: docId });
      extractedDocIdByInputId.set(docId, extractedId);
    }

    // Prepare household-wide lookup tables for canonical identity resolution.
    // Candidates are scoped to their optimization case; a later session in a different
    // case must create a new case-local candidate even if the canonical identity matches.
    const allPendingRecords = await loadPendingCandidateRecords(admin, householdId);
    const existingById = new Map<string, ExistingHouseholdAsset>();
    for (const asset of existingAssets) {
      existingById.set(asset.id, asset);
    }
    const pendingById = new Map<string, PendingCandidateRecord>();
    const candidateByCaseFingerprint = new Map<string, PendingCandidateRecord>();
    for (const record of allPendingRecords) {
      pendingById.set(record.id, record);
      const caseKey = `${record.case_id ?? "null"}:${record.identity_fingerprint}`;
      candidateByCaseFingerprint.set(caseKey, record);
    }
    const pendingCandidateById = new Map<string, PendingEntityCandidate>();
    for (const candidate of pendingCandidates) {
      pendingCandidateById.set(candidate.id, candidate);
    }

    // Group detected entities by canonical identity fingerprint and merge source documents.
    const canonicalGroups = new Map<
      string,
      {
        fingerprint: string;
        entityType: "property" | "vehicle";
        entities: DetectedInsuranceEntity[];
        sourceDocIds: Set<string>;
        conflicts: {
          fieldPath: string;
          entityRef: string;
          assertionIds: string[];
          explanation: string;
          requiresHumanResolution: boolean;
        }[];
        resolution: DetectedInsuranceEntity["resolution"];
      }
    >();

    for (const entity of analysis.detectedEntities) {
      // Validate the LLM resolution against supplied context; downgrade on mismatch.
      let resolution = entity.resolution;
      const matchedExisting = resolution.matchedExistingEntityId
        ? existingById.get(resolution.matchedExistingEntityId)
        : undefined;
      const matchedPending = resolution.matchedPendingCandidateId
        ? pendingById.get(resolution.matchedPendingCandidateId)
        : undefined;

      if (resolution.status === "matches_existing" && !matchedExisting) {
        resolution = {
          status: "new",
          confidence: 0,
          reasoning: "Matched existing asset not found in household",
        };
      } else if (resolution.status === "matches_pending_candidate" && !matchedPending) {
        resolution = {
          status: "new",
          confidence: 0,
          reasoning: "Matched pending candidate not found in household",
        };
      } else if (
        resolution.status === "matches_existing" &&
        matchedExisting &&
        matchedExisting.assetType !== entity.entityType
      ) {
        resolution = {
          status: "possible_match_requires_confirmation",
          confidence: 0,
          reasoning: "Asset type mismatch with matched existing asset",
        };
      } else if (
        resolution.status === "matches_pending_candidate" &&
        matchedPending &&
        matchedPending.asset_type !== entity.entityType
      ) {
        resolution = {
          status: "possible_match_requires_confirmation",
          confidence: 0,
          reasoning: "Asset type mismatch with matched pending candidate",
        };
      }

      // The analyzer already derives canonical identity from VIN/address and applies the
      // resolution result. For matches, merge into the matched asset/candidate fingerprint
      // (upgrading to an exact fingerprint if this document provides one).
      let fingerprint = computeCanonicalFingerprint(entity);
      if (resolution.status === "matches_existing" && matchedExisting) {
        fingerprint =
          isExactFingerprint(fingerprint) &&
          !isExactFingerprint(matchedExisting.identityFingerprint)
            ? fingerprint
            : matchedExisting.identityFingerprint;
      } else if (resolution.status === "matches_pending_candidate" && matchedPending) {
        fingerprint =
          isExactFingerprint(fingerprint) &&
          !isExactFingerprint(matchedPending.identity_fingerprint)
            ? fingerprint
            : matchedPending.identity_fingerprint;
      }

      let group = canonicalGroups.get(fingerprint);
      if (!group) {
        group = {
          fingerprint,
          entityType: entity.entityType,
          entities: [],
          sourceDocIds: new Set(),
          conflicts: [],
          resolution,
        };
        canonicalGroups.set(fingerprint, group);
      }

      group.entities.push(entity);
      for (const ref of entity.evidence) {
        const extractedId = extractedDocIdByInputId.get(ref.documentId);
        if (extractedId) group.sourceDocIds.add(extractedId);
      }
      for (const cv of Object.values(entity.currentCoverage) as any[]) {
        for (const ref of cv.evidence ?? []) {
          const extractedId = extractedDocIdByInputId.get(ref.documentId);
          if (extractedId) group.sourceDocIds.add(extractedId);
        }
      }
      for (const conflict of analysis.unresolvedConflicts) {
        if (conflict.entityRef === entity.temporaryId) {
          group.conflicts.push(conflict);
        }
      }

      // Prefer existing-asset matches, then pending-candidate matches, then the first seen resolution.
      const isBetterMatch =
        resolution.status === "matches_existing" ||
        (resolution.status === "matches_pending_candidate" &&
          group.resolution.status !== "matches_existing");
      if (isBetterMatch) {
        group.resolution = resolution;
      }
    }

    // Build candidate payloads with pre-generated UUIDs. Existing candidates reuse
    // their database id so the RPC can upsert them by primary key.
    const candidatesJson: unknown[] = [];
    for (const group of canonicalGroups.values()) {
      const representative = group.entities[0];
      const displayLabel =
        group.entities.find((e) => e.displayLabel && e.displayLabel.trim().length > 0)
          ?.displayLabel ?? candidateDisplayLabel(representative);
      const occupancy =
        group.entities.map(occupancyForEntity).find((o) => o) ?? occupancyForEntity(representative);

      const matchedPendingId =
        (group.resolution.status === "matches_pending_candidate" ||
          group.resolution.status === "possible_match_requires_confirmation") &&
        group.resolution.matchedPendingCandidateId
          ? group.resolution.matchedPendingCandidateId
          : undefined;

      const matchedPendingRecord = matchedPendingId
        ? pendingCandidateById.get(matchedPendingId)
        : undefined;

      // A candidate may only be reused within the same optimization case. If the matched
      // pending candidate belongs to a different case we preserve its lineage in the
      // draft payload but create a new case-local row.
      const sameCaseMatchedPending =
        matchedPendingId && pendingById.get(matchedPendingId)?.case_id === currentCaseId
          ? pendingById.get(matchedPendingId)
          : undefined;
      const sameCaseFingerprintCandidate = candidateByCaseFingerprint.get(
        `${currentCaseId ?? "null"}:${group.fingerprint}`,
      );
      const existingCandidate = sameCaseMatchedPending ?? sameCaseFingerprintCandidate ?? undefined;

      const mergedSourceDocIds = new Set<string>(existingCandidate?.source_document_ids ?? []);
      for (const id of group.sourceDocIds) mergedSourceDocIds.add(id);

      const matchedExistingAsset =
        group.resolution.matchedExistingEntityId &&
        group.resolution.status !== "matches_pending_candidate"
          ? existingById.get(group.resolution.matchedExistingEntityId)
          : undefined;

      const identityStrength = representative.candidateIdentity?.identityStrength;
      const draftPayload = buildDraftDecisionPayload(
        existingById,
        group.resolution.status,
        matchedExistingAsset,
        matchedPendingRecord,
        identityStrength,
      );

      const selectedFacts = {
        canonicalFingerprint: group.fingerprint,
        entities: group.entities.map((e) => e.temporaryId),
        sourceDocuments: Array.from(mergedSourceDocIds),
        resolution: group.resolution,
        identity: representative.identity,
        candidateIdentity: representative.candidateIdentity,
        ...draftPayload,
        currentPolicy: representative.currentPolicy,
        currentCoverage: representative.currentCoverage,
        mandateSuggestions: representative.mandateSuggestions,
      };

      const candidateId = existingCandidate ? existingCandidate.id : crypto.randomUUID();
      candidatesJson.push({
        id: candidateId,
        asset_type: group.entityType,
        identity_fingerprint: group.fingerprint,
        display_label: displayLabel,
        occupancy,
        match_classification: mapResolutionStatus({
          ...representative,
          resolution: group.resolution,
        } as DetectedInsuranceEntity),
        decision: "undecided",
        review_status: "pending",
        draft_decision: draftPayload._draftDecision ?? "approve_new",
        draft_identity_confirmed:
          draftPayload._draftIdentityConfirmed ?? identityStrength === "exact",
        draft_existing_asset_id: draftPayload._draftExistingAssetId || null,
        draft_existing_asset_type: draftPayload._draftExistingAssetType || null,
        source_document_ids: Array.from(mergedSourceDocIds),
        selected_facts_json: selectedFacts,
        conflicts_json: group.conflicts,
      });

      if (existingCandidate) {
        const caseKey = `${currentCaseId ?? "null"}:${group.fingerprint}`;
        candidateByCaseFingerprint.set(caseKey, {
          ...existingCandidate,
          source_document_ids: Array.from(mergedSourceDocIds),
          selected_facts_json: selectedFacts,
        });
      }
    }

    const reviewSeeds = batchIdRaw
      ? buildMandateReviewSeeds(
          candidatesJson as {
            id: string;
            asset_type: "vehicle" | "property";
            selected_facts_json: Record<string, unknown>;
            conflicts_json?: unknown[];
          }[],
        )
      : [];
    const reviewsJson = reviewSeeds.map((seed) => ({
      candidate_id: seed.candidateId,
      field_path: seed.fieldPath,
      value_state: seed.valueState,
      specification_title: seed.specificationTitle,
      mandate_path: seed.mandatePath,
      original_extracted_value: seed.originalExtractedValue,
      document_implied_value: seed.documentImpliedValue,
      document_implied_mandate_value: seed.documentImpliedMandateValue,
      source_document_id: seed.sourceDocumentId ?? null,
      source_page_number: seed.sourcePageNumber ?? null,
      source_section: seed.sourceSection ?? null,
      confidence: seed.confidence ?? null,
      conflict_values_json: seed.conflictValues.map((value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const sourceDocumentId = (value as Record<string, unknown>).sourceDocumentId;
        return {
          ...value,
          sourceFileName:
            typeof sourceDocumentId === "string" ? filenameByDocId[sourceDocumentId] : undefined,
        };
      }),
      material_conflict: seed.materialConflict,
    }));

    // Generate a deterministic client request id so retries return the same result.
    const requestIdPayload = new TextEncoder().encode(
      [householdId, sessionId, ...Object.values(digestByDocId).sort()].join("|"),
    );
    const clientRequestId = await sha256Hex(requestIdPayload);

    const persistenceArgs = {
      p_household_id: householdId,
      p_session_id: sessionId,
      p_client_request_id: clientRequestId,
      p_analysis_run_id: analysisRunId,
      p_analysis_json: analysisJson,
      p_documents_json: documentsJson,
      p_candidates_json: candidatesJson,
      p_authorization_id: authorization.id,
      p_consent_id: consent?.id,
    };
    const { data: persistResult, error: persistErr } = batchIdRaw
      ? await admin.rpc("persist_document_batch_analysis_v1", {
          ...persistenceArgs,
          p_batch_id: batchIdRaw,
          p_reviews_json: reviewsJson,
        })
      : await admin.rpc("persist_document_analysis_v1", persistenceArgs);
    if (persistErr || !persistResult) {
      await authorizationStore.updateAuthorization(authorization.id, {
        authorizationResult: "processing_failed",
      });
      if (batchIdRaw) {
        await admin
          .from("document_processing_batches")
          .update({
            status: "processing_unavailable",
            retryable: false,
            next_retry_at: null,
            error_code: "DOCUMENT_PERSISTENCE_FAILED",
            completed_at: new Date().toISOString(),
            worker_lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchIdRaw);
      }
      return jsonError("Failed to persist analysis", 500);
    }

    await authorizationStore.updateAuthorization(authorization.id, {
      authorizationResult: "analysis_persisted",
    });

    const customerBatchStatus =
      candidatesJson.length > 0 ? "ready_for_review" : "additional_information_required";
    if (batchIdRaw) {
      await Promise.all([
        admin
          .from("document_processing_batches")
          .update({
            status: customerBatchStatus,
            retryable: false,
            error_code: null,
            completed_at: new Date().toISOString(),
            worker_lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchIdRaw),
        admin.from("policy_documents").update({ status: "extracted" }).in("id", policyDocumentIds),
        admin
          .from("document_extraction_sessions")
          .update({ status: "submitted", updated_at: new Date().toISOString() })
          .eq("id", sessionId),
      ]);
    }

    return jsonResponse({
      batch_id: batchIdRaw ?? null,
      status: batchIdRaw ? customerBatchStatus : undefined,
      session_id: sessionId,
      extracted_document_ids: (persistResult.documents ?? []).map((r: { id: string }) => r.id),
      duplicate: !!persistResult.duplicate,
      candidates: persistResult.candidates ?? [],
      analysis: {
        analysisRunId: persistResult.analysis_run_id ?? analysisRunId,
        warnings: analysis.warnings,
        unresolvedConflicts: analysis.unresolvedConflicts,
      },
    });
  };

  const runtime = (
    globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }
  ).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work());
    return jsonResponse(
      { batch_id: batchIdRaw ?? null, session_id: sessionId, status: "comparing_policies" },
      202,
    );
  }
  return await work();
});
