import { describe, expect, it } from "vitest";
import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  documentProcessingRoute,
  validateDangerousModeEnablePolicy,
} from "../src/dangerous-mode-policy.ts";

const valid = {
  explicitConfirmation: true,
  foreignProcessingAcknowledged: true,
  automatedProcessingAcknowledged: true,
  rawProcessingApproved: true,
  disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
};

describe("Dangerous mode enable policy", () => {
  it("routes safe-mode batches to manual review with zero external dispatches", () => {
    let externalCalls = 0;
    const route = documentProcessingRoute("safe");
    if (route.dispatchExternalProcessing) externalCalls += 1;
    expect(route.route).toBe("manual_review");
    expect(externalCalls).toBe(0);
  });

  it("requires every explicit processing acknowledgement", () => {
    expect(validateDangerousModeEnablePolicy({ ...valid, rawProcessingApproved: false })).toBe(
      "ACKNOWLEDGEMENTS_REQUIRED",
    );
  });

  it("requires the current versioned disclosure", () => {
    expect(validateDangerousModeEnablePolicy({ ...valid, disclosureVersion: "old" })).toBe(
      "DISCLOSURE_VERSION_MISMATCH",
    );
  });

  it("passes with explicit consent and matching disclosure", () => {
    expect(validateDangerousModeEnablePolicy(valid)).toBeNull();
  });
});
