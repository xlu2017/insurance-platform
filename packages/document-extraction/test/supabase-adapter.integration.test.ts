import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  SupabaseAuthorizationStore,
  SupabaseFileLifecycleStore,
} from "../src/providers/supabase-adapter.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblY8_IU";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

async function getUserClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "customer@example.com",
    password: "DemoCustomer123!",
  });
  if (error) throw new Error("Failed to sign in: " + error.message);
  return client;
}

describe("Supabase document extraction adapters", () => {
  it("persists and updates authorization snapshots using snake_case columns", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authStore = new SupabaseAuthorizationStore(admin);
    const user = await getUserClient();

    const policyDocument = await createPolicyDocument(user);
    const analysisRunId = crypto.randomUUID();

    const auth = await authStore.createAuthorization({
      householdId: DEMO_HOUSEHOLD_ID,
      actorProfileId: DEMO_PROFILE_ID,
      purpose: "document_extraction",
      privacyNoticeVersion: "1.0",
      processorContractVersion: "1.0",
      foreignProcessingAcknowledged: true,
      automatedProcessingAcknowledged: true,
      rawProcessingApproved: true,
      externalProcessingEnabled: true,
      authorizationResult: "authorized",
    });

    expect(auth.id).toBeTruthy();

    const { data: row, error } = await admin
      .from("document_processing_authorizations")
      .select("id, household_id, authorization_result, analysis_request_id")
      .eq("id", auth.id)
      .single();
    expect(error).toBeNull();
    expect(row?.household_id).toBe(DEMO_HOUSEHOLD_ID);
    expect(row?.authorization_result).toBe("authorized");
    expect(row?.analysis_request_id).toBeNull();

    await authStore.updateAuthorization(auth.id, {
      analysisRequestId: analysisRunId,
      authorizationResult: "processing_started",
    });

    const { data: updated, error: updateErr } = await admin
      .from("document_processing_authorizations")
      .select("authorization_result, analysis_request_id")
      .eq("id", auth.id)
      .single();
    expect(updateErr).toBeNull();
    expect(updated?.authorization_result).toBe("processing_started");
    expect(updated?.analysis_request_id).toBe(analysisRunId);

    await admin.from("document_processing_authorizations").delete().eq("id", auth.id);
    await admin.from("policy_documents").delete().eq("id", policyDocument.id);
  });

  it("persists provider-file lifecycle records linked to an analysis request", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authStore = new SupabaseAuthorizationStore(admin);
    const lifecycleStore = new SupabaseFileLifecycleStore(admin);
    const user = await getUserClient();
    const analysisRunId = crypto.randomUUID();

    const auth = await authStore.createAuthorization({
      householdId: DEMO_HOUSEHOLD_ID,
      actorProfileId: DEMO_PROFILE_ID,
      purpose: "document_extraction",
      privacyNoticeVersion: "1.0",
      processorContractVersion: "1.0",
      foreignProcessingAcknowledged: true,
      automatedProcessingAcknowledged: true,
      rawProcessingApproved: true,
      externalProcessingEnabled: true,
      authorizationResult: "authorized",
    });

    const policyDocument = await createPolicyDocument(user);

    const record = await lifecycleStore.recordUpload({
      authorizationId: auth.id,
      analysisRequestId: analysisRunId,
      policyDocumentId: policyDocument.id,
      providerFileId: "pending",
      uploadStatus: "started",
    });

    const { data: fileRow, error } = await admin
      .from("document_analysis_provider_files")
      .select("authorization_id, analysis_request_id, provider_file_id, upload_status")
      .eq("id", record.id)
      .single();
    expect(error).toBeNull();
    expect(fileRow?.authorization_id).toBe(auth.id);
    expect(fileRow?.analysis_request_id).toBe(analysisRunId);
    expect(fileRow?.provider_file_id).toBe("pending");
    expect(fileRow?.upload_status).toBe("started");

    await lifecycleStore.markUploadCompleted(record.id, {
      providerFileId: "file_123",
      uploadStatus: "completed",
      processingStatus: "ready",
    });

    const { data: completed, error: completedErr } = await admin
      .from("document_analysis_provider_files")
      .select("provider_file_id, upload_status, processing_status")
      .eq("id", record.id)
      .single();
    expect(completedErr).toBeNull();
    expect(completed?.provider_file_id).toBe("file_123");
    expect(completed?.upload_status).toBe("completed");
    expect(completed?.processing_status).toBe("ready");

    await lifecycleStore.recordDeletionAttempt(record.id, {
      deleted: true,
      attempts: 1,
      statusCode: 200,
    });

    const { data: deleted, error: deletedErr } = await admin
      .from("document_analysis_provider_files")
      .select("deletion_status, deleted_at")
      .eq("id", record.id)
      .single();
    expect(deletedErr).toBeNull();
    expect(deleted?.deletion_status).toBe("deleted");
    expect(deleted?.deleted_at).toBeTruthy();

    const { data: attempts } = await admin
      .from("document_analysis_cleanup_attempts")
      .select("success")
      .eq("file_id", record.id)
      .single();
    expect(attempts?.success).toBe(true);

    await admin.from("document_analysis_provider_files").delete().eq("id", record.id);
    await admin.from("document_processing_authorizations").delete().eq("id", auth.id);
    await admin.from("policy_documents").delete().eq("id", policyDocument.id);
  });
});

async function createPolicyDocument(admin: any) {
  const { data, error } = await admin
    .from("policy_documents")
    .insert({
      household_id: DEMO_HOUSEHOLD_ID,
      file_name: "test.pdf",
      mime_type: "application/pdf",
      size_bytes: 0,
      storage_path: "test",
      uploaded_by: DEMO_PROFILE_ID,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Failed to create policy document: " + error?.message);
  return data;
}
