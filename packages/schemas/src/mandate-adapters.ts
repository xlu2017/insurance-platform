import {
  type AutoMandateV2,
  type HouseholdCoverageMandateV2,
  type MonetaryRule,
  type PropertyMandateV2,
  type VehicleMandateOverrideV2,
  type PropertyMandateOverrideV2,
  type AutoMandateOverrideValuesV2,
  type PropertyMandateOverrideValuesV2,
  type WaterCoverageRequirementV2,
  SwitchingPreferencesV2,
  createDefaultSwitchingPreferencesV2,
  resolveVehicleMandateV2,
  resolvePropertyMandateV2,
} from "./mandate-v2";
import {
  type AutoRequirements,
  type HouseholdMandate,
  type PropertyRequirements,
  type SwitchingPreferences,
  type WaterCoverageRequirement,
} from "./mandate";
import { LimitRule, DeductibleRule, CoveragePreference } from "./enums";
import {
  LimitRequirement,
  DeductibleRequirement,
  AutoCoverageFormRequirement,
  PropertyCoverageFormRequirement,
  PropertySettlementRequirement,
  AutoEndorsementPreferences,
  PropertyOptionalCoveragePreferences,
  AutoEndorsementKey,
  PropertyOptionalCoverageKey,
  AssetAutoOverride,
  AssetPropertyOverride,
} from "./mandate";

// =============================================================================
// Monetary-rule conversion helpers
// =============================================================================

interface LegacyMonetaryRuleInput {
  rule: unknown;
  cents?: unknown;
}

export function monetaryRuleV2ToLegacyLimit(rule: MonetaryRule): LimitRequirement {
  const r = LimitRule.parse(rule.rule);
  const cents = "amountCents" in rule ? rule.amountCents : 0;
  return LimitRequirement.parse({ rule: r, cents });
}

export function monetaryRuleV2ToLegacyDeductible(rule: MonetaryRule): DeductibleRequirement {
  const r = DeductibleRule.parse(rule.rule);
  const cents = "amountCents" in rule ? rule.amountCents : 0;
  return DeductibleRequirement.parse({ rule: r, cents });
}

export function legacyMonetaryRuleToV2(input: LegacyMonetaryRuleInput): MonetaryRule {
  const rule = LimitRule.parse(input.rule);
  const cents = input.cents;

  if (rule === "minimum" || rule === "maximum" || rule === "exact") {
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) {
      throw new Error(`Monetary rule "${rule}" requires a non-negative integer amountCents`);
    }
    return { rule, amountCents: cents };
  }

  if (cents !== undefined && cents !== null && cents !== 0) {
    throw new Error(`Monetary rule "${rule}" does not accept an amount`);
  }
  return { rule };
}

// =============================================================================
// V2 mandate -> legacy engine mandate
// =============================================================================

function v2WaterToLegacy(water: {
  preference: CoveragePreference;
  limit: MonetaryRule;
  deductible: MonetaryRule;
}): WaterCoverageRequirement {
  return {
    preference: water.preference,
    limit: monetaryRuleV2ToLegacyLimit(water.limit),
    deductible: monetaryRuleV2ToLegacyDeductible(water.deductible),
  };
}

export function v2AutoMandateToLegacy(auto: AutoMandateV2): AutoRequirements {
  return {
    coverageForm: AutoCoverageFormRequirement.parse(auto.coverageForm),
    liability: monetaryRuleV2ToLegacyLimit(auto.liability),
    collisionDeductible: monetaryRuleV2ToLegacyDeductible(auto.collisionDeductible),
    comprehensiveDeductible: monetaryRuleV2ToLegacyDeductible(auto.comprehensiveDeductible),
    glassDeductible: monetaryRuleV2ToLegacyDeductible(auto.glassDeductible),
    endorsements: AutoEndorsementPreferences.parse(auto.endorsements),
  };
}

function v2PropertyMandateToLegacy(property: PropertyMandateV2): PropertyRequirements {
  return {
    coverageForm: PropertyCoverageFormRequirement.parse(property.coverageForm),
    settlementBasis: PropertySettlementRequirement.parse(property.settlementBasis),
    dwellingLimit: monetaryRuleV2ToLegacyLimit(property.dwellingLimit),
    contentsLimit: monetaryRuleV2ToLegacyLimit(property.contentsLimit),
    detachedStructuresLimit: monetaryRuleV2ToLegacyLimit(property.detachedStructuresLimit),
    personalLiabilityLimit: monetaryRuleV2ToLegacyLimit(property.personalLiabilityLimit),
    additionalLivingExpenseLimit: monetaryRuleV2ToLegacyLimit(
      property.additionalLivingExpenseLimit,
    ),
    baseDeductible: monetaryRuleV2ToLegacyDeductible(property.baseDeductible),
    waterDeductible: monetaryRuleV2ToLegacyDeductible(property.waterDeductible),
    windHailDeductible: monetaryRuleV2ToLegacyDeductible(property.windHailDeductible),
    earthquakeDeductible: monetaryRuleV2ToLegacyDeductible(property.earthquakeDeductible),
    sewerBackup: v2WaterToLegacy(property.sewerBackup),
    overlandWater: v2WaterToLegacy(property.overlandWater),
    optionalCoverages: PropertyOptionalCoveragePreferences.parse(property.optionalCoverages),
  };
}

function v2ResolvedAutoMandateToLegacy(resolved: AutoMandateV2): AutoRequirements {
  return v2AutoMandateToLegacy(resolved);
}

function v2ResolvedPropertyMandateToLegacy(resolved: PropertyMandateV2): PropertyRequirements {
  return v2PropertyMandateToLegacy(resolved);
}

function collectVehicleIds(v2: HouseholdCoverageMandateV2): Set<string> {
  return new Set(v2.vehicleOverrides.map((o) => o.vehicleId));
}

function collectPropertyIds(v2: HouseholdCoverageMandateV2): Set<string> {
  return new Set(v2.propertyOverrides.map((o) => o.propertyId));
}

export function mandateV2ToEngineMandate(
  v2: HouseholdCoverageMandateV2,
  switching?: SwitchingPreferencesV2,
): HouseholdMandate {
  const vehicleOverrides: Record<string, AssetAutoOverride> = {};
  for (const vehicleId of collectVehicleIds(v2)) {
    const resolved = resolveVehicleMandateV2(
      v2.householdAutoDefaults,
      v2.vehicleOverrides.find((o) => o.vehicleId === vehicleId),
    );
    vehicleOverrides[vehicleId] = v2ResolvedAutoMandateToLegacy(resolved);
  }
  const propertyOverrides: Record<string, AssetPropertyOverride> = {};
  for (const propertyId of collectPropertyIds(v2)) {
    const resolved = resolvePropertyMandateV2(
      v2.householdPropertyDefaults,
      v2.propertyOverrides.find((o) => o.propertyId === propertyId),
    );
    propertyOverrides[propertyId] = v2ResolvedPropertyMandateToLegacy(resolved);
  }
  return {
    auto: v2AutoMandateToLegacy(v2.householdAutoDefaults),
    property: v2PropertyMandateToLegacy(v2.householdPropertyDefaults),
    switching: (switching ?? createDefaultSwitchingPreferencesV2()) as SwitchingPreferences,
    vehicleOverrides,
    propertyOverrides,
  };
}

export function v2ToLegacyProjection(
  v2: HouseholdCoverageMandateV2,
  switching?: SwitchingPreferencesV2,
): HouseholdMandate {
  return mandateV2ToEngineMandate(v2, switching);
}

// =============================================================================
// Legacy/expanded unversioned mandate -> V2
// =============================================================================

function legacyWaterToV2(water: Record<string, unknown> | undefined | null): {
  preference: CoveragePreference;
  limit: MonetaryRule;
  deductible: MonetaryRule;
} {
  const raw = (water ?? {}) as Record<string, unknown>;
  const preference = CoveragePreference.parse(raw.preference ?? "indifferent");
  const limit = legacyMonetaryRuleToV2((raw.limit ?? { rule: "any" }) as LegacyMonetaryRuleInput);
  const deductible = legacyMonetaryRuleToV2(
    (raw.deductible ?? { rule: "any" }) as LegacyMonetaryRuleInput,
  );
  return { preference, limit, deductible };
}

function legacyAutoMandateToV2(auto: Record<string, unknown>): AutoMandateV2 {
  // Pre-expansion legacy shape uses booleans and top-level cents fields.
  const isOldShape =
    auto.minThirdPartyLiabilityCents !== undefined || auto.comprehensiveRequired !== undefined;

  if (isOldShape) {
    const minLiability = Math.max(0, Number(auto.minThirdPartyLiabilityCents ?? 200_000_000));
    const maxCollision = Math.max(0, Number(auto.maxCollisionDeductibleCents ?? 100_000));
    const maxComprehensive = Math.max(0, Number(auto.maxComprehensiveDeductibleCents ?? 100_000));
    let form: AutoMandateV2["coverageForm"]["value"] = "liability_only";
    if (auto.comprehensiveRequired) form = "comprehensive";
    else if (auto.collisionRequired) form = "collision";

    const endorsements = Object.fromEntries(
      AutoEndorsementKey.options.map((k) => [k, "indifferent" as CoveragePreference]),
    ) as Record<AutoEndorsementKey, CoveragePreference>;

    if (auto.accidentForgivenessRequired) endorsements.accident_forgiveness = "required";
    if (auto.rentalVehicleCoverageRequired) endorsements.rental_vehicle_coverage = "required";
    const telematicsAllowed = (auto.telematicsAllowed as boolean | undefined) ?? true;
    endorsements.telematics = telematicsAllowed ? "indifferent" : "prohibited";

    return {
      coverageForm: { preference: "required", value: form },
      liability: { rule: "minimum", amountCents: minLiability },
      collisionDeductible: { rule: "maximum", amountCents: maxCollision },
      comprehensiveDeductible: { rule: "maximum", amountCents: maxComprehensive },
      glassDeductible: { rule: "any" },
      endorsements,
    };
  }

  const coverageForm = (auto.coverageForm as
    | { preference: CoveragePreference; value: AutoMandateV2["coverageForm"]["value"] }
    | undefined) ?? {
    preference: "required" as CoveragePreference,
    value: "comprehensive" as const,
  };

  const endorsements = Object.fromEntries(
    AutoEndorsementKey.options.map((k) => [k, "indifferent" as CoveragePreference]),
  ) as Record<AutoEndorsementKey, CoveragePreference>;
  const existing = auto.endorsements as Record<AutoEndorsementKey, CoveragePreference> | undefined;
  if (existing) {
    for (const key of AutoEndorsementKey.options) {
      if (existing[key]) endorsements[key] = existing[key];
    }
  }

  return {
    coverageForm,
    liability: legacyMonetaryRuleToV2(
      (auto.liability ?? { rule: "minimum", cents: 200_000_000 }) as LegacyMonetaryRuleInput,
    ),
    collisionDeductible: legacyMonetaryRuleToV2(
      (auto.collisionDeductible ?? { rule: "maximum", cents: 100_000 }) as LegacyMonetaryRuleInput,
    ),
    comprehensiveDeductible: legacyMonetaryRuleToV2(
      (auto.comprehensiveDeductible ?? {
        rule: "maximum",
        cents: 100_000,
      }) as LegacyMonetaryRuleInput,
    ),
    glassDeductible: legacyMonetaryRuleToV2(
      (auto.glassDeductible ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    endorsements,
  };
}

function legacyPropertyMandateToV2(property: Record<string, unknown>): PropertyMandateV2 {
  const coverageForm = (property.coverageForm as
    | { preference: CoveragePreference; value: PropertyMandateV2["coverageForm"]["value"] }
    | undefined) ?? {
    preference: "required" as CoveragePreference,
    value: "comprehensive" as const,
  };
  const settlementBasis = (property.settlementBasis as
    | { preference: CoveragePreference; value: PropertyMandateV2["settlementBasis"]["value"] }
    | undefined) ?? {
    preference: "required" as CoveragePreference,
    value: "replacement_cost" as const,
  };

  const optionalCoverages = Object.fromEntries(
    PropertyOptionalCoverageKey.options.map((k) => [k, "indifferent" as CoveragePreference]),
  ) as Record<(typeof PropertyOptionalCoverageKey.options)[number], CoveragePreference>;
  const existing = property.optionalCoverages as
    | Record<(typeof PropertyOptionalCoverageKey.options)[number], CoveragePreference>
    | undefined;
  if (existing) {
    for (const key of PropertyOptionalCoverageKey.options) {
      if (existing[key]) optionalCoverages[key] = existing[key];
    }
  }

  return {
    coverageForm,
    settlementBasis,
    dwellingLimit: legacyMonetaryRuleToV2(
      (property.dwellingLimit ?? { rule: "minimum", cents: 45_000_000 }) as LegacyMonetaryRuleInput,
    ),
    contentsLimit: legacyMonetaryRuleToV2(
      (property.contentsLimit ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    detachedStructuresLimit: legacyMonetaryRuleToV2(
      (property.detachedStructuresLimit ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    personalLiabilityLimit: legacyMonetaryRuleToV2(
      (property.personalLiabilityLimit ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    additionalLivingExpenseLimit: legacyMonetaryRuleToV2(
      (property.additionalLivingExpenseLimit ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    baseDeductible: legacyMonetaryRuleToV2(
      (property.baseDeductible ?? { rule: "maximum", cents: 250_000 }) as LegacyMonetaryRuleInput,
    ),
    waterDeductible: legacyMonetaryRuleToV2(
      (property.waterDeductible ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    windHailDeductible: legacyMonetaryRuleToV2(
      (property.windHailDeductible ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    earthquakeDeductible: legacyMonetaryRuleToV2(
      (property.earthquakeDeductible ?? { rule: "any" }) as LegacyMonetaryRuleInput,
    ),
    sewerBackup: legacyWaterToV2(property.sewerBackup as Record<string, unknown> | undefined),
    overlandWater: legacyWaterToV2(property.overlandWater as Record<string, unknown> | undefined),
    optionalCoverages,
  };
}

function legacyOverrideMapToVehicleOverrides(
  map: Record<string, Record<string, unknown>> | null | undefined,
): VehicleMandateOverrideV2[] {
  if (!map) return [];
  return Object.entries(map).map(([vehicleId, values]) => ({
    vehicleId,
    values: {
      coverageForm: values.coverageForm as
        | { preference: CoveragePreference; value: AutoMandateV2["coverageForm"]["value"] }
        | undefined,
      liability: values.liability
        ? legacyMonetaryRuleToV2(values.liability as LegacyMonetaryRuleInput)
        : undefined,
      collisionDeductible: values.collisionDeductible
        ? legacyMonetaryRuleToV2(values.collisionDeductible as LegacyMonetaryRuleInput)
        : undefined,
      comprehensiveDeductible: values.comprehensiveDeductible
        ? legacyMonetaryRuleToV2(values.comprehensiveDeductible as LegacyMonetaryRuleInput)
        : undefined,
      glassDeductible: values.glassDeductible
        ? legacyMonetaryRuleToV2(values.glassDeductible as LegacyMonetaryRuleInput)
        : undefined,
      endorsements: values.endorsements as
        | Partial<Record<AutoEndorsementKey, CoveragePreference>>
        | undefined,
    },
  }));
}

function legacyOverrideMapToPropertyOverrides(
  map: Record<string, Record<string, unknown>> | null | undefined,
): PropertyMandateOverrideV2[] {
  if (!map) return [];
  return Object.entries(map).map(([propertyId, values]) => ({
    propertyId,
    values: {
      coverageForm: values.coverageForm as
        | { preference: CoveragePreference; value: PropertyMandateV2["coverageForm"]["value"] }
        | undefined,
      settlementBasis: values.settlementBasis as
        | { preference: CoveragePreference; value: PropertyMandateV2["settlementBasis"]["value"] }
        | undefined,
      dwellingLimit: values.dwellingLimit
        ? legacyMonetaryRuleToV2(values.dwellingLimit as LegacyMonetaryRuleInput)
        : undefined,
      contentsLimit: values.contentsLimit
        ? legacyMonetaryRuleToV2(values.contentsLimit as LegacyMonetaryRuleInput)
        : undefined,
      detachedStructuresLimit: values.detachedStructuresLimit
        ? legacyMonetaryRuleToV2(values.detachedStructuresLimit as LegacyMonetaryRuleInput)
        : undefined,
      personalLiabilityLimit: values.personalLiabilityLimit
        ? legacyMonetaryRuleToV2(values.personalLiabilityLimit as LegacyMonetaryRuleInput)
        : undefined,
      additionalLivingExpenseLimit: values.additionalLivingExpenseLimit
        ? legacyMonetaryRuleToV2(values.additionalLivingExpenseLimit as LegacyMonetaryRuleInput)
        : undefined,
      baseDeductible: values.baseDeductible
        ? legacyMonetaryRuleToV2(values.baseDeductible as LegacyMonetaryRuleInput)
        : undefined,
      waterDeductible: values.waterDeductible
        ? legacyMonetaryRuleToV2(values.waterDeductible as LegacyMonetaryRuleInput)
        : undefined,
      windHailDeductible: values.windHailDeductible
        ? legacyMonetaryRuleToV2(values.windHailDeductible as LegacyMonetaryRuleInput)
        : undefined,
      earthquakeDeductible: values.earthquakeDeductible
        ? legacyMonetaryRuleToV2(values.earthquakeDeductible as LegacyMonetaryRuleInput)
        : undefined,
      sewerBackup: values.sewerBackup
        ? legacyWaterToV2(values.sewerBackup as Record<string, unknown>)
        : undefined,
      overlandWater: values.overlandWater
        ? legacyWaterToV2(values.overlandWater as Record<string, unknown>)
        : undefined,
      optionalCoverages: values.optionalCoverages as
        | Partial<Record<(typeof PropertyOptionalCoverageKey.options)[number], CoveragePreference>>
        | undefined,
    },
  }));
}

function normalizeCoverageRow(coverage: Record<string, unknown> | null | undefined): {
  auto: Record<string, unknown>;
  property: Record<string, unknown>;
  vehicleOverrides: Record<string, Record<string, unknown>>;
  propertyOverrides: Record<string, Record<string, unknown>>;
} {
  const raw = (coverage ?? {}) as Record<string, unknown>;
  return {
    auto: (raw.auto_requirements ?? {}) as Record<string, unknown>,
    property: (raw.property_requirements ?? {}) as Record<string, unknown>,
    vehicleOverrides: (raw.vehicle_mandates ?? {}) as Record<string, Record<string, unknown>>,
    propertyOverrides: (raw.property_mandates ?? {}) as Record<string, Record<string, unknown>>,
  };
}

export function legacyMandateToV2(
  coverage: Record<string, unknown> | null | undefined,
  version = 1,
  effectiveFrom = new Date().toISOString(),
): HouseholdCoverageMandateV2 {
  const normalized = normalizeCoverageRow(coverage);

  return {
    schemaVersion: 2 as const,
    jurisdiction: "AB" as const,
    version,
    effectiveFrom,
    householdAutoDefaults: legacyAutoMandateToV2(normalized.auto),
    householdPropertyDefaults: legacyPropertyMandateToV2(normalized.property),
    vehicleOverrides: legacyOverrideMapToVehicleOverrides(normalized.vehicleOverrides),
    propertyOverrides: legacyOverrideMapToPropertyOverrides(normalized.propertyOverrides),
  };
}

export function expandedUnversionedMandateToV2(
  coverage: Record<string, unknown> | null | undefined,
  version = 1,
  effectiveFrom = new Date().toISOString(),
): HouseholdCoverageMandateV2 {
  // The expanded unversioned shape is structurally the same as the legacy
  // compatibility shape used by the previous migration, so the same converter
  // handles both old booleans and rule/cents objects.
  return legacyMandateToV2(coverage, version, effectiveFrom);
}

function v2PartialWaterToLegacy(
  water: Partial<WaterCoverageRequirementV2>,
): WaterCoverageRequirement | undefined {
  if (water.preference == null || water.limit == null || water.deductible == null) {
    return undefined;
  }
  return v2WaterToLegacy(water as WaterCoverageRequirementV2);
}

function v2AutoOverrideValuesToLegacy(values: AutoMandateOverrideValuesV2): AssetAutoOverride {
  const out: Partial<AutoRequirements> = {};
  if (values.coverageForm) {
    out.coverageForm = AutoCoverageFormRequirement.parse(values.coverageForm);
  }
  if (values.liability) {
    out.liability = monetaryRuleV2ToLegacyLimit(values.liability);
  }
  if (values.collisionDeductible) {
    out.collisionDeductible = monetaryRuleV2ToLegacyDeductible(values.collisionDeductible);
  }
  if (values.comprehensiveDeductible) {
    out.comprehensiveDeductible = monetaryRuleV2ToLegacyDeductible(values.comprehensiveDeductible);
  }
  if (values.glassDeductible) {
    out.glassDeductible = monetaryRuleV2ToLegacyDeductible(values.glassDeductible);
  }
  if (values.endorsements) {
    out.endorsements = AutoEndorsementPreferences.parse(values.endorsements);
  }
  return AssetAutoOverride.parse(out) as AssetAutoOverride;
}

function v2PropertyOverrideValuesToLegacy(
  values: PropertyMandateOverrideValuesV2,
): AssetPropertyOverride {
  const out: Partial<PropertyRequirements> = {};
  if (values.coverageForm) {
    out.coverageForm = PropertyCoverageFormRequirement.parse(values.coverageForm);
  }
  if (values.settlementBasis) {
    out.settlementBasis = PropertySettlementRequirement.parse(values.settlementBasis);
  }
  if (values.dwellingLimit) {
    out.dwellingLimit = monetaryRuleV2ToLegacyLimit(values.dwellingLimit);
  }
  if (values.contentsLimit) {
    out.contentsLimit = monetaryRuleV2ToLegacyLimit(values.contentsLimit);
  }
  if (values.detachedStructuresLimit) {
    out.detachedStructuresLimit = monetaryRuleV2ToLegacyLimit(values.detachedStructuresLimit);
  }
  if (values.personalLiabilityLimit) {
    out.personalLiabilityLimit = monetaryRuleV2ToLegacyLimit(values.personalLiabilityLimit);
  }
  if (values.additionalLivingExpenseLimit) {
    out.additionalLivingExpenseLimit = monetaryRuleV2ToLegacyLimit(
      values.additionalLivingExpenseLimit,
    );
  }
  if (values.baseDeductible) {
    out.baseDeductible = monetaryRuleV2ToLegacyDeductible(values.baseDeductible);
  }
  if (values.waterDeductible) {
    out.waterDeductible = monetaryRuleV2ToLegacyDeductible(values.waterDeductible);
  }
  if (values.windHailDeductible) {
    out.windHailDeductible = monetaryRuleV2ToLegacyDeductible(values.windHailDeductible);
  }
  if (values.earthquakeDeductible) {
    out.earthquakeDeductible = monetaryRuleV2ToLegacyDeductible(values.earthquakeDeductible);
  }
  if (values.sewerBackup) {
    const w = v2PartialWaterToLegacy(values.sewerBackup);
    if (w) out.sewerBackup = w;
  }
  if (values.overlandWater) {
    const w = v2PartialWaterToLegacy(values.overlandWater);
    if (w) out.overlandWater = w;
  }
  if (values.optionalCoverages) {
    out.optionalCoverages = PropertyOptionalCoveragePreferences.parse(values.optionalCoverages);
  }
  return AssetPropertyOverride.parse(out) as AssetPropertyOverride;
}

export function mandateV2ToLegacyRow(v2: HouseholdCoverageMandateV2): Record<string, unknown> {
  const vehicleOverrides: Record<string, AssetAutoOverride> = {};
  for (const o of v2.vehicleOverrides) {
    vehicleOverrides[o.vehicleId] = v2AutoOverrideValuesToLegacy(o.values);
  }
  const propertyOverrides: Record<string, AssetPropertyOverride> = {};
  for (const o of v2.propertyOverrides) {
    propertyOverrides[o.propertyId] = v2PropertyOverrideValuesToLegacy(o.values);
  }
  return {
    schema_version: v2.schemaVersion,
    jurisdiction: v2.jurisdiction,
    version: v2.version,
    effective_from: v2.effectiveFrom,
    household_auto_defaults: v2AutoMandateToLegacy(v2.householdAutoDefaults),
    household_property_defaults: v2PropertyMandateToLegacy(v2.householdPropertyDefaults),
    vehicle_mandates: vehicleOverrides,
    property_mandates: propertyOverrides,
  };
}

// =============================================================================
// Switching-preference row/domain mapping
// =============================================================================

export interface SwitchingPreferencesRow {
  id?: string;
  household_id?: string;
  version: number;
  min_net_annual_savings_cents: number;
  renewal_only_switching: boolean;
  household_optimization_enabled: boolean;
  split_insurers_allowed: boolean;
  excluded_insurer_ids: string[];
  deductible_increases_allowed: boolean;
  material_coverage_reductions_allowed: boolean;
  customer_approval_required: boolean;
  switch_only_after_customer_approval: boolean;
  max_premium_increase_cents: number;
  max_deductible_increase_cents: number;
  allow_bundle_breakup: boolean;
  minimum_insurer_financial_rating: string;
  preferred_payment_frequency: string;
  preferred_billing_method: string;
  broker_direct_preference: string;
  is_current?: boolean;
}

export function switchingRowToDomain(row: SwitchingPreferencesRow): SwitchingPreferencesV2 {
  return SwitchingPreferencesV2.parse({
    minNetAnnualSavingsCents: row.min_net_annual_savings_cents,
    maxPremiumIncreaseCents: row.max_premium_increase_cents,
    maxDeductibleIncreaseCents: row.max_deductible_increase_cents,
    renewalOnlySwitching: row.renewal_only_switching,
    householdOptimizationEnabled: row.household_optimization_enabled,
    splitInsurersAllowed: row.split_insurers_allowed,
    allowBundleBreakup: row.allow_bundle_breakup,
    excludedInsurerIds: row.excluded_insurer_ids ?? [],
    deductibleIncreasesAllowed: row.deductible_increases_allowed,
    materialCoverageReductionsAllowed: row.material_coverage_reductions_allowed,
    customerApprovalRequired: !!row.customer_approval_required,
    switchOnlyAfterCustomerApproval: row.switch_only_after_customer_approval,
    preferredPaymentFrequency: row.preferred_payment_frequency,
    preferredBillingMethod: row.preferred_billing_method,
    brokerDirectPreference: row.broker_direct_preference,
    minimumInsurerFinancialRating: row.minimum_insurer_financial_rating,
  });
}

export function switchingDomainToRow(domain: SwitchingPreferencesV2): SwitchingPreferencesRow {
  return {
    version: 1,
    min_net_annual_savings_cents: domain.minNetAnnualSavingsCents,
    max_premium_increase_cents: domain.maxPremiumIncreaseCents,
    max_deductible_increase_cents: domain.maxDeductibleIncreaseCents,
    renewal_only_switching: domain.renewalOnlySwitching,
    household_optimization_enabled: domain.householdOptimizationEnabled,
    split_insurers_allowed: domain.splitInsurersAllowed,
    excluded_insurer_ids: domain.excludedInsurerIds,
    deductible_increases_allowed: domain.deductibleIncreasesAllowed,
    material_coverage_reductions_allowed: domain.materialCoverageReductionsAllowed,
    customer_approval_required: domain.customerApprovalRequired,
    switch_only_after_customer_approval: domain.switchOnlyAfterCustomerApproval,
    allow_bundle_breakup: domain.allowBundleBreakup,
    minimum_insurer_financial_rating: domain.minimumInsurerFinancialRating,
    preferred_payment_frequency: domain.preferredPaymentFrequency,
    preferred_billing_method: domain.preferredBillingMethod,
    broker_direct_preference: domain.brokerDirectPreference,
  };
}
