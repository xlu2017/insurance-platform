import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  SupabaseAuthorizationStore,
  SupabaseFileLifecycleStore,
} from "../src/providers/supabase-adapter.ts";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_IU";

async function getUserClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "customer@example.com",
    password: "DemoCustomer123!",
  });
  if (error) throw new Error("Failed to sign in: " + error.message);
  return client;
}

describe("cleanup-provider-files worker integration", () => {
  it("exposes a healthy, authenticated endpoint", async () => {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/cleanup-provider-files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ health_check: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("ok");
  });

  it("reports cleanup readiness as ready when the cron schedule and vault secrets exist", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin.rpc("check_cleanup_readiness");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.ready).toBe(true);
    expect(data.checks.cron_active).toBe(true);
    expect(data.checks.vault_secrets).toBe(true);
    expect(data.checks.synthetic_resolved).toBe(true);
    expect(data.checks.stale_deleting_count).toBe(0);
  });

  it("records an emergency cleanup row with the actual provider file ID", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const store = new SupabaseFileLifecycleStore(admin);
    const providerFileId = `file_emergency_${crypto.randomUUID()}`;

    await store.recordEmergencyCleanup(providerFileId, "policy-doc-456", "ledger_failed");

    const { data, error } = await admin
      .from("document_analysis_emergency_cleanup")
      .select("provider_file_id, policy_document_id, failure_category")
      .eq("provider_file_id", providerFileId)
      .single();

    expect(error).toBeNull();
    expect(data?.provider_file_id).toBe(providerFileId);
    expect(data?.policy_document_id).toBe("policy-doc-456");
    expect(data?.failure_category).toBe("ledger_failed");

    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .eq("provider_file_id", providerFileId);
  });

  it("prevents concurrent workers from both claiming the same queued lease", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authStore = new SupabaseAuthorizationStore(admin);
    const workerA = "worker-a";
    const workerB = "worker-b";

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

    const user = await getUserClient();
    const { data: policyDoc, error: policyDocErr } = await user
      .from("policy_documents")
      .insert({
        household_id: DEMO_HOUSEHOLD_ID,
        file_name: "test.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "test",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const providerFileId = `concurrent-test-file-${crypto.randomUUID()}`;
    const { data: inserted, error: insertErr } = await admin
      .from("document_analysis_provider_files")
      .insert({
        authorization_id: auth.id,
        policy_document_id: policyDoc!.id,
        provider_file_id: providerFileId,
        upload_status: "completed",
        deletion_status: "queued",
        next_deletion_attempt_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    const id = inserted!.id as string;

    const now = new Date().toISOString();
    const leaseExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Two concurrent claim attempts; only one should win because the second
    // filters on deletion_status='queued' which the first update changes.
    const [claimA, claimB] = await Promise.all([
      admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "deleting",
          cleanup_claimed_at: now,
          cleanup_lease_expires_at: leaseExpires,
          cleanup_worker_id: workerA,
        })
        .eq("id", id)
        .eq("deletion_status", "queued")
        .select("id, cleanup_worker_id")
        .single(),
      admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "deleting",
          cleanup_claimed_at: now,
          cleanup_lease_expires_at: leaseExpires,
          cleanup_worker_id: workerB,
        })
        .eq("id", id)
        .eq("deletion_status", "queued")
        .select("id, cleanup_worker_id")
        .single(),
    ]);

    const winners = [claimA, claimB].filter((c) => c.data?.cleanup_worker_id);
    expect(winners.length).toBe(1);

    // Expired-lease reclamation: another worker may claim the row once the
    // lease expires. First manually expire the lease, then conditionally
    // reclaim it with a new worker and a future lease.
    const pastLease = new Date(Date.now() - 1000).toISOString();
    const reclaimNow = new Date().toISOString();
    const newLeaseExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await admin
      .from("document_analysis_provider_files")
      .update({ cleanup_lease_expires_at: pastLease })
      .eq("id", id)
      .eq("deletion_status", "deleting");

    const { data: reclaimed } = await admin
      .from("document_analysis_provider_files")
      .update({
        cleanup_worker_id: workerB,
        cleanup_lease_expires_at: newLeaseExpires,
      })
      .eq("id", id)
      .eq("deletion_status", "deleting")
      .lt("cleanup_lease_expires_at", reclaimNow)
      .select("id, cleanup_worker_id")
      .single();
    expect(reclaimed?.cleanup_worker_id).toBe(workerB);

    await admin.from("document_analysis_provider_files").delete().eq("id", id);
    await admin.from("document_processing_authorizations").delete().eq("id", auth.id);
    await admin.from("policy_documents").delete().eq("id", policyDoc!.id);
  });

  it("rejects unauthorized access to the cleanup worker endpoint", async () => {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/cleanup-provider-files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ health_check: true }),
    });
    expect(resp.status).toBe(401);
  });
});
