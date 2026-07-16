import { describe, expect, it } from "vitest";
import {
  AutoMandateV2,
  HouseholdCoverageMandateV2,
  MonetaryRule,
  PropertyMandateV2,
  SwitchingPreferencesV2,
  createDefaultAutoMandateV2,
  createDefaultHouseholdCoverageMandateV2,
  createDefaultPropertyMandateV2,
  createDefaultSwitchingPreferencesV2,
  resolvePropertyMandateV2,
  resolveVehicleMandateV2,
  updateVehicleOverrideV2,
  clearVehicleOverrideV2,
} from "../src/mandate-v2";
import { switchingRowToDomain, switchingDomainToRow } from "../src/mandate-adapters";

describe("mandate v2 factory", () => {
  it("produces a valid complete mandate", () => {
    const mandate = createDefaultHouseholdCoverageMandateV2();
    expect(HouseholdCoverageMandateV2.parse(mandate)).toEqual(mandate);
  });

  it("returns independent nested objects on each call", () => {
    const first = createDefaultHouseholdCoverageMandateV2();
    const second = createDefaultHouseholdCoverageMandateV2();
    expect(first.householdAutoDefaults.endorsements).not.toBe(
      second.householdAutoDefaults.endorsements,
    );
    expect(first.householdPropertyDefaults.optionalCoverages).not.toBe(
      second.householdPropertyDefaults.optionalCoverages,
    );
    expect(first.householdPropertyDefaults.sewerBackup).not.toBe(
      second.householdPropertyDefaults.sewerBackup,
    );
  });

  it("does not share nested references after mutation", () => {
    const first = createDefaultHouseholdCoverageMandateV2();
    const second = createDefaultHouseholdCoverageMandateV2();
    first.householdAutoDefaults.endorsements.telematics = "required";
    expect(second.householdAutoDefaults.endorsements.telematics).toBe("indifferent");
  });

  it("requires schemaVersion 2 and jurisdiction AB", () => {
    const base = createDefaultHouseholdCoverageMandateV2();
    expect(() => HouseholdCoverageMandateV2.parse({ ...base, schemaVersion: 1 })).toThrow();
    expect(() => HouseholdCoverageMandateV2.parse({ ...base, jurisdiction: "ON" })).toThrow();
  });

  it("requires a positive integer version", () => {
    const base = createDefaultHouseholdCoverageMandateV2();
    expect(() => HouseholdCoverageMandateV2.parse({ ...base, version: 0 })).toThrow();
    expect(() => HouseholdCoverageMandateV2.parse({ ...base, version: 1.5 })).toThrow();
  });

  it("requires an ISO datetime for effectiveFrom", () => {
    const base = createDefaultHouseholdCoverageMandateV2();
    expect(() =>
      HouseholdCoverageMandateV2.parse({ ...base, effectiveFrom: "2026-07-16" }),
    ).toThrow();
  });
});

describe("monetary rule v2", () => {
  it("accepts amount rules with amountCents", () => {
    expect(MonetaryRule.parse({ rule: "minimum", amountCents: 200_000_000 })).toEqual({
      rule: "minimum",
      amountCents: 200_000_000,
    });
    expect(MonetaryRule.parse({ rule: "maximum", amountCents: 100_000 })).toEqual({
      rule: "maximum",
      amountCents: 100_000,
    });
    expect(MonetaryRule.parse({ rule: "exact", amountCents: 50 })).toEqual({
      rule: "exact",
      amountCents: 50,
    });
  });

  it("rejects missing amountCents on amount rules", () => {
    expect(() => MonetaryRule.parse({ rule: "minimum" })).toThrow();
    expect(() => MonetaryRule.parse({ rule: "exact" })).toThrow();
  });

  it("rejects amountCents on non-amount rules", () => {
    expect(() =>
      MonetaryRule.parse({ rule: "match_current_or_better", amountCents: 100 }),
    ).toThrow();
    expect(() => MonetaryRule.parse({ rule: "any", amountCents: 100 })).toThrow();
  });

  it("accepts non-amount rules without amountCents", () => {
    expect(MonetaryRule.parse({ rule: "match_current_or_better" })).toEqual({
      rule: "match_current_or_better",
    });
    expect(MonetaryRule.parse({ rule: "any" })).toEqual({ rule: "any" });
  });

  it("rejects negative or non-integer amounts", () => {
    expect(() => MonetaryRule.parse({ rule: "minimum", amountCents: -1 })).toThrow();
    expect(() => MonetaryRule.parse({ rule: "minimum", amountCents: 1.5 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() =>
      MonetaryRule.parse({ rule: "minimum", amountCents: 100, extra: 1 } as never),
    ).toThrow();
  });
});

describe("auto mandate v2", () => {
  it("rejects vehicle risk facts embedded in the mandate", () => {
    const base = createDefaultAutoMandateV2();
    expect(() => AutoMandateV2.parse({ ...base, vehicleClass: "personal" } as never)).toThrow();
    expect(() => AutoMandateV2.parse({ ...base, financingStatus: "financed" } as never)).toThrow();
  });
});

describe("property mandate v2", () => {
  it("rejects property type embedded in the mandate", () => {
    const base = createDefaultPropertyMandateV2();
    expect(() =>
      PropertyMandateV2.parse({ ...base, propertyType: "homeowner" } as never),
    ).toThrow();
  });
});

describe("override resolvers", () => {
  it("return defaults when no override is provided", () => {
    const defaults = createDefaultAutoMandateV2();
    expect(resolveVehicleMandateV2(defaults, undefined)).toEqual(defaults);
  });

  it("merge a single nested override while preserving defaults", () => {
    const defaults = createDefaultAutoMandateV2();
    const override = {
      vehicleId: "11111111-1111-1111-1111-111111111111",
      values: { liability: { rule: "exact" as const, amountCents: 1_000_000_000 } },
    };
    const resolved = resolveVehicleMandateV2(defaults, override);
    expect(resolved.liability).toEqual({ rule: "exact", amountCents: 1_000_000_000 });
    expect(resolved.coverageForm).toEqual(defaults.coverageForm);
    expect(resolved.endorsements.telematics).toBe("indifferent");
  });

  it("merge partial endorsement overrides", () => {
    const defaults = createDefaultAutoMandateV2();
    const override = {
      vehicleId: "11111111-1111-1111-1111-111111111111",
      values: { endorsements: { accident_forgiveness: "required" as const } },
    };
    const resolved = resolveVehicleMandateV2(defaults, override);
    expect(resolved.endorsements.accident_forgiveness).toBe("required");
    expect(resolved.endorsements.telematics).toBe("indifferent");
  });

  it("do not mutate input objects", () => {
    const defaults = createDefaultAutoMandateV2();
    const override = {
      vehicleId: "11111111-1111-1111-1111-111111111111",
      values: { liability: { rule: "exact" as const, amountCents: 1_000_000_000 } },
    };
    const before = JSON.stringify(defaults);
    resolveVehicleMandateV2(defaults, override);
    expect(JSON.stringify(defaults)).toBe(before);
  });

  it("can remove an override to restore defaults", () => {
    const defaults = createDefaultAutoMandateV2();
    const mandate = updateVehicleOverrideV2(
      createDefaultHouseholdCoverageMandateV2(),
      "11111111-1111-1111-1111-111111111111",
      { liability: { rule: "exact" as const, amountCents: 1_000_000_000 } },
    );
    expect(resolveVehicleMandateV2(defaults, mandate.vehicleOverrides[0]).liability).toEqual({
      rule: "exact",
      amountCents: 1_000_000_000,
    });
    const cleared = clearVehicleOverrideV2(mandate, "11111111-1111-1111-1111-111111111111");
    expect(cleared.vehicleOverrides).toHaveLength(0);
  });

  it("resolve property overrides independently", () => {
    const defaults = createDefaultPropertyMandateV2();
    const override = {
      propertyId: "22222222-2222-2222-2222-222222222222",
      values: { dwellingLimit: { rule: "exact" as const, amountCents: 500_000_000 } },
    };
    const resolved = resolvePropertyMandateV2(defaults, override);
    expect(resolved.dwellingLimit).toEqual({ rule: "exact", amountCents: 500_000_000 });
    expect(resolved.coverageForm).toEqual(defaults.coverageForm);
  });
});

describe("switching preference mapping", () => {
  it("round-trips all fields between row and domain", () => {
    const domain = createDefaultSwitchingPreferencesV2();
    const row = switchingDomainToRow(domain);
    expect(switchingRowToDomain(row)).toEqual(domain);
  });

  it("ignores extra row fields without resetting defaults", () => {
    const row = {
      ...switchingDomainToRow(createDefaultSwitchingPreferencesV2()),
      unknown_column: 123,
    };
    const domain = switchingRowToDomain(row);
    expect(domain.minNetAnnualSavingsCents).toBe(20_000);
  });
});
