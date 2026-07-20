import {
  autoCoverageFormOptions,
  autoEndorsementLabels,
  billingMethodOptions,
  brokerDirectOptions,
  coveragePreferenceOptions,
  deductibleRuleOptions,
  financialRatingOptions,
  formatCad,
  limitRuleOptions,
  paymentFrequencyOptions,
  propertyCoverageFormOptions,
  propertyOptionalCoverageLabels,
  propertySettlementOptions,
} from "@/lib/mandate";
import { Row } from "@/components/ui";
import type {
  AutoMandateV2,
  MonetaryRule,
  PropertyMandateV2,
  SwitchingPreferencesV2,
} from "@autopilot/schemas";

export function labelForValue<T extends string>(
  options: { value: T; label: string }[],
  value: T | undefined,
): string {
  if (value === undefined) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

export function displayPreference(value: string | undefined): string {
  return coveragePreferenceOptions.find((o) => o.value === value)?.label ?? "—";
}

export function displayMonetaryRule(rule?: MonetaryRule): string {
  if (!rule) return "—";
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return "Match current or better";
  const label = limitRuleOptions.find((o) => o.value === rule.rule)?.label ?? rule.rule;
  return `${label} ${formatCad(rule.amountCents)}`;
}

export function displayDeductibleRule(rule?: MonetaryRule): string {
  if (!rule) return "—";
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return "Match current or better";
  const label = deductibleRuleOptions.find((o) => o.value === rule.rule)?.label ?? rule.rule;
  return `${label} ${formatCad(rule.amountCents)}`;
}

export function AutoMandateRows({ auto }: { auto: AutoMandateV2 }) {
  return (
    <>
      <Row
        label="Coverage form"
        value={labelForValue(autoCoverageFormOptions, auto.coverageForm.value)}
      />
      <Row
        label="Coverage form preference"
        value={displayPreference(auto.coverageForm.preference)}
      />
      <Row label="Liability" value={displayMonetaryRule(auto.liability)} />
      <Row label="Collision deductible" value={displayDeductibleRule(auto.collisionDeductible)} />
      <Row
        label="Comprehensive deductible"
        value={displayDeductibleRule(auto.comprehensiveDeductible)}
      />
      <Row label="Glass deductible" value={displayDeductibleRule(auto.glassDeductible)} />
      {(
        Object.entries(autoEndorsementLabels) as [keyof AutoMandateV2["endorsements"], string][]
      ).map(([key, label]) => (
        <Row key={key} label={label} value={displayPreference(auto.endorsements[key])} />
      ))}
    </>
  );
}

function WaterRows({
  name,
  water,
}: {
  name: string;
  water: { preference: string; limit?: MonetaryRule; deductible?: MonetaryRule };
}) {
  return (
    <>
      <Row label={`${name} preference`} value={displayPreference(water.preference)} />
      <Row label={`${name} limit`} value={displayMonetaryRule(water.limit)} />
      <Row label={`${name} deductible`} value={displayDeductibleRule(water.deductible)} />
    </>
  );
}

export function PropertyMandateRows({ property }: { property: PropertyMandateV2 }) {
  return (
    <>
      <Row
        label="Coverage form"
        value={labelForValue(propertyCoverageFormOptions, property.coverageForm.value)}
      />
      <Row
        label="Coverage form preference"
        value={displayPreference(property.coverageForm.preference)}
      />
      <Row
        label="Settlement basis"
        value={labelForValue(propertySettlementOptions, property.settlementBasis.value)}
      />
      <Row
        label="Settlement preference"
        value={displayPreference(property.settlementBasis.preference)}
      />
      <Row label="Dwelling limit" value={displayMonetaryRule(property.dwellingLimit)} />
      <Row label="Contents limit" value={displayMonetaryRule(property.contentsLimit)} />
      <Row
        label="Detached structures limit"
        value={displayMonetaryRule(property.detachedStructuresLimit)}
      />
      <Row
        label="Personal liability limit"
        value={displayMonetaryRule(property.personalLiabilityLimit)}
      />
      <Row
        label="Additional living expense limit"
        value={displayMonetaryRule(property.additionalLivingExpenseLimit)}
      />
      <Row label="Base deductible" value={displayDeductibleRule(property.baseDeductible)} />
      <Row label="Water deductible" value={displayDeductibleRule(property.waterDeductible)} />
      <Row
        label="Wind/hail deductible"
        value={displayDeductibleRule(property.windHailDeductible)}
      />
      <Row
        label="Earthquake deductible"
        value={displayDeductibleRule(property.earthquakeDeductible)}
      />
      <WaterRows name="Sewer backup" water={property.sewerBackup} />
      <WaterRows name="Overland water" water={property.overlandWater} />
      <Row
        label="Groundwater / seepage"
        value={displayPreference(property.optionalCoverages.groundwater_seepage)}
      />
      <Row label="Roof ice dam" value={displayPreference(property.optionalCoverages.ice_dam)} />
      {(
        Object.entries(propertyOptionalCoverageLabels) as [
          keyof PropertyMandateV2["optionalCoverages"],
          string,
        ][]
      ).map(([key, label]) => (
        <Row key={key} label={label} value={displayPreference(property.optionalCoverages[key])} />
      ))}
    </>
  );
}

export function SwitchingRows({
  prefs,
  excludedNames,
}: {
  prefs: SwitchingPreferencesV2;
  excludedNames: string[];
}) {
  return (
    <>
      <Row
        label="Only recommend a switch if I save at least"
        value={formatCad(prefs.minNetAnnualSavingsCents)}
      />
      <Row
        label="Do not increase my deductible by more than"
        value={formatCad(prefs.maxDeductibleIncreaseCents)}
      />
      <Row
        label="Only recommend changes at renewal"
        value={prefs.renewalOnlySwitching ? "Yes" : "No"}
      />
      <Row
        label="Compare home and auto together"
        value={prefs.householdOptimizationEnabled ? "Yes" : "No"}
      />
      <Row
        label="Allow home and auto with different insurers"
        value={prefs.splitInsurersAllowed ? "Yes" : "No"}
      />
      <Row label="Allow breaking current bundle" value={prefs.allowBundleBreakup ? "Yes" : "No"} />
      <Row
        label="Allow higher deductibles"
        value={prefs.deductibleIncreasesAllowed ? "Yes" : "No"}
      />
      <Row
        label="Never reduce important coverage"
        value={prefs.materialCoverageReductionsAllowed ? "No" : "Always"}
      />
      <Row
        label="Always ask me before starting a switch"
        value={prefs.customerApprovalRequired ? "Yes" : "No"}
      />
      <Row
        label="Preferred payment frequency"
        value={labelForValue(paymentFrequencyOptions, prefs.preferredPaymentFrequency)}
      />
      <Row
        label="Preferred billing method"
        value={labelForValue(billingMethodOptions, prefs.preferredBillingMethod)}
      />
      <Row
        label="Broker or direct preference"
        value={labelForValue(brokerDirectOptions, prefs.brokerDirectPreference)}
      />
      <Row
        label="Minimum insurer financial rating"
        value={labelForValue(financialRatingOptions, prefs.minimumInsurerFinancialRating)}
      />
      <Row
        label="Excluded insurers"
        value={excludedNames.length ? excludedNames.join(", ") : "None"}
      />
    </>
  );
}
