// Household-scoped Dangerous mode lifecycle. Provider/model identity is retained
// only in protected service-role tables and never returned to the mobile client.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  validateDangerousModeEnablePolicy,
} from "../_shared/document-extraction.js";

const DISCLOSURE_VERSION = DANGEROUS_MODE_DISCLOSURE_VERSION;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(message: string, status: number, code = "DANGEROUS_MODE_UPDATE_FAILED") {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function publicSetting(setting?: Record<string, unknown> | null) {
  return {
    enabled: setting?.dangerous_mode_enabled === true || setting?.enabled === true,
    disclosure_version: String(setting?.disclosure_version ?? DISCLOSURE_VERSION),
    enabled_at: setting?.enabled_at ? String(setting.enabled_at) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

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
  if (!user) return jsonError("Unauthorized", 401, "UNAUTHORIZED");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const action = String(body.action ?? "");
  const householdId = String(body.household_id ?? "");
  if (!isUuid(householdId)) return jsonError("Invalid household_id", 400);

  const { data: household } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return jsonError("Household not found", 404);

  const { data: current } = await admin
    .from("household_document_processing_settings")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();
  if (action === "get") return jsonResponse(publicSetting(current));

  if (action === "enable") {
    const disclosureVersion = String(body.disclosure_version ?? "");
    const explicitConfirmation = body.explicit_confirmation === true;
    const foreignAcknowledged = body.foreign_processing_acknowledged === true;
    const automatedAcknowledged = body.automated_processing_acknowledged === true;
    const rawApproved = body.raw_processing_approved === true;
    const policyFailure = validateDangerousModeEnablePolicy({
      explicitConfirmation,
      foreignProcessingAcknowledged: foreignAcknowledged,
      automatedProcessingAcknowledged: automatedAcknowledged,
      rawProcessingApproved: rawApproved,
      disclosureVersion,
    });
    if (
      policyFailure === "ACKNOWLEDGEMENTS_REQUIRED" ||
      policyFailure === "DISCLOSURE_VERSION_MISMATCH"
    ) {
      return jsonError("Every Dangerous mode acknowledgement is required", 400);
    }
    // Active authentication plus explicit versioned consent is sufficient for
    // the closed pilot. A separate step-up credential is not required.

    const processorContractVersion = Deno.env.get("PROCESSOR_CONTRACT_VERSION") ?? "";
    const configuredModel =
      Deno.env.get("DOCUMENT_MODEL_PRIMARY") ??
      Deno.env.get("GEMINI_MODEL_ID") ??
      Deno.env.get("KIMI_MODEL_ID") ??
      "";
    const configuredProvider =
      String(Deno.env.get("CONFIGURED_PROVIDER") ?? "").toLowerCase() ||
      (configuredModel.toLowerCase().includes("gemini") ||
      configuredModel.toLowerCase().includes("flash")
        ? "gemini"
        : configuredModel.toLowerCase().includes("kimi")
          ? "kimi-k3"
          : "");
    if (!configuredModel || !configuredProvider) {
      return jsonError("Automatic document processing is not configured", 503);
    }
    if (!processorContractVersion) {
      return jsonError("Document processor terms are not configured", 503);
    }

    const { data: updated, error: updateError } = await supabase.rpc("enable_dangerous_mode_v1", {
      p_household_id: householdId,
      p_disclosure_version: disclosureVersion,
      p_processor_contract_version: processorContractVersion,
      p_configured_provider: configuredProvider,
      p_configured_model_id: configuredModel,
      p_explicit_confirmation: true,
      p_foreign_processing_acknowledged: true,
      p_automated_processing_acknowledged: true,
      p_raw_processing_approved: true,
    });
    if (updateError || !updated) return jsonError("Failed to enable Dangerous mode", 500);
    return jsonResponse(publicSetting(updated as Record<string, unknown>));
  }

  if (action === "disable") {
    if (!current?.dangerous_mode_enabled) return jsonResponse(publicSetting(current));
    const { data: updated, error: updateError } = await supabase.rpc("disable_dangerous_mode_v1", {
      p_household_id: householdId,
    });
    if (updateError || !updated) return jsonError("Failed to disable Dangerous mode", 500);
    return jsonResponse(publicSetting(updated as Record<string, unknown>));
  }

  return jsonError("Invalid action", 400);
});
