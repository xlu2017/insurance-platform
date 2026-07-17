// Extract text and parse an uploaded policy document into stable asset candidates.
//
// The PDF is downloaded from the private policy-documents bucket, parsed locally
// with pdfjs-dist, and the resulting assertions and candidates are persisted in
// document_extraction_sessions, extracted_documents, asset_candidates,
// extracted_fact_assertions, and candidate_conflicts.
//
// Duplicate file digests are ignored after the first extraction. Candidates are
// matched across sessions by normalized identity fingerprint (VIN for vehicles,
// normalized civic address for properties) and enriched rather than duplicated.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractPdfText,
  parseDocument,
  type ExtractedFactAssertion,
  type ParsedAssetAssertion,
} from "../_shared/document-extraction.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const authorityOrder = [
  "coverage_summary",
  "insurance_certificate",
  "endorsement",
  "invoice",
  "renewal_overview",
  "notice",
  "header_footer",
] as const;

function authorityRank(a: string): number {
  return authorityOrder.indexOf(a as (typeof authorityOrder)[number]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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

interface CandidateRecord {
  id: string;
  session_id: string;
  household_id: string;
  asset_type: string;
  identity_fingerprint: string;
  display_label: string;
  occupancy: string | null;
  match_classification: string;
  decision: string;
  review_status: string;
  source_document_ids: string[];
  selected_facts_json: Record<string, string>;
  conflicts_json: unknown[];
}

interface FactRow {
  id: string;
  candidate_id: string | null;
  document_id: string;
  page_number: number;
  entity_scope: string;
  field_path: string;
  raw_text: string;
  parsed_value: unknown;
  normalized_value: unknown;
  parser_id: string;
  parser_version: string;
  confidence: number;
  authority: string;
  created_at: string;
}

function candidateDisplayLabel(a: ParsedAssetAssertion): string {
  if (a.assetType === "vehicle") {
    return a.displayLabel;
  }
  const addr = a.displayLabel;
  return addr || a.identityFingerprint;
}

function normalizeIdentity(a: ParsedAssetAssertion): {
  fingerprint: string;
  label: string;
  occupancy?: string;
} {
  const label = candidateDisplayLabel(a);
  return {
    fingerprint: a.identityFingerprint,
    label,
    occupancy: a.occupancy,
  };
}

function assertionFromParsed(
  docId: string,
  candidateId: string | null,
  a: ExtractedFactAssertion,
): Omit<FactRow, "created_at"> {
  return {
    id: a.id,
    candidate_id: candidateId,
    document_id: docId,
    page_number: a.pageNumber,
    entity_scope: a.entityScope,
    field_path: a.fieldPath,
    raw_text: a.rawText,
    parsed_value: a.parsedValue,
    normalized_value: a.normalizedValue,
    parser_id: a.parserId,
    parser_version: a.parserVersion,
    confidence: a.confidence,
    authority: a.authority,
  };
}

async function resolveOrCreateCandidate(
  admin: ReturnType<typeof createClient>,
  sessionId: string,
  householdId: string,
  extractedDocId: string,
  parsed: ParsedAssetAssertion,
): Promise<CandidateRecord> {
  const { fingerprint, label, occupancy } = normalizeIdentity(parsed);

  const { data: existing } = await admin
    .from("asset_candidates")
    .select("*")
    .eq("household_id", householdId)
    .eq("asset_type", parsed.assetType)
    .eq("identity_fingerprint", fingerprint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let candidate: CandidateRecord;

  if (existing) {
    candidate = existing as CandidateRecord;
    const sourceIds = new Set(candidate.source_document_ids);
    sourceIds.add(extractedDocId);
    const { data: updated, error: updateErr } = await admin
      .from("asset_candidates")
      .update({
        source_document_ids: Array.from(sourceIds),
        occupancy: occupancy ?? candidate.occupancy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .select()
      .single();
    if (updateErr) throw new Error(updateErr.message);
    candidate = updated as CandidateRecord;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: parsed.assetType,
        identity_fingerprint: fingerprint,
        display_label: label,
        occupancy: occupancy ?? "unknown",
        match_classification: parsed.matchClassification ?? "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocId],
        selected_facts_json: {},
        conflicts_json: [],
      })
      .select()
      .single();
    if (insertErr) throw new Error(insertErr.message);
    candidate = inserted as CandidateRecord;
  }

  for (const a of parsed.assertions) {
    const row = assertionFromParsed(extractedDocId, candidate.id, a);
    const { error } = await admin.from("extracted_fact_assertions").insert(row);
    if (error) throw new Error(error.message);
  }

  await recomputeCandidateFacts(admin, candidate.id);

  const { data: refreshed, error: refreshErr } = await admin
    .from("asset_candidates")
    .select("*")
    .eq("id", candidate.id)
    .single();
  if (refreshErr || !refreshed) throw new Error(refreshErr?.message ?? "candidate not found");
  return refreshed as CandidateRecord;
}

async function recomputeCandidateFacts(
  admin: ReturnType<typeof createClient>,
  candidateId: string,
): Promise<void> {
  const { data: rows, error } = await admin
    .from("extracted_fact_assertions")
    .select("*")
    .eq("candidate_id", candidateId);
  if (error) throw new Error(error.message);

  const byPath = new Map<string, FactRow[]>();
  for (const row of (rows ?? []) as FactRow[]) {
    const list = byPath.get(row.field_path) ?? [];
    list.push(row);
    byPath.set(row.field_path, list);
  }

  const selectedFacts: Record<string, string> = {};
  const conflicts: {
    fieldPath: string;
    assertionIds: string[];
    selectedAssertionId?: string;
    reason: string;
  }[] = [];

  for (const [path, list] of byPath.entries()) {
    const sorted = [...list].sort(
      (a, b) =>
        authorityRank(b.authority) - authorityRank(a.authority) || b.confidence - a.confidence,
    );
    selectedFacts[path] = sorted[0].id;

    const distinct = new Set(list.map((r) => JSON.stringify(r.normalized_value)));
    if (distinct.size > 1) {
      conflicts.push({
        fieldPath: path,
        assertionIds: sorted.map((r) => r.id),
        selectedAssertionId: sorted[0].id,
        reason: `Conflicting values for ${path}; selected ${sorted[0].authority}.`,
      });
    }
  }

  const { error: deleteErr } = await admin
    .from("candidate_conflicts")
    .delete()
    .eq("candidate_id", candidateId);
  if (deleteErr) throw new Error(deleteErr.message);

  for (const c of conflicts) {
    const { error } = await admin.from("candidate_conflicts").insert({
      candidate_id: candidateId,
      field_path: c.fieldPath,
      assertion_ids: c.assertionIds,
      selected_assertion_id: c.selectedAssertionId,
      reason: c.reason,
    });
    if (error) throw new Error(error.message);
  }

  const { error: updateErr } = await admin
    .from("asset_candidates")
    .update({
      selected_facts_json: selectedFacts,
      conflicts_json: conflicts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidateId);
  if (updateErr) throw new Error(updateErr.message);
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
  const policyDocumentId = body.policy_document_id as string | undefined;
  let sessionId = body.session_id as string | undefined;

  if (!householdId || !isUuid(householdId)) {
    return jsonError("Missing or invalid household_id", 400);
  }
  if (!policyDocumentId || !isUuid(policyDocumentId)) {
    return jsonError("Missing or invalid policy_document_id", 400);
  }
  if (sessionId && !isUuid(sessionId)) {
    return jsonError("Invalid session_id", 400);
  }

  // Verify the caller has access to the household.
  const { data: household, error: householdErr } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (householdErr || !household) {
    return jsonError("Household not found", 404);
  }

  const { data: docRow, error: docErr } = await supabase
    .from("policy_documents")
    .select("id, storage_path, file_name, household_id")
    .eq("id", policyDocumentId)
    .maybeSingle();
  if (docErr || !docRow) {
    return jsonError("Policy document not found", 404);
  }
  if (docRow.household_id !== householdId) {
    return jsonError("Policy document does not belong to household", 403);
  }

  // Download the file bytes with service role.
  const { data: fileData, error: downloadErr } = await admin.storage
    .from("policy-documents")
    .download(docRow.storage_path);
  if (downloadErr || !fileData) {
    return jsonError(downloadErr?.message ?? "Failed to download document", 502);
  }
  const bytes = new Uint8Array(await fileData.arrayBuffer());

  // Compute the file digest to detect duplicates.
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const fileDigest = Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: existingDoc } = await admin
    .from("extracted_documents")
    .select("id, file_digest, session_id")
    .eq("household_id", householdId)
    .eq("file_digest", fileDigest)
    .limit(1)
    .maybeSingle();

  if (existingDoc) {
    const { data: existingCandidates } = await admin
      .from("asset_candidates")
      .select("*")
      .eq("session_id", existingDoc.session_id);
    return jsonResponse({
      session_id: existingDoc.session_id,
      extracted_document_id: existingDoc.id,
      duplicate: true,
      candidates: existingCandidates ?? [],
    });
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

  const extracted = await extractPdfText(bytes, docRow.file_name);
  const parsed = parseDocument(extracted);

  const { data: extractedDoc, error: extractedErr } = await admin
    .from("extracted_documents")
    .insert({
      session_id: sessionId,
      household_id: householdId,
      policy_document_id: docRow.id,
      file_digest: fileDigest,
      page_count: extracted.pageCount,
      classification: parsed.classification,
      parser_id: parsed.parserId,
      parser_version: parsed.parserVersion,
      pages_json: extracted.pages,
    })
    .select()
    .single();
  if (extractedErr || !extractedDoc) {
    return jsonError(extractedErr?.message ?? "Failed to record extracted document", 500);
  }

  const candidateRecords: CandidateRecord[] = [];
  for (const assetAssertion of parsed.assetAssertions) {
    const candidate = await resolveOrCreateCandidate(
      admin,
      sessionId,
      householdId,
      extractedDoc.id,
      assetAssertion,
    );
    candidateRecords.push(candidate);
  }

  return jsonResponse({
    session_id: sessionId,
    extracted_document_id: extractedDoc.id,
    duplicate: false,
    candidates: candidateRecords,
  });
});
