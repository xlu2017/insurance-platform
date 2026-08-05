import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";
import {
  SupabaseAuthorizationStore,
  SupabaseFileLifecycleStore,
} from "../src/providers/supabase-adapter.ts";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

const SUPABASE_URL = process.env.SUPABASE_URL || LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = LOCAL_SUPABASE_ANON_KEY;

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
  beforeAll(async () => {
    assertLocalSupabase();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    // Clean up any leftover rows from interrupted prior test runs so the
    // readiness check can observe a known, healthy baseline.
    await admin
      .from("document_analysis_cleanup_attempts")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("document_analysis_provider_files")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("document_processing_authorizations")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin.from("policy_documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });

  it("reports provider readiness on the authenticated health endpoint", async () => {
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
    expect(typeof body.provider_ready).toBe("boolean");
  });

  it("records a not-ready status when the provider credential is missing", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/cleanup-provider-files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(503);

    const { data: status } = await admin
      .from("cleanup_readiness_status")
      .select("ready, checks")
      .single();
    expect(status?.ready).toBe(false);
    expect(status?.checks?.provider_credential_present).toBe(false);
  });

  it("reports cleanup readiness as ready when the cron schedule and vault secrets exist", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { data, error } = await admin.rpc("check_cleanup_readiness");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.ready).toBe(true);
    expect(data.checks.cron_active).toBe(true);
    expect(data.checks.vault_secrets).toBe(true);
    expect(data.checks.synthetic_resolved).toBe(true);
    expect(data.checks.stale_deleting_count).toBe(0);
    expect(data.checks.permanent_failure_count).toBe(0);
  });

  it("reports cleanup readiness as not ready when a permanent failure exists", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
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

    const { data: auth } = await admin
      .from("document_processing_authorizations")
      .insert({
        household_id: DEMO_HOUSEHOLD_ID,
        actor_profile_id: DEMO_PROFILE_ID,
        purpose: "document_extraction",
        privacy_notice_version: "1.0",
        processor_contract_version: "1.0",
        foreign_processing_acknowledged: true,
        automated_processing_acknowledged: true,
        raw_processing_approved: true,
        external_processing_enabled: false,
        authorization_result: "authorized",
      })
      .select("id")
      .single();

    const { data: file } = await admin
      .from("document_analysis_provider_files")
      .insert({
        authorization_id: auth!.id,
        policy_document_id: policyDoc!.id,
        provider_file_id: `permanent_${crypto.randomUUID()}`,
        upload_status: "completed",
        deletion_status: "failed_permanently",
      })
      .select("id")
      .single();

    const { data, error } = await admin.rpc("check_cleanup_readiness");
    expect(error).toBeNull();
    expect(data.ready).toBe(false);
    expect(data.checks.permanent_failure_count).toBeGreaterThanOrEqual(1);

    await admin.from("document_analysis_provider_files").delete().eq("id", file!.id);
    await admin.from("document_processing_authorizations").delete().eq("id", auth!.id);
    await admin.from("policy_documents").delete().eq("id", policyDoc!.id);
  });

  it("records an emergency cleanup row with the actual provider file ID and pending status", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const store = new SupabaseFileLifecycleStore(admin);
    const providerFileId = `file_emergency_${crypto.randomUUID()}`;

    await store.recordEmergencyCleanup(providerFileId, "policy-doc-456", "ledger_failed");

    const { data, error } = await admin
      .from("document_analysis_emergency_cleanup")
      .select(
        "provider_file_id, policy_document_id, failure_category, cleanup_status, operator_action_required, next_attempt_at, resolved_at",
      )
      .eq("provider_file_id", providerFileId)
      .single();

    expect(error).toBeNull();
    expect(data?.provider_file_id).toBe(providerFileId);
    expect(data?.policy_document_id).toBe("policy-doc-456");
    expect(data?.failure_category).toBe("ledger_failed");
    expect(data?.cleanup_status).toBe("pending");
    expect(data?.operator_action_required).toBe(false);
    expect(data?.next_attempt_at).toBeTruthy();
    expect(data?.resolved_at).toBeNull();

    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .eq("provider_file_id", providerFileId);
  });

  it("keeps a permanent emergency failure unresolved and flagged for operator action", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `permanent_emergency_${crypto.randomUUID()}`;

    await admin.from("document_analysis_emergency_cleanup").insert({
      provider_file_id: providerFileId,
      policy_document_id: "policy-doc-789",
      failure_category: "deletion_failed",
      cleanup_status: "failed_permanently",
      operator_action_required: true,
    });

    const { data } = await admin
      .from("document_analysis_emergency_cleanup")
      .select("resolved_at, cleanup_status, operator_action_required")
      .eq("provider_file_id", providerFileId)
      .single();

    expect(data?.resolved_at).toBeNull();
    expect(data?.cleanup_status).toBe("failed_permanently");
    expect(data?.operator_action_required).toBe(true);

    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .eq("provider_file_id", providerFileId);
  });

  it("prevents concurrent workers from claiming the same emergency cleanup row", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `emergency_concurrent_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const { data: inserted } = await admin
      .from("document_analysis_emergency_cleanup")
      .insert({
        provider_file_id: providerFileId,
        policy_document_id: "policy-concurrent",
        cleanup_status: "pending",
        next_attempt_at: now,
      })
      .select("id")
      .single();

    const id = inserted!.id as string;
    const workerA = "worker-a";
    const workerB = "worker-b";
    const leaseExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const [claimA, claimB] = await Promise.all([
      admin
        .from("document_analysis_emergency_cleanup")
        .update({
          cleanup_status: "processing",
          cleanup_claimed_at: now,
          cleanup_lease_expires_at: leaseExpires,
          cleanup_worker_id: workerA,
        })
        .eq("id", id)
        .in("cleanup_status", ["pending", "failed_permanently"])
        .is("operator_action_required", false)
        .or("cleanup_claimed_at.is.null,cleanup_lease_expires_at.lt.now")
        .or("next_attempt_at.is.null,next_attempt_at.lte.now")
        .select("id, cleanup_worker_id")
        .single(),
      admin
        .from("document_analysis_emergency_cleanup")
        .update({
          cleanup_status: "processing",
          cleanup_claimed_at: now,
          cleanup_lease_expires_at: leaseExpires,
          cleanup_worker_id: workerB,
        })
        .eq("id", id)
        .in("cleanup_status", ["pending", "failed_permanently"])
        .is("operator_action_required", false)
        .or("cleanup_claimed_at.is.null,cleanup_lease_expires_at.lt.now")
        .or("next_attempt_at.is.null,next_attempt_at.lte.now")
        .select("id, cleanup_worker_id")
        .single(),
    ]);

    const winners = [claimA, claimB].filter((c) => c.data?.cleanup_worker_id);
    expect(winners.length).toBe(1);

    await admin.from("document_analysis_emergency_cleanup").delete().eq("id", id);
  });

  it("prevents concurrent workers from both claiming the same queued lease", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
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

  it("reclaims an emergency cleanup row stuck in processing with an expired lease", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `emergency_expired_${crypto.randomUUID()}`;
    const pastLease = new Date(Date.now() - 1000).toISOString();
    const now = new Date().toISOString();

    const { data: inserted } = await admin
      .from("document_analysis_emergency_cleanup")
      .insert({
        provider_file_id: providerFileId,
        policy_document_id: "policy-expired-lease",
        cleanup_status: "processing",
        cleanup_claimed_at: pastLease,
        cleanup_lease_expires_at: pastLease,
        cleanup_worker_id: "crashed-worker",
        next_attempt_at: null,
      })
      .select("id")
      .single();

    const id = inserted!.id as string;
    const newWorker = "worker-reclaim";
    const newLease = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: claimed } = await admin
      .from("document_analysis_emergency_cleanup")
      .update({
        cleanup_status: "processing",
        cleanup_claimed_at: now,
        cleanup_lease_expires_at: newLease,
        cleanup_worker_id: newWorker,
      })
      .eq("id", id)
      .eq("cleanup_status", "processing")
      .lt("cleanup_lease_expires_at", now)
      .select("cleanup_worker_id, cleanup_lease_expires_at")
      .single();

    expect(claimed?.cleanup_worker_id).toBe(newWorker);
    expect(new Date(String(claimed?.cleanup_lease_expires_at)).getTime()).toBeGreaterThan(
      Date.now(),
    );

    await admin.from("document_analysis_emergency_cleanup").delete().eq("id", id);
  });

  it("prevents a stale normal cleanup worker from finalizing a row reclaimed by another worker", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const authStore = new SupabaseAuthorizationStore(admin);
    const workerA = "stale-worker-a";
    const workerB = "fresh-worker-b";

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

    const providerFileId = `fence-test-file-${crypto.randomUUID()}`;
    const { data: inserted } = await admin
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
    const id = inserted!.id as string;

    const claimTime = new Date().toISOString();
    const leaseExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await admin
      .from("document_analysis_provider_files")
      .update({
        deletion_status: "deleting",
        cleanup_claimed_at: claimTime,
        cleanup_lease_expires_at: leaseExpires,
        cleanup_worker_id: workerA,
      })
      .eq("id", id)
      .eq("deletion_status", "queued");

    // Lease expires and worker B reclaims the row.
    const pastLease = new Date(Date.now() - 1000).toISOString();
    const reclaimTime = new Date().toISOString();
    const newLease = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await admin
      .from("document_analysis_provider_files")
      .update({
        cleanup_lease_expires_at: pastLease,
      })
      .eq("id", id)
      .eq("cleanup_worker_id", workerA);

    const { data: reclaimed } = await admin
      .from("document_analysis_provider_files")
      .update({
        cleanup_worker_id: workerB,
        cleanup_lease_expires_at: newLease,
        cleanup_claimed_at: reclaimTime,
      })
      .eq("id", id)
      .eq("deletion_status", "deleting")
      .lt("cleanup_lease_expires_at", reclaimTime)
      .select("cleanup_worker_id")
      .single();
    expect(reclaimed?.cleanup_worker_id).toBe(workerB);

    // Worker A attempts to finalize the row it no longer owns.
    const { data: staleFinalized, error: staleFinalizedErr } = await admin
      .from("document_analysis_provider_files")
      .update({
        deletion_status: "deleted",
        deleted_at: new Date().toISOString(),
        next_deletion_attempt_at: null,
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null,
      })
      .eq("id", id)
      .eq("deletion_status", "deleting")
      .eq("cleanup_worker_id", workerA)
      .select("id");
    expect(staleFinalizedErr).toBeNull();
    expect(staleFinalized).toEqual([]);

    const { data: finalRow } = await admin
      .from("document_analysis_provider_files")
      .select("cleanup_worker_id, deletion_status")
      .eq("id", id)
      .single();
    expect(finalRow?.cleanup_worker_id).toBe(workerB);
    expect(finalRow?.deletion_status).toBe("deleting");

    await admin.from("document_analysis_provider_files").delete().eq("id", id);
    await admin.from("document_processing_authorizations").delete().eq("id", auth.id);
    await admin.from("policy_documents").delete().eq("id", policyDoc!.id);
  });

  it("reports cleanup readiness as false when an emergency permanent failure exists", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `emergency_permanent_${crypto.randomUUID()}`;

    await admin.from("document_analysis_emergency_cleanup").insert({
      provider_file_id: providerFileId,
      policy_document_id: "policy-permanent",
      cleanup_status: "failed_permanently",
      operator_action_required: true,
    });

    const { data, error } = await admin.rpc("check_cleanup_readiness");
    expect(error).toBeNull();
    expect(data.ready).toBe(false);
    expect(data.checks.permanent_failure_count).toBeGreaterThanOrEqual(1);

    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .eq("provider_file_id", providerFileId);
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

  it("does not expose a get_cleanup_secrets RPC", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { data, error } = await admin.rpc("get_cleanup_secrets" as any);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(String(error?.message ?? "").toLowerCase()).toMatch(
      /function|rpc|not found|could not find/,
    );
  });

  it("allows only service_role to execute check_cleanup_readiness", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: anonData, error: anonError } = await anon.rpc("check_cleanup_readiness" as any);
    expect(anonData).toBeNull();
    expect(anonError).not.toBeNull();

    const user = await getUserClient();
    const { data: authData, error: authError } = await user.rpc("check_cleanup_readiness" as any);
    expect(authData).toBeNull();
    expect(authError).not.toBeNull();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { data: svcData, error: svcError } = await admin.rpc("check_cleanup_readiness");
    expect(svcError).toBeNull();
    expect(svcData?.ready).toBe(true);
  });

  it("does not report a fenced emergency final update as successful when the lease is lost", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `emergency_zero_row_${crypto.randomUUID()}`;
    const workerA = "emergency-stale-a";
    const workerB = "emergency-reclaim-b";
    const now = new Date().toISOString();
    const pastLease = new Date(Date.now() - 1000).toISOString();
    const futureLease = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: inserted } = await admin
      .from("document_analysis_emergency_cleanup")
      .insert({
        provider_file_id: providerFileId,
        policy_document_id: "policy-zero-row",
        cleanup_status: "processing",
        cleanup_claimed_at: pastLease,
        cleanup_lease_expires_at: pastLease,
        cleanup_worker_id: workerA,
      })
      .select("id")
      .single();
    const id = inserted!.id as string;

    // Worker B reclaims the expired processing row.
    const { data: reclaimed } = await admin
      .from("document_analysis_emergency_cleanup")
      .update({
        cleanup_worker_id: workerB,
        cleanup_claimed_at: now,
        cleanup_lease_expires_at: futureLease,
      })
      .eq("id", id)
      .eq("cleanup_status", "processing")
      .lt("cleanup_lease_expires_at", now)
      .select("cleanup_worker_id")
      .single();
    expect(reclaimed?.cleanup_worker_id).toBe(workerB);

    // Worker A attempts to finalize the row it no longer owns.
    const { data: staleFinalData, error: staleFinalErr } = await admin
      .from("document_analysis_emergency_cleanup")
      .update({
        cleanup_status: "deleted",
        resolved_at: now,
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null,
      })
      .eq("id", id)
      .eq("cleanup_status", "processing")
      .eq("cleanup_worker_id", workerA)
      .select("id");
    expect(staleFinalErr).toBeNull();
    expect(staleFinalData).toEqual([]);

    await admin.from("document_analysis_emergency_cleanup").delete().eq("id", id);
  });

  it("survives a forward repair migration with existing queued and emergency records", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const providerFileId = `survival_${crypto.randomUUID()}`;

    const { data: inserted } = await admin
      .from("document_analysis_emergency_cleanup")
      .insert({
        provider_file_id: providerFileId,
        policy_document_id: "policy-survival",
        cleanup_status: "pending",
      })
      .select("id, cleanup_status, cleanup_claimed_at, cleanup_lease_expires_at, cleanup_worker_id")
      .single();
    expect(inserted?.cleanup_status).toBe("pending");
    expect(inserted?.cleanup_worker_id).toBeNull();

    // The cleanup RPC and the worker must still see the row after the repair migration.
    const { data: rpcData, error: rpcError } = await admin.rpc("check_cleanup_readiness");
    expect(rpcError).toBeNull();
    expect(rpcData?.checks?.permanent_failure_count).toBe(0);

    await admin
      .from("document_analysis_emergency_cleanup")
      .delete()
      .eq("id", inserted!.id as string);
  });
});
