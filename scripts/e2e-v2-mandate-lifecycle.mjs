// End-to-end V2 mandate lifecycle run against a freshly seeded local Supabase.
// Exercises: public mandate-save validation, V2 source-of-truth, Edge Function
// recommendation generation, V2 snapshot binding, stale-mandate approval
// rejection, and negative security cases.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { createAccessToken } from "./jwt.mjs";

function loadEnv() {
  const env = {};
  const candidates = [".env.local", "apps/admin/.env.local", "apps/mobile/.env.local"];
  for (const file of candidates) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const [k, ...rest] = line.split("=");
        if (k && rest.length) env[k.trim()] = rest.join("=").trim();
      }
    } catch {}
  }
  return env;
}

const fileEnv = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "";
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || fileEnv.SUPABASE_JWT_SECRET || "super-secret-jwt-token-with-at-least-32-characters-long";

const householdId = "20000000-0000-0000-0000-000000000001";
const caseId = "30000000-0000-0000-0000-000000000001";

const USERS = {
  customer: { id: "00000000-0000-0000-0000-000000000001", email: "customer@example.com", role: "customer" },
  operations: { id: "00000000-0000-0000-0000-000000000002", email: "operations@example.com", role: "operations" },
  reviewer: { id: "00000000-0000-0000-0000-000000000003", email: "reviewer@example.com", role: "reviewer" },
  admin: { id: "00000000-0000-0000-0000-000000000004", email: "admin@example.com", role: "admin" },
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
};

function clientFor(user) {
  const token = createAccessToken({ sub: user.id, appRole: user.role, email: user.email }, JWT_SECRET);
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const serviceClient = SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const customer = clientFor(USERS.customer);
const operations = clientFor(USERS.operations);
const reviewer = clientFor(USERS.reviewer);

function mandatePayload({ liabilityCents, version, switchingVersion }) {
  return {
    householdId,
    expectedMandateVersion: version,
    expectedSwitchingVersion: switchingVersion,
    mandate: {
      schemaVersion: 2,
      jurisdiction: "AB",
      version: version > 0 ? version : 1,
      effectiveFrom: new Date().toISOString(),
      householdAutoDefaults: {
        liability: { rule: "minimum", amountCents: liabilityCents },
        coverageForm: { value: "comprehensive", preference: "required" },
        endorsements: {
          oem_parts: "indifferent",
          telematics: "indifferent",
          glass_coverage: "indifferent",
          family_protection: "indifferent",
          depreciation_waiver: "indifferent",
          roadside_assistance: "indifferent",
          accident_forgiveness: "indifferent",
          non_owned_automobile: "indifferent",
          disappearing_deductible: "indifferent",
          rental_vehicle_coverage: "indifferent",
        },
        glassDeductible: { rule: "any" },
        collisionDeductible: { rule: "maximum", amountCents: 100000 },
        comprehensiveDeductible: { rule: "maximum", amountCents: 100000 },
      },
      householdPropertyDefaults: {
        coverageForm: { value: "comprehensive", preference: "required" },
        settlementBasis: { value: "replacement_cost", preference: "required" },
        dwellingLimit: { rule: "minimum", amountCents: 45000000 },
        contentsLimit: { rule: "any" },
        detachedStructuresLimit: { rule: "any" },
        personalLiabilityLimit: { rule: "any" },
        additionalLivingExpenseLimit: { rule: "any" },
        baseDeductible: { rule: "maximum", amountCents: 250000 },
        waterDeductible: { rule: "any" },
        windHailDeductible: { rule: "any" },
        earthquakeDeductible: { rule: "any" },
        sewerBackup: { preference: "indifferent", limit: { rule: "any" }, deductible: { rule: "any" } },
        overlandWater: { preference: "indifferent", limit: { rule: "any" }, deductible: { rule: "any" } },
        optionalCoverages: {
          cyber: "indifferent",
          ice_dam: "indifferent",
          earthquake: "indifferent",
          home_systems: "indifferent",
          service_line: "indifferent",
          home_business: "indifferent",
          bylaw_coverage: "indifferent",
          claims_forgiveness: "indifferent",
          equipment_breakdown: "indifferent",
          groundwater_seepage: "indifferent",
          scheduled_valuables: "indifferent",
          short_term_rental_permission: "indifferent",
        },
      },
      vehicleOverrides: [],
      propertyOverrides: [],
    },
    switching: {
      minNetAnnualSavingsCents: 20000,
      maxPremiumIncreaseCents: 0,
      maxDeductibleIncreaseCents: 0,
      renewalOnlySwitching: true,
      householdOptimizationEnabled: true,
      splitInsurersAllowed: true,
      excludedInsurerIds: [],
      deductibleIncreasesAllowed: false,
      materialCoverageReductionsAllowed: false,
      customerApprovalRequired: true,
      switchOnlyAfterCustomerApproval: true,
      allowBundleBreakup: false,
      minimumInsurerFinancialRating: "any",
      preferredPaymentFrequency: "annual",
      preferredBillingMethod: "automatic_bank",
      brokerDirectPreference: "indifferent",
    },
  };
}

async function currentMandateRow() {
  const { data, error } = await serviceClient
    .from("household_coverage_mandates")
    .select("id, version, household_auto_defaults")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function currentSwitchingVersion() {
  const { data, error } = await serviceClient
    .from("switching_preferences")
    .select("version, id")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return data || { version: 0, id: null };
}

async function setCaseState(state) {
  const { error } = await serviceClient.from("optimization_cases").update({ state }).eq("id", caseId);
  if (error) throw error;
}

async function deleteRecommendations() {
  const { data: recs } = await serviceClient.from("recommendations").select("id").eq("case_id", caseId);
  const ids = (recs || []).map((r) => r.id);
  if (ids.length) {
    await serviceClient.from("recommendation_options").delete().in("recommendation_id", ids);
    await serviceClient.from("recommendation_approvals").delete().in("recommendation_id", ids);
    await serviceClient.from("recommendations").delete().in("id", ids);
  }
}

async function ensureSingleAssetPerLine() {
  const { data: vehicles } = await serviceClient
    .from("vehicles")
    .select("id")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  const [keepVehicle, ...extraVehicles] = vehicles || [];
  for (const v of extraVehicles) {
    await serviceClient.from("vehicles").delete().eq("id", v.id);
  }
  const { data: properties } = await serviceClient
    .from("properties")
    .select("id")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  const [keepProperty, ...extraProperties] = properties || [];
  for (const p of extraProperties) {
    await serviceClient.from("properties").delete().eq("id", p.id);
  }
  return { keepVehicle, keepProperty };
}

const operationsToken = createAccessToken(
  { sub: USERS.operations.id, appRole: USERS.operations.role, email: USERS.operations.email },
  JWT_SECRET,
  3600,
);

async function loadQuoteAggregate(quoteId) {
  const { data: quote, error: quoteErr } = await serviceClient
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();
  if (quoteErr) throw quoteErr;
  const { data: components, error: compErr } = await serviceClient
    .from("quote_policy_components")
    .select("*, quote_coverages(*)")
    .eq("quote_id", quoteId);
  if (compErr) throw compErr;
  return { quote, components: components || [] };
}

async function saveCaseQuote(quoteId, components, dataSource, opts = {}) {
  const { quote } = await loadQuoteAggregate(quoteId);
  const payloadComponents = components.map((c) => {
    const coverageRow = c.quote_coverages?.find((r) => r.validation_status !== "superseded");
    const coverage = coverageRow ? { ...coverageRow.coverage } : {};
    return {
      componentId: c.id,
      productLine: c.product_line,
      assetId: c.asset_id,
      annualPremiumCents: c.annual_premium_cents,
      coverage,
    };
  });
  const res = await invokeEdgeFunction(operationsToken, "save-case-quote", {
    caseId,
    quoteId: quote.id,
    expectedVersion: opts.expectedVersion ?? quote.version,
    saveIntent: opts.saveIntent ?? "validate",
    insurerId: quote.insurer_id,
    state: quote.state,
    isIncumbent: quote.is_incumbent,
    expiresAt: quote.expires_at,
    policyFeesCents: quote.policy_fees_cents || 0,
    paymentFeesCents: quote.payment_fees_cents || 0,
    bundleDiscountCents: quote.bundle_discount_cents || 0,
    cancellationChargeCents: quote.cancellation_charge_cents || 0,
    underwritingConditions: quote.underwriting_conditions || [],
    dataSource,
    components: payloadComponents,
  });
  if (res.error && !opts.expectError) throw new Error(`save-case-quote failed: ${res.error.message}`);
  return res;
}

async function updateAutoLiabilityForCase(cents) {
  const { data: quotes, error: quoteErr } = await serviceClient
    .from("quotes")
    .select("id")
    .eq("case_id", caseId);
  if (quoteErr) throw quoteErr;
  for (const quote of quotes || []) {
    const { components } = await loadQuoteAggregate(quote.id);
    const updatedComponents = components.map((c) => {
      if (c.product_line !== "auto") return c;
      const coverageRow = c.quote_coverages?.find((r) => r.validation_status !== "superseded");
      const updatedCoverage = coverageRow ? { ...coverageRow.coverage, thirdPartyLiabilityCents: cents } : {};
      return { ...c, quote_coverages: [{ ...coverageRow, coverage: updatedCoverage }] };
    });
    await saveCaseQuote(quote.id, updatedComponents, "manual_entry");
  }
}

async function invokeEdgeFunction(token, name, body) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { data: null, error: { message: text, status: resp.status } };
  }
  if (!resp.ok || (data && data.success === false)) {
    return { data: null, error: { message: text, status: resp.status, code: data?.code } };
  }
  return { data, error: null };
}

async function invokeSaveMandate(payload) {
  const token = createAccessToken(
    { sub: USERS.customer.id, appRole: USERS.customer.role, email: USERS.customer.email },
    JWT_SECRET,
    3600,
  );
  return invokeEdgeFunction(token, "save-household-mandate", payload);
}

async function invokeGenerateRecommendation() {
  const token = createAccessToken(
    { sub: USERS.operations.id, appRole: USERS.operations.role, email: USERS.operations.email },
    JWT_SECRET,
    3600,
  );
  return invokeEdgeFunction(token, "recommendation-generator", { caseId });
}

async function expectSuccess(label, rpc, args) {
  const { data, error } = await rpc(args);
  if (error) throw new Error(`${label} failed: ${error.message}`);
  if (!data || data.success !== true) throw new Error(`${label} returned non-success: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("Connecting to", SUPABASE_URL);
  assert(serviceClient, "SUPABASE_SERVICE_ROLE_KEY is required");

  await deleteRecommendations();
  await ensureSingleAssetPerLine();
  await setCaseState("comparing_quotes");

  // 1. Customer saves a V2 mandate with a liability requirement that differs from the legacy row.
  const switching0 = await currentSwitchingVersion();
  const initialSave = await invokeSaveMandate(mandatePayload({ liabilityCents: 250000000, version: 0, switchingVersion: switching0.version }));
  if (initialSave.error) {
    console.error("Initial save failed:", initialSave.error);
    const m = await currentMandateRow();
    const s = await currentSwitchingVersion();
    const retry = await invokeSaveMandate(mandatePayload({ liabilityCents: 250000000, version: m?.version ?? 0, switchingVersion: s?.version ?? 0 }));
    if (retry.error) throw new Error(`save-household-mandate failed: ${retry.error.message}`);
    assert(retry.data.success, "mandate save did not succeed");
    console.log("1. Customer saved V2 mandate (retry)", retry.data.mandateVersion);
  } else {
    assert(initialSave.data.success, "mandate save did not succeed");
    console.log("1. Customer saved V2 mandate", initialSave.data.mandateVersion);
  }

  const v2Mandate = await currentMandateRow();
  assert(v2Mandate.household_auto_defaults.liability.amountCents === 250000000, "V2 liability not persisted");
  console.log("   V2 mandate row liability = 2.5M, version", v2Mandate.version);

  const { data: legacyRow } = await serviceClient
    .from("coverage_requirements")
    .select("auto_requirements")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .maybeSingle();
  if (legacyRow) {
    const legacyLiability = legacyRow.auto_requirements?.liability?.cents ?? legacyRow.auto_requirements?.minThirdPartyLiabilityCents;
    assert(legacyLiability === 200000000, `legacy row should remain at 2M (got ${legacyLiability})`);
    console.log("   Legacy coverage_requirements row remains at 2M");
  }

  // 2. Update auto quote coverages to meet the new 2.5M liability requirement.
  await updateAutoLiabilityForCase(250000000);
  console.log("2. Updated auto quote coverages to 2.5M");

  // 2b. Exercise draft save, validate, and stale quote edit rejection.
  const { data: caseQuotes } = await serviceClient.from("quotes").select("id").eq("case_id", caseId);
  if (caseQuotes && caseQuotes.length > 0) {
    const editQuoteId = caseQuotes[0].id;
    const { components: editComponents } = await loadQuoteAggregate(editQuoteId);

    const draftRes = await saveCaseQuote(editQuoteId, editComponents, "manual_entry", { saveIntent: "draft" });
    assert(draftRes.data && draftRes.data.success, "draft save should succeed");
    assert(draftRes.data.aggregateStatus === "draft", "draft save should leave quote in draft status");
    console.log("2b. Quote draft edit saved");

    const { components: draftComponents } = await loadQuoteAggregate(editQuoteId);
    const validateRes = await saveCaseQuote(editQuoteId, draftComponents, "manual_entry", { saveIntent: "validate" });
    assert(validateRes.data && validateRes.data.success, "validate save after draft should succeed");
    assert(validateRes.data.aggregateStatus === "valid", "validate save should restore quote to valid");
    console.log("2c. Quote validated after draft");

    const staleRes = await saveCaseQuote(editQuoteId, draftComponents, "manual_entry", {
      expectedVersion: 1,
      expectError: true,
    });
    assert(staleRes.error, "stale quote edit should be rejected");
    console.log("2d. Stale quote edit rejected");
  }

  // 3. Operations generates a recommendation via the Edge Function.
  const recResult = await invokeGenerateRecommendation();
  if (recResult.error) throw new Error(`recommendation-generator failed: ${recResult.error.message}`);
  assert(recResult.data && recResult.data.recommendationId, "recommendation-generator did not return a recommendationId");
  console.log("3. Generated recommendation", recResult.data.recommendationId, "version", recResult.data.version);

  const { data: recRow } = await serviceClient
    .from("recommendations")
    .select(
      "mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction, switching_preferences_id, switching_preferences_version, status, proposed_total_cents, net_savings_cents",
    )
    .eq("id", recResult.data.recommendationId)
    .single();
  assert(recRow.mandate_id === v2Mandate.id, "recommendation mandate_id mismatch");
  assert(recRow.mandate_version === v2Mandate.version, "recommendation mandate_version mismatch");
  assert(recRow.mandate_schema_version === 2, "recommendation mandate_schema_version not 2");
  assert(recRow.mandate_jurisdiction === "AB", "recommendation mandate_jurisdiction not AB");
  assert(recRow.switching_preferences_id, "recommendation switching_preferences_id missing");
  assert(recRow.status === "awaiting_review", "recommendation status not awaiting_review");
  console.log("4. Recommendation bound to exact V2 snapshot", recRow.mandate_id, "v" + recRow.mandate_version);

  const { data: caseAfterGen } = await serviceClient
    .from("optimization_cases")
    .select("state")
    .eq("id", caseId)
    .single();
  assert(caseAfterGen.state === "licensed_review", `case state after generation: ${caseAfterGen.state}`);
  console.log("5. Case advanced to licensed_review");

  // 6. Reviewer publishes the recommendation.
  await expectSuccess("review_recommendation", (a) => reviewer.rpc("review_recommendation", a), {
    p_recommendation_id: recResult.data.recommendationId,
    p_approved: true,
    p_notes: "Approved by E2E",
  });
  console.log("6. Reviewer published recommendation");

  // 7. Customer changes the V2 mandate (liability to 3M).
  const beforeStale = await currentMandateRow();
  const beforeStaleSwitch = await currentSwitchingVersion();
  const staleSave = await invokeSaveMandate(
    mandatePayload({ liabilityCents: 300000000, version: beforeStale.version, switchingVersion: beforeStaleSwitch.version }),
  );
  if (staleSave.error) throw new Error(`stale mandate save failed: ${staleSave.error.message}`);
  assert(staleSave.data.success, "stale mandate save did not succeed");
  console.log("7. Customer changed V2 mandate to 3M, new version", staleSave.data.mandateVersion);

  // 8. Approval of the stale recommendation must fail.
  const staleApproval = await customer.rpc("approve_customer_recommendation", {
    p_recommendation_id: recResult.data.recommendationId,
    p_expected_rec_version: recResult.data.version,
  });
  assert(staleApproval.error, "approval of stale recommendation should fail");
  console.log("8. Stale recommendation approval rejected:", staleApproval.error.message);

  // 9. Update quotes to meet the new 3M liability and regenerate.
  await updateAutoLiabilityForCase(300000000);
  const rec2Result = await invokeGenerateRecommendation();
  if (rec2Result.error) throw new Error(`second recommendation-generator failed: ${rec2Result.error.message}`);
  assert(rec2Result.data && rec2Result.data.recommendationId, "second recommendation did not return id");
  console.log("9. Regenerated recommendation", rec2Result.data.recommendationId);

  const { data: rec2Row } = await serviceClient
    .from("recommendations")
    .select("mandate_id, mandate_version, switching_preferences_version")
    .eq("id", rec2Result.data.recommendationId)
    .single();
  assert(rec2Row.mandate_version === staleSave.data.mandateVersion, "new recommendation should use new mandate version");

  // 10. Reviewer publishes the replacement recommendation.
  await expectSuccess("review_recommendation", (a) => reviewer.rpc("review_recommendation", a), {
    p_recommendation_id: rec2Result.data.recommendationId,
    p_approved: true,
    p_notes: "Approved after mandate update",
  });
  console.log("10. Reviewer published replacement recommendation");

  // 11. Multi-asset household is rejected by the actual Edge Function.
  const { data: vehicle1 } = await serviceClient
    .from("vehicles")
    .select("id")
    .eq("household_id", householdId)
    .limit(1)
    .maybeSingle();
  if (vehicle1) {
    const { error: addErr } = await serviceClient.from("vehicles").insert({
      id: "22000000-0000-0000-0000-000000000099",
      household_id: householdId,
      year: 2025,
      make: "Extra",
      model: "Vehicle",
      vin: "EXTRA1",
      primary_use: "commute",
    });
    if (addErr) throw addErr;
    const multiAsset = await invokeGenerateRecommendation();
    assert(multiAsset.error, "multi-asset recommendation should be rejected");
    console.log("11. Multi-asset household rejected by Edge Function:", multiAsset.error.message);
    await serviceClient.from("vehicles").delete().eq("id", "22000000-0000-0000-0000-000000000099");
  }

  // 12. Legacy coverage_requirements changes do not influence V2 recommendations.
  const { data: legacyBefore } = await serviceClient
    .from("coverage_requirements")
    .select("id, auto_requirements")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .maybeSingle();
  if (legacyBefore) {
    const legacyAuto = {
      ...legacyBefore.auto_requirements,
      liability: { ...legacyBefore.auto_requirements.liability, amountCents: 500000000 },
    };
    await serviceClient.from("coverage_requirements").update({ auto_requirements: legacyAuto }).eq("id", legacyBefore.id);
    const legacyRec = await invokeGenerateRecommendation();
    assert(legacyRec.data && legacyRec.data.recommendationId, "V2 recommendation should succeed despite legacy change");
    console.log("12. Legacy mandate change did not affect V2 recommendation", legacyRec.data.recommendationId);

    // 13. Reviewer publishes the legacy-unaffected recommendation and customer approves it.
    await expectSuccess("review_recommendation", (a) => reviewer.rpc("review_recommendation", a), {
      p_recommendation_id: legacyRec.data.recommendationId,
      p_approved: true,
      p_notes: "Approved after legacy change",
    });
    const approval = await expectSuccess("approve_customer_recommendation", (a) => customer.rpc("approve_customer_recommendation", a), {
      p_recommendation_id: legacyRec.data.recommendationId,
      p_expected_rec_version: legacyRec.data.version,
    });
    console.log("13. Customer approved final recommendation; switch", approval.switch_event_id);

    // 14. Operations advances the switch to completion.
    const ops2 = clientFor(USERS.operations);
    for (const target of [
      "replacement_pending",
      "replacement_confirmed",
      "incumbent_cancellation_pending",
      "incumbent_cancelled",
      "completed",
    ]) {
      await expectSuccess(`advance_switch_event(${target})`, (a) => ops2.rpc("advance_switch_event", a), {
        p_switch_event_id: approval.switch_event_id,
        p_target_state: target,
      });
    }
    console.log("14. Switch advanced to completed");
  } else {
    console.log("12-14. Skipped legacy-mandate and switch completion tests (no legacy row)");
  }

  // 15. Audit records include V2 mandate identity.
  const { data: audits } = await serviceClient
    .from("audit_events")
    .select("action, after_summary")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const actions = audits.map((a) => a.action);
  for (const expected of ["recommendation_generated", "recommendation_published", "recommendation_approved_by_customer", "switch_event_advanced"]) {
    assert(actions.includes(expected), `missing audit action: ${expected}`);
  }
  const generatedAudit = audits.find((a) => a.action === "recommendation_generated" && a.after_summary?.mandate_id);
  assert(generatedAudit, "generated audit missing V2 mandate identity");
  console.log("15. Audit events contain V2 mandate identity", generatedAudit.after_summary.mandate_id);

  // Negative tests
  console.log("\n--- Negative tests ---");

  // 16. Malformed V2 JSON cannot be persisted.
  const malformed = await invokeSaveMandate({
    householdId,
    expectedMandateVersion: 0,
    expectedSwitchingVersion: 0,
    mandate: { schemaVersion: 2, jurisdiction: "AB", version: 1 },
    switching: {},
  });
  assert(malformed.error, "malformed mandate should be rejected");
  console.log("16. Malformed V2 JSON rejected");

  // 17. Customer cannot call the internal persist RPC directly.
  const internalPersist = await customer.rpc("persist_household_mandate_v2", {
    p_household_id: householdId,
    p_expected_mandate_version: 0,
    p_expected_switching_version: 0,
    p_household_auto_defaults: {},
    p_household_property_defaults: {},
    p_vehicle_overrides: [],
    p_property_overrides: [],
    p_switching_preferences: {},
    p_jurisdiction: "AB",
  });
  assert(internalPersist.error, "customer should not be able to call internal persist RPC");
  console.log("17. Customer internal persist RPC denied");

  // 18. Duplicate override asset IDs are rejected.
  const duplicatePayload = mandatePayload({
    liabilityCents: 250000000,
    version: staleSave.data.mandateVersion,
    switchingVersion: staleSave.data.switchingVersion,
  });
  duplicatePayload.mandate.vehicleOverrides = [
    { vehicleId: "22000000-0000-0000-0000-000000000001", values: { liability: { rule: "minimum", amountCents: 100000000 } } },
    { vehicleId: "22000000-0000-0000-0000-000000000001", values: { liability: { rule: "minimum", amountCents: 100000000 } } },
  ];
  const duplicateSave = await invokeSaveMandate(duplicatePayload);
  assert(duplicateSave.error, "duplicate vehicle overrides should be rejected");
  console.log("18. Duplicate override asset IDs rejected");

  // 19. Cross-household override is rejected.
  const { data: otherVehicle } = await serviceClient
    .from("vehicles")
    .select("id")
    .neq("household_id", householdId)
    .limit(1)
    .maybeSingle();
  if (otherVehicle) {
    const crossPayload = mandatePayload({
      liabilityCents: 250000000,
      version: staleSave.data.mandateVersion,
      switchingVersion: staleSave.data.switchingVersion,
    });
    crossPayload.mandate.vehicleOverrides = [{ vehicleId: otherVehicle.id, values: { liability: { rule: "minimum", amountCents: 100000000 } } }];
    const crossSave = await invokeSaveMandate(crossPayload);
    assert(crossSave.error, "cross-household vehicle override should be rejected");
    console.log("19. Cross-household override rejected");
  } else {
    console.log("19. Skipped cross-household override (no other vehicle found)");
  }

  console.log("\nV2 mandate lifecycle E2E passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
