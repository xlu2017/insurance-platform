// Public validation layer for saving a customer's V2 coverage mandate.
// Authenticates the customer, validates the request with the canonical Zod
// schemas, checks household ownership and asset associations, then delegates
// persistence to the service-role-only persist_household_mandate_v2 RPC.
import { createClient } from "npm:@supabase/supabase-js@2";
import { HouseholdCoverageMandateV2, SwitchingPreferencesV2 } from "../_shared/autopilot.js";

interface SaveMandateRequest {
  householdId: string;
  expectedMandateVersion: number;
  expectedSwitchingVersion: number;
  mandate: unknown;
  switching: unknown;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "Only POST is allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ code: "UNAUTHORIZED", message: "Missing bearer token" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return jsonResponse({ code: "UNAUTHORIZED", message: "Invalid or expired session" }, 401);
  }

  let body: SaveMandateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: "INVALID_JSON", message: "Request body is not valid JSON" }, 400);
  }

  if (!body.householdId) {
    return jsonResponse({ code: "MISSING_HOUSEHOLD_ID", message: "householdId is required" }, 400);
  }

  // Verify the caller is a member of the household.
  const { data: membership, error: membershipErr } = await userClient
    .from("household_members")
    .select("profile_id")
    .eq("household_id", body.householdId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membershipErr || !membership) {
    console.error("membership check failed", {
      userId: user.id,
      householdId: body.householdId,
      membershipErr,
      membership,
    });
    return jsonResponse(
      { code: "FORBIDDEN", message: "You do not have access to this household" },
      403,
    );
  }

  // Validate canonical V2 mandate and switching shapes.
  const mandateResult = HouseholdCoverageMandateV2.safeParse(body.mandate);
  if (!mandateResult.success) {
    return jsonResponse(
      {
        code: "INVALID_MANDATE",
        message: "Mandate validation failed",
        errors: mandateResult.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  }
  const mandate = mandateResult.data;

  const switchingResult = SwitchingPreferencesV2.safeParse(body.switching);
  if (!switchingResult.success) {
    return jsonResponse(
      {
        code: "INVALID_SWITCHING_PREFERENCES",
        message: "Switching preferences validation failed",
        errors: switchingResult.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  }
  const switching = switchingResult.data;

  // Reject duplicate override asset IDs.
  const vehicleIds = mandate.vehicleOverrides.map((o) => o.vehicleId);
  const propertyIds = mandate.propertyOverrides.map((o) => o.propertyId);
  if (new Set(vehicleIds).size !== vehicleIds.length) {
    return jsonResponse(
      { code: "DUPLICATE_VEHICLE_OVERRIDE", message: "Duplicate vehicle override IDs" },
      400,
    );
  }
  if (new Set(propertyIds).size !== propertyIds.length) {
    return jsonResponse(
      { code: "DUPLICATE_PROPERTY_OVERRIDE", message: "Duplicate property override IDs" },
      400,
    );
  }

  // Verify every override references an asset in the household.
  if (vehicleIds.length > 0) {
    const { data: vehicles, error: vehicleErr } = await userClient
      .from("vehicles")
      .select("id")
      .eq("household_id", body.householdId)
      .in("id", vehicleIds);
    if (vehicleErr) {
      return jsonResponse({ code: "ASSET_LOOKUP_FAILED", message: vehicleErr.message }, 500);
    }
    const found = new Set(vehicles?.map((v) => v.id) ?? []);
    for (const id of vehicleIds) {
      if (!found.has(id)) {
        return jsonResponse(
          {
            code: "INVALID_VEHICLE_OVERRIDE",
            message: `Vehicle ${id} does not belong to household`,
          },
          400,
        );
      }
    }
  }

  if (propertyIds.length > 0) {
    const { data: properties, error: propertyErr } = await userClient
      .from("properties")
      .select("id")
      .eq("household_id", body.householdId)
      .in("id", propertyIds);
    if (propertyErr) {
      return jsonResponse({ code: "ASSET_LOOKUP_FAILED", message: propertyErr.message }, 500);
    }
    const found = new Set(properties?.map((p) => p.id) ?? []);
    for (const id of propertyIds) {
      if (!found.has(id)) {
        return jsonResponse(
          {
            code: "INVALID_PROPERTY_OVERRIDE",
            message: `Property ${id} does not belong to household`,
          },
          400,
        );
      }
    }
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await adminClient.rpc("persist_household_mandate_v2", {
    p_household_id: body.householdId,
    p_expected_mandate_version: body.expectedMandateVersion,
    p_expected_switching_version: body.expectedSwitchingVersion,
    p_household_auto_defaults: mandate.householdAutoDefaults,
    p_household_property_defaults: mandate.householdPropertyDefaults,
    p_vehicle_overrides: mandate.vehicleOverrides,
    p_property_overrides: mandate.propertyOverrides,
    p_switching_preferences: switching,
    p_jurisdiction: mandate.jurisdiction,
    p_created_by: user.id,
  });

  if (error) {
    return jsonResponse(
      {
        code: error.code === "P0001" ? "STALE_VERSION" : "PERSIST_FAILED",
        message: error.message,
        details: error.details,
      },
      409,
    );
  }

  return jsonResponse({ success: true, ...data });
});
