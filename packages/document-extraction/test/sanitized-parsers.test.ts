import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "../src/parsers";
import type { ExtractedPdf } from "../src/types";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

function makePdf(text: string): ExtractedPdf {
  return {
    documentId: "sanitized-doc-1",
    fileDigest: "abc123",
    pageCount: 1,
    pages: [{ pageNumber: 1, text, items: [] }],
  };
}

function factByPath(result: ReturnType<typeof parseDocument>, path: string) {
  return result.assetAssertions[0]?.assertions.find((a) => a.fieldPath === path)?.normalizedValue;
}

describe("sanitized TD home parser", () => {
  it("classifies a rental home renewal and extracts key facts", () => {
    const result = parseDocument(makePdf(fixture("sanitized-rental-home.txt")));
    expect(result.classification).toBe("home_policy_renewal");
    expect(result.parserId).toBe("TdSecurityNationalHomeRenewalParserV1");
    expect(result.assetAssertions.length).toBe(1);

    const property = result.assetAssertions[0];
    expect(property.assetType).toBe("property");
    expect(property.occupancy).toBe("rental");
    expect(property.displayLabel).toContain("Calgary");
    expect(property.displayLabel).toContain("T3A 0Z4");
    expect(property.matchClassification).toBe("new");

    expect(factByPath(result, "policy.annualPremiumCents")).toBe(294000);
    expect(factByPath(result, "policy.policyNumber")).toBe("001061650");
    expect(factByPath(result, "property.dwellingLimitCents")).toBe(43800000);
    expect(factByPath(result, "property.fairRentalValueLimitCents")).toBe(8900000);
  });

  it("flags a redacted principal residence for identity confirmation", () => {
    const text = [
      "Security National Insurance Company",
      "Coverage Summary Page",
      "Overview of your home insurance renewal",
      "YOUR HOMEOWNER PACKAGE:",
      "CALGARY AB T3A 0Z4",
      "Coverage A - Dwelling Building: $438,000",
    ].join("\n");

    const result = parseDocument(makePdf(text));
    expect(result.classification).toBe("home_policy_renewal");
    const property = result.assetAssertions[0];
    expect(property?.occupancy).toBe("principal_residence");
    expect(property?.matchClassification).toBe("new_identity_confirmation_required");
  });
});

describe("sanitized TD auto parser", () => {
  it("classifies an Alberta auto renewal and extracts vehicle identity", () => {
    const result = parseDocument(makePdf(fixture("sanitized-auto.txt")));
    expect(result.classification).toBe("auto_policy_renewal");
    expect(result.parserId).toBe("TdSecurityNationalAlbertaAutoRenewalParserV1");
    expect(result.assetAssertions.length).toBe(1);

    const vehicle = result.assetAssertions[0];
    expect(vehicle.assetType).toBe("vehicle");
    expect(vehicle.displayLabel).toContain("2006 MAZDA MAZDA5 GT 5DR");
    expect(vehicle.identityFingerprint).toContain("JM1CR");
  });
});
