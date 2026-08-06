import {
  displayValueForField,
  formatFieldLabel,
  formatFieldValue,
  getEffectiveDisplay,
  getExistingAssetDisplay,
  getFieldValue,
  getInitialDecision,
  parseCorrectedValue,
  renderCents,
} from "@/lib/review-entities-helpers";
import type { ExtractionCandidate } from "@/lib/extraction";

const propertyCandidate = (occupancy: string): ExtractionCandidate =>
  ({
    id: "c1",
    session_id: "s1",
    household_id: "h1",
    asset_type: "property",
    identity_fingerprint: "fp1",
    display_label: "Test",
    occupancy,
    match_classification: "new",
    decision: "pending",
    review_status: "pending",
    selected_facts_json: {
      identity: {
        fullAddress: "CALGARY AB T3A 0G9",
        occupancy,
      },
      currentPolicy: {
        insurer: "Security National Insurance Company",
        policyNumber: "0000",
        expiryDate: "2026-12-31",
        annualPremiumCents: 274700,
      },
    },
    conflicts_json: [],
  }) as ExtractionCandidate;

describe("review-entities display helpers", () => {
  it("maps occupancy variable names to customer-facing labels", () => {
    expect(displayValueForField("identity.occupancy", "principal_residence")).toBe(
      "Principal residence",
    );
    expect(displayValueForField("identity.occupancy", "rental")).toBe("Rental");
    expect(displayValueForField("identity.occupancy", "unknown")).toBe("Unknown");
    expect(displayValueForField("identity.occupancy", "Rental")).toBe("Rental");
  });

  it("maps vehicleUse variable names to customer-facing labels", () => {
    expect(displayValueForField("identity.vehicleUse", "pleasure")).toBe("Pleasure");
    expect(displayValueForField("identity.vehicleUse", "commute")).toBe("Commute");
    expect(displayValueForField("identity.vehicleUse", "business")).toBe("Business");
  });

  it("formats cents as C$ currency", () => {
    expect(displayValueForField("currentPolicy.annualPremiumCents", 274700)).toBe("C$2747.00");
    expect(renderCents(0)).toBe("C$0.00");
    expect(renderCents(null)).toBe("—");
  });

  it("formats raw booleans and missing values", () => {
    expect(formatFieldValue(true)).toBe("Yes");
    expect(formatFieldValue(false)).toBe("No");
    expect(formatFieldValue(null)).toBe("—");
  });

  it("parses corrected premium values back to cents", () => {
    expect(parseCorrectedValue("currentPolicy.annualPremiumCents", "C$2,747.00")).toBe(274700);
    expect(parseCorrectedValue("currentPolicy.annualPremiumCents", "500")).toBe(50000);
    expect(parseCorrectedValue("identity.occupancy", "Rental")).toBe("Rental");
  });

  it("produces customer-facing field labels", () => {
    expect(formatFieldLabel("identity.fullAddress")).toBe("Address");
    expect(formatFieldLabel("identity.vehicleUse")).toBe("Vehicle use");
    expect(formatFieldLabel("currentPolicy.annualPremiumCents")).toBe("Annual premium");
    expect(formatFieldLabel("identity.postalCode")).toBe("Postal code");
    expect(formatFieldLabel("identity.model")).toBe("Model");
  });

  it("reads nested candidate field values", () => {
    const candidate = propertyCandidate("principal_residence");
    expect(getFieldValue(candidate, "identity.occupancy")).toBe("principal_residence");
    expect(getFieldValue(candidate, "currentPolicy.annualPremiumCents")).toBe(274700);
    expect(getFieldValue(candidate, "missing.path")).toBeUndefined();
  });

  it("shows customer-facing display even when the customer marks a field as unsure", () => {
    const candidate = propertyCandidate("principal_residence");
    expect(
      getEffectiveDisplay(candidate, "identity.occupancy", {
        action: "unknown",
        mandateRule: "",
        mandateAmount: "",
      }),
    ).toBe("Principal residence");
    expect(
      getEffectiveDisplay(candidate, "identity.occupancy", {
        action: "confirm",
        mandateRule: "",
        mandateAmount: "",
      }),
    ).toBe("Principal residence");
  });

  it("uses the corrected value only for the correct action", () => {
    const candidate = propertyCandidate("principal_residence");
    expect(
      getEffectiveDisplay(candidate, "identity.occupancy", {
        action: "correct",
        correctedValue: "Rental",
        mandateRule: "",
        mandateAmount: "",
      }),
    ).toBe("Rental");
  });

  it("defaults exact existing matches to link_existing and preserves a persisted decision", () => {
    const candidate = {
      ...propertyCandidate("principal_residence"),
      match_classification: "exact_existing_match",
      draft_decision: "link_existing" as const,
      draft_existing_asset_id: "existing-1",
      draft_existing_asset_type: "property" as const,
    };
    expect(getInitialDecision(candidate)).toBe("link_existing");
  });

  it("requires explicit confirmation for possible existing matches", () => {
    const candidate = {
      ...propertyCandidate("principal_residence"),
      match_classification: "possible_existing_match",
      draft_decision: "link_existing" as const,
      draft_existing_asset_id: "existing-1",
      draft_existing_asset_type: "property" as const,
    };
    expect(getInitialDecision(candidate)).toBeNull();
  });

  it("does not overwrite a persisted needs_correction decision", () => {
    const candidate = {
      ...propertyCandidate("principal_residence"),
      match_classification: "new_identity_confirmation_required" as const,
      draft_decision: "needs_correction" as const,
    };
    expect(getInitialDecision(candidate)).toBe("needs_correction");
  });

  it("falls back to approve_new for new candidates", () => {
    const candidate = {
      ...propertyCandidate("principal_residence"),
      match_classification: "new" as const,
      draft_decision: null,
    };
    expect(getInitialDecision(candidate)).toBe("approve_new");
  });

  it("extracts existing asset display from selected_facts_json", () => {
    const candidate = {
      ...propertyCandidate("principal_residence"),
      selected_facts_json: {
        existingAsset: {
          id: "existing-1",
          asset_type: "property",
          display_label: "123 Main St",
        },
      },
    };
    const existingAsset = getExistingAssetDisplay(candidate as unknown as ExtractionCandidate);
    expect(existingAsset?.id).toBe("existing-1");
    expect(existingAsset?.display_label).toBe("123 Main St");
  });
});
