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
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const query = admin
    .from("asset_candidates")
    .select("id, asset_type, identity_fingerprint, session_id")
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
    assetType: c.asset_type as "property" | "vehicle",
    identityFingerprint: String(c.identity_fingerprint),
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

  // Persist new extracted document rows.
  const extractedDocRows: { id: string; policy_document_id: string }[] = [];
  for (const analyzedDoc of analysis.documents) {
    const docId = analyzedDoc.documentId;
    const { data: extractedDoc, error: extractedErr } = await admin
      .from("extracted_documents")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        policy_document_id: docId,
        file_digest: analyzedDoc.fileDigest,
        page_count: analyzedDoc.pageCount,
        classification: analyzedDoc.classification,
        parser_id: analyzedDoc.parserId,
        parser_version: analyzedDoc.parserVersion,
        pages_json: [],
      })
      .select()
      .single();
    if (extractedErr || !extractedDoc) {
      return jsonError(extractedErr?.message ?? "Failed to record extracted document", 500);
    }
    extractedDocRows.push({ id: extractedDoc.id, policy_document_id: docId });
  }

  const extractedDocIdByInputId = new Map<string, string>();
  for (const row of extractedDocRows) {
    extractedDocIdByInputId.set(row.policy_document_id, row.id);
  }

  // Upsert candidates by identity fingerprint within the session.
  const candidateRecords: unknown[] = [];
  for (const entity of analysis.detectedEntities) {
    const fingerprint = entity.temporaryId;
    const { data: existing } = await admin
      .from("asset_candidates")
      .select("id, source_document_ids")
      .eq("session_id", sessionId)
      .eq("asset_type", entity.entityType)
      .eq("identity_fingerprint", fingerprint)
      .maybeSingle();

    const sourceDocIds = new Set<string>(existing?.source_document_ids ?? []);
    for (const ref of entity.evidence) {
      const extractedId = extractedDocIdByInputId.get(ref.documentId);
      if (extractedId) sourceDocIds.add(extractedId);
    }

    const entityConflicts = analysis.unresolvedConflicts.filter(
      (c) => c.entityRef === entity.temporaryId,
    );
    const selectedFacts = {
      entity,
      sourceDocuments: Array.from(sourceDocIds),
    };

    const payload = {
      display_label: candidateDisplayLabel(entity),
      occupancy: occupancyForEntity(entity),
      match_classification: mapResolutionStatus(entity),
      source_document_ids: Array.from(sourceDocIds),
      selected_facts_json: selectedFacts,
      conflicts_json: entityConflicts,
      updated_at: new Date().toISOString(),
    };

    let candidateId: string;
    if (existing) {
      const { data: updated, error: updateErr } = await admin
        .from("asset_candidates")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();
      if (updateErr || !updated) {
        return jsonError(updateErr?.message ?? "Failed to update candidate", 500);
      }
      candidateId = updated.id;
      candidateRecords.push(updated);
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from("asset_candidates")
        .insert({
          session_id: sessionId,
          household_id: householdId,
          asset_type: entity.entityType,
          identity_fingerprint: fingerprint,
          display_label: candidateDisplayLabel(entity),
          occupancy: occupancyForEntity(entity),
          match_classification: mapResolutionStatus(entity),
          source_document_ids: Array.from(sourceDocIds),
          selected_facts_json: selectedFacts,
          conflicts_json: entityConflicts,
        })
        .select()
        .single();
      if (insertErr || !inserted) {
        return jsonError(insertErr?.message ?? "Failed to insert candidate", 500);
      }
      candidateId = inserted.id;
      candidateRecords.push(inserted);
    }
  }

  return jsonResponse({
    session_id: sessionId,
    extracted_document_ids: extractedDocRows.map((r) => r.id),
    duplicate: false,
    candidates: candidateRecords,
    analysis: {
      modelProvider: analysis.modelProvider,
      modelId: analysis.modelId,
      attemptedModelProvider: analysis.attemptedModelProvider,
      attemptedModelId: analysis.attemptedModelId,
      fallbackReason: analysis.fallbackReason,
      warnings: analysis.warnings,
      unresolvedConflicts: analysis.unresolvedConflicts,
    },
  });
});
