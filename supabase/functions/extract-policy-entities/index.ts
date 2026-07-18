// @ts-nocheck
// Analyze all selected policy documents together and extract stable asset candidates.
//
// The PDFs are downloaded from the private policy-documents bucket. When LLM_API_URL
// and LLM_API_KEY are configured, the extraction routes the documents through the
// InsuranceDocumentAnalyzer with an HTTP LLM provider; otherwise it falls back to
// the deterministic pdfjs-dist + TD parser path. Results are persisted in
// document_extraction_sessions, extracted_documents, and asset_candidates.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildPropertyIdentity,
  buildVehicleIdentity,
  createLlmFirstAnalyzer,
  extractPdfText,
  HttpLlmProvider,
  MemoryDocumentLoader,
} from "../_shared/document-extraction.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
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

function computeCanonicalFingerprint(entity: DetectedInsuranceEntity): string {
  // The analyzer already derives the canonical identity from VIN/address and applies
  // the LLM resolution result (e.g. matching an existing asset or pending candidate).
  if (entity.canonicalFingerprint && entity.canonicalFingerprint.length > 0) {
    return entity.canonicalFingerprint;
  }
  if (entity.entityType === "vehicle") {
    const identity = buildVehicleIdentity({
      vin: entity.identity.vin ?? undefined,
      modelYear: entity.identity.year ?? undefined,
      make: entity.identity.make ?? undefined,
      model: entity.identity.model ?? undefined,
      trim: entity.identity.trim ?? undefined,
    });
    if (identity.strength === "exact" && identity.exactFingerprint) {
      return identity.exactFingerprint;
    }
    return `possible:${entity.temporaryId}`;
  }
  const identity = buildPropertyIdentity({
    addressLine1: entity.identity.fullAddress ?? undefined,
    city: entity.identity.city ?? undefined,
    province: entity.identity.province ?? undefined,
    postalCode: entity.identity.postalCode ?? undefined,
    occupancy: entity.identity.occupancy ?? undefined,
    isRedacted: false,
  });
  if (identity.strength === "exact" && identity.exactFingerprint) {
    return identity.exactFingerprint;
  }
  return `possible:${entity.temporaryId}`;
}

function mapResolutionStatus(entity: DetectedInsuranceEntity): string {
  const status = entity.resolution.status;
  if (status === "new") return "new";
  if (status === "possible_match_requires_confirmation") {
    if (entity.resolution.matchedExistingEntityId || entity.resolution.matchedPendingCandidateId) {
      return "possible_existing_match";
    }
    return "new_identity_confirmation_required";
  }
  if (status === "matches_existing" || status === "matches_pending_candidate") {
    return "exact_existing_match";
  }
  return "new";
}

function occupancyForEntity(entity: DetectedInsuranceEntity): string | null {
  if (entity.entityType === "vehicle") return null;
  const value = entity.identity.occupancy;
  if (value === "principal_residence" || value === "rental" || value === "unknown") return value;
  return "unknown";
}

function candidateDisplayLabel(entity: DetectedInsuranceEntity): string {
  if (entity.displayLabel && entity.displayLabel.trim().length > 0)
    return entity.displayLabel.trim();
  if (entity.entityType === "vehicle") {
    const { year, make, model, trim } = entity.identity;
    return [year, make, model, trim].filter(Boolean).join(" ") || "Unidentified vehicle";
  }
  const { fullAddress, city, province, postalCode, occupancy } = entity.identity;
  const parts = [fullAddress, city, province, postalCode].filter(Boolean);
  const label = parts.join(" ") || `${occupancy ?? "Property"} at ${city ?? "unknown"}`;
  return label;
}

async function loadExistingAssets(
  admin: ReturnType<typeof createClient>,
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
    const identity = buildVehicleIdentity({
      vin: typeof v.vin === "string" ? v.vin : undefined,
      modelYear: typeof v.year === "number" ? v.year : undefined,
      make: typeof v.make === "string" ? v.make : undefined,
      model: typeof v.model === "string" ? v.model : undefined,
    });
    const fingerprint = identity.exactFingerprint ?? identity.possibleMatchHint ?? String(v.id);
    assets.push({ id: String(v.id), assetType: "vehicle", identityFingerprint: fingerprint });
  }
  for (const p of properties ?? []) {
    const identity = buildPropertyIdentity({
      addressLine1: typeof p.address_line1 === "string" ? p.address_line1 : undefined,
      city: typeof p.city === "string" ? p.city : undefined,
      province: typeof p.province === "string" ? p.province : undefined,
      postalCode: typeof p.postal_code === "string" ? p.postal_code : undefined,
      occupancy: p.owner_occupied === false ? "rental" : "principal_residence",
      isRedacted: false,
    });
    const fingerprint = identity.exactFingerprint ?? identity.possibleMatchHint ?? String(p.id);
    assets.push({ id: String(p.id), assetType: "property", identityFingerprint: fingerprint });
  }
  return assets;
}

async function loadPendingCandidates(
  admin: ReturnType<typeof createClient>,
  householdId: string,
  excludeSessionId?: string,
): Promise<PendingEntityCandidate[]> {
  const rows = await loadPendingCandidateRecords(admin, householdId, excludeSessionId);
  return rows.map((c) => ({
    id: String(c.id),
    assetType: c.asset_type as "property" | "vehicle",
    identityFingerprint: String(c.identity_fingerprint),
  }));
}

async function loadPendingCandidateRecords(
  admin: ReturnType<typeof createClient>,
  householdId: string,
  excludeSessionId?: string,
): Promise<
  {
    id: string;
    asset_type: string;
    identity_fingerprint: string;
    session_id: string;
    source_document_ids: string[];
    selected_facts_json: Record<string, unknown>;
    conflicts_json: unknown[];
  }[]
> {
  const query = admin
    .from("asset_candidates")
    .select(
      "id, asset_type, identity_fingerprint, session_id, source_document_ids, selected_facts_json, conflicts_json",
    )
    .eq("household_id", householdId)
    .in("review_status", ["pending", "reviewing"])
    .in("decision", ["undecided", "not_sure"]);
  if (excludeSessionId) {
    query.neq("session_id", excludeSessionId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: String(c.id),
    asset_type: String(c.asset_type),
    identity_fingerprint: String(c.identity_fingerprint),
    session_id: String(c.session_id),
    source_document_ids: Array.isArray(c.source_document_ids)
      ? (c.source_document_ids as string[])
      : [],
    selected_facts_json: (c.selected_facts_json as Record<string, unknown>) ?? {},
    conflicts_json: Array.isArray(c.conflicts_json) ? c.conflicts_json : [],
  }));
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
  const sessionIdRaw = body.session_id as string | undefined;
  const rawDocIds = body.policy_document_ids ?? [body.policy_document_id];

  if (!householdId || !isUuid(householdId)) {
    return jsonError("Missing or invalid household_id", 400);
  }
  if (sessionIdRaw && !isUuid(sessionIdRaw)) {
    return jsonError("Invalid session_id", 400);
  }

  let policyDocumentIds: string[];
  if (Array.isArray(rawDocIds)) {
    policyDocumentIds = rawDocIds.filter(
      (id): id is string => typeof id === "string" && isUuid(id),
    );
  } else if (typeof rawDocIds === "string" && isUuid(rawDocIds)) {
    policyDocumentIds = [rawDocIds];
  } else {
    return jsonError("Missing or invalid policy_document_ids", 400);
  }
  if (policyDocumentIds.length === 0) {
    return jsonError("At least one policy_document_id is required", 400);
  }

  const { data: household, error: householdErr } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (householdErr || !household) {
    return jsonError("Household not found", 404);
  }

  const { data: docRows, error: docsErr } = await supabase
    .from("policy_documents")
    .select("id, storage_path, file_name, household_id")
    .in("id", policyDocumentIds)
    .eq("household_id", householdId);
  if (docsErr) {
    return jsonError(docsErr.message, 500);
  }
  if (!docRows || docRows.length !== policyDocumentIds.length) {
    return jsonError("One or more policy documents not found", 404);
  }

  // Download PDF bytes and compute digests for all requested documents.
  const bytesByReference: Record<string, Uint8Array> = {};
  const digestByDocId: Record<string, string> = {};
  const filenameByDocId: Record<string, string> = {};
  for (const docRow of docRows) {
    const { data: fileData, error: downloadErr } = await admin.storage
      .from("policy-documents")
      .download(docRow.storage_path);
    if (downloadErr || !fileData) {
      return jsonError(downloadErr?.message ?? "Failed to download document", 502);
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const digest = await sha256Hex(bytes);
    bytesByReference[docRow.id] = bytes;
    digestByDocId[docRow.id] = digest;
    filenameByDocId[docRow.id] = docRow.file_name ?? docRow.id;
  }

  // Check for existing extracted documents by digest to avoid re-parsing duplicates.
  const { data: existingExtractedDocs } = await admin
    .from("extracted_documents")
    .select("id, file_digest, session_id, policy_document_id")
    .eq("household_id", householdId)
    .in("file_digest", Object.values(digestByDocId));

  const existingByDigest = new Map<string, { id: string; session_id: string }>();
  for (const row of existingExtractedDocs ?? []) {
    existingByDigest.set(String(row.file_digest), {
      id: String(row.id),
      session_id: String(row.session_id),
    });
  }

  const duplicatedDocIds = policyDocumentIds.filter((id) =>
    existingByDigest.has(digestByDocId[id]),
  );
  const newDocIds = policyDocumentIds.filter((id) => !existingByDigest.has(digestByDocId[id]));

  let sessionId = sessionIdRaw;
  if (!sessionId) {
    if (duplicatedDocIds.length > 0 && existingByDigest.size > 0) {
      const first = existingByDigest.get(digestByDocId[duplicatedDocIds[0]]);
      sessionId = first?.session_id;
    }
    if (!sessionId) {
      const { data: session, error: sessionErr } = await admin
        .from("document_extraction_sessions")
        .insert({ household_id: householdId, status: "open", created_by: user.id })
        .select()
        .single();
      if (sessionErr || !session) {
        return jsonError(sessionErr?.message ?? "Failed to create extraction session", 500);
      }
      sessionId = session.id;
    }
  } else {
    const { data: session } = await supabase
      .from("document_extraction_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) {
      return jsonError("Session not found", 404);
    }
  }

  // If every document is a duplicate, return the existing session and candidates.
  if (newDocIds.length === 0) {
    const { data: existingCandidates } = await admin
      .from("asset_candidates")
      .select("*")
      .eq("session_id", sessionId);
    return jsonResponse({
      session_id: sessionId,
      extracted_document_ids: duplicatedDocIds.map(
        (id) => existingByDigest.get(digestByDocId[id])!.id,
      ),
      duplicate: true,
      candidates: existingCandidates ?? [],
    });
  }

  const uploadedDocuments: InsuranceDocumentAnalysisInput["uploadedDocuments"] = newDocIds.map(
    (id) => ({
      documentId: id,
      filename: filenameByDocId[id],
      mimeType: "application/pdf",
      fileReference: id,
    }),
  );

  const [existingAssets, pendingCandidates] = await Promise.all([
    loadExistingAssets(admin, householdId),
    loadPendingCandidates(admin, householdId, sessionId),
  ]);

  const llmApiUrl = Deno.env.get("LLM_API_URL");
  const llmApiKey = Deno.env.get("LLM_API_KEY");
  const llmModel = Deno.env.get("LLM_MODEL") ?? "deepseek-v4-pro";

  const provider =
    llmApiUrl && llmApiKey
      ? new HttpLlmProvider({
          apiUrl: llmApiUrl,
          apiKey: llmApiKey,
          model: llmModel,
          providerId: llmModel.includes("deepseek") ? "deepseek" : "http-llm-provider",
          supportsImageInput: false,
        })
      : undefined;

  const analyzer = createLlmFirstAnalyzer({
    provider,
    loader: new MemoryDocumentLoader(bytesByReference),
    fallbackToDeterministic: true,
  });

  const analysis = await analyzer.analyze({
    householdId,
    uploadedDocuments,
    existingAssets,
    pendingCandidates,
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  });

  // Build the analysis-run payload. A single RPC call will persist the run,
  // extracted documents, and candidate upserts atomically.
  const analysisRunId = crypto.randomUUID();
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
    rawResponse: analysis.rawResponse,
    validatedOutput,
    warnings: analysis.warnings,
  };

  const documentsJson: unknown[] = [];

  // Prepare extracted document rows with pre-generated UUIDs. The single persistence
  // RPC will insert them atomically.
  const extractedDocRows: { id: string; policy_document_id: string }[] = [];
  const extractedDocIdByInputId = new Map<string, string>();
  for (const analyzedDoc of analysis.documents) {
    const docId = analyzedDoc.documentId;
    const extractedId = crypto.randomUUID();
    let pagesJson: { pageNumber: number; text: string }[] = [];
    try {
      const extracted = await extractPdfText(bytesByReference[docId], docId);
      pagesJson = extracted.pages.map((page: { pageNumber: number; text: string }) => ({
        pageNumber: page.pageNumber,
        text: page.text,
      }));
    } catch {
      // Page text is a best-effort audit field; extraction failure is recorded in warnings.
    }

    documentsJson.push({
      id: extractedId,
      policy_document_id: docId,
      file_digest: analyzedDoc.fileDigest,
      page_count: analyzedDoc.pageCount,
      classification: analyzedDoc.classification,
      parser_id: analyzedDoc.parserId,
      parser_version: analyzedDoc.parserVersion,
      pages_json: pagesJson,
    });
    extractedDocRows.push({ id: extractedId, policy_document_id: docId });
    extractedDocIdByInputId.set(docId, extractedId);
  }

  // Prepare household-wide lookup tables for canonical identity resolution.
  const allPendingRecords = await loadPendingCandidateRecords(admin, householdId);
  const existingById = new Map<string, ExistingHouseholdAsset>();
  for (const asset of existingAssets) {
    existingById.set(asset.id, asset);
  }
  const pendingById = new Map<string, (typeof allPendingRecords)[number]>();
  const candidateByFingerprint = new Map<string, (typeof allPendingRecords)[number]>();
  for (const record of allPendingRecords) {
    pendingById.set(record.id, record);
    candidateByFingerprint.set(record.identity_fingerprint, record);
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

  function isExactFingerprint(fingerprint: string): boolean {
    return (
      (fingerprint.startsWith("vehicle:vin:") && fingerprint.length > "vehicle:vin:".length) ||
      (fingerprint.startsWith("property:") && fingerprint.includes("|"))
    );
  }

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
        isExactFingerprint(fingerprint) && !isExactFingerprint(matchedExisting.identityFingerprint)
          ? fingerprint
          : matchedExisting.identityFingerprint;
    } else if (resolution.status === "matches_pending_candidate" && matchedPending) {
      fingerprint =
        isExactFingerprint(fingerprint) && !isExactFingerprint(matchedPending.identity_fingerprint)
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
    for (const cv of Object.values(entity.currentCoverage)) {
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
      group.resolution.status === "matches_pending_candidate" &&
      group.resolution.matchedPendingCandidateId
        ? group.resolution.matchedPendingCandidateId
        : undefined;
    const existingCandidate =
      (matchedPendingId ? pendingById.get(matchedPendingId) : undefined) ??
      candidateByFingerprint.get(group.fingerprint);

    const mergedSourceDocIds = new Set<string>(existingCandidate?.source_document_ids ?? []);
    for (const id of group.sourceDocIds) mergedSourceDocIds.add(id);

    const selectedFacts = {
      canonicalFingerprint: group.fingerprint,
      entities: group.entities.map((e) => e.temporaryId),
      sourceDocuments: Array.from(mergedSourceDocIds),
      resolution: group.resolution,
      identity: representative.identity,
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
      source_document_ids: Array.from(mergedSourceDocIds),
      selected_facts_json: selectedFacts,
      conflicts_json: group.conflicts,
    });

    if (existingCandidate) {
      candidateByFingerprint.set(group.fingerprint, {
        ...existingCandidate,
        source_document_ids: Array.from(mergedSourceDocIds),
        selected_facts_json: selectedFacts,
      });
    }
  }

  // Generate a deterministic client request id so retries return the same result.
  const requestIdPayload = new TextEncoder().encode(
    [householdId, sessionId, ...Object.values(digestByDocId).sort()].join("|"),
  );
  const clientRequestId = await sha256Hex(requestIdPayload);

  const { data: persistResult, error: persistErr } = await admin.rpc(
    "persist_document_analysis_v1",
    {
      p_household_id: householdId,
      p_session_id: sessionId,
      p_client_request_id: clientRequestId,
      p_analysis_run_id: analysisRunId,
      p_analysis_json: analysisJson,
      p_documents_json: documentsJson,
      p_candidates_json: candidatesJson,
    },
  );
  if (persistErr || !persistResult) {
    return jsonError(persistErr?.message ?? "Failed to persist analysis", 500);
  }

  return jsonResponse({
    session_id: sessionId,
    extracted_document_ids: (persistResult.documents ?? []).map((r: { id: string }) => r.id),
    duplicate: !!persistResult.duplicate,
    candidates: persistResult.candidates ?? [],
    analysis: {
      modelProvider: analysis.modelProvider,
      modelId: analysis.modelId,
      attemptedModelProvider: analysis.attemptedModelProvider,
      attemptedModelId: analysis.attemptedModelId,
      fallbackReason: analysis.fallbackReason,
      warnings: analysis.warnings,
      unresolvedConflicts: analysis.unresolvedConflicts,
      analysisRunId: persistResult.analysis_run_id ?? analysisRunId,
    },
  });
});
