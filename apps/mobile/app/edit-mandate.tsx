import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { CaretDownIcon, CaretRightIcon } from "phosphor-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { useHousehold } from "@/lib/household";
import {
  Body,
  Card,
  Field,
  InfoTooltip,
  Loading,
  PageHeader,
  PrimaryButton,
  Screen,
  Select,
  Subtitle,
  Title,
} from "@/components/ui";
import { spacing } from "@autopilot/design-tokens";
import {
  autoCoverageFormOptions,
  autoEndorsementLabels,
  billingMethodOptions,
  brokerDirectOptions,
  centsFromDollars,
  coveragePreferenceOptions,
  deductibleRuleOptions,
  dollarsFromCents,
  financialRatingOptions,
  limitRuleOptions,
  paymentFrequencyOptions,
  propertyCoverageFormOptions,
  propertyOptionalCoverageLabels,
  propertySettlementOptions,
} from "@/lib/mandate";
import { autoEndorsementHelp, mandateHelp, propertyOptionalCoverageHelp } from "@/lib/mandate-help";
import {
  loadHouseholdMandateV2,
  MandateValidationError,
  resolveEffectivePropertyMandateV2,
  resolveEffectiveVehicleMandateV2,
  updatePropertyOverrideV2,
  updateVehicleOverrideV2,
  clearVehicleOverrideV2,
  clearPropertyOverrideV2,
} from "@autopilot/database";
import type {
  AutoMandateOverrideValuesV2,
  AutoMandateV2,
  CoveragePreference,
  DeductibleRuleV2,
  HouseholdCoverageMandateV2,
  LimitRuleV2,
  PropertyMandateOverrideValuesV2,
  PropertyMandateV2,
  SwitchingPreferencesV2,
  WaterCoverageRequirementV2,
} from "@autopilot/schemas";

function Collapsible({
  title,
  helpText,
  children,
}: {
  title: string;
  helpText?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ flexShrink: 1 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {open ? (
              <CaretDownIcon color="#2563EB" size={16} />
            ) : (
              <CaretRightIcon color="#2563EB" size={16} />
            )}
            <Body style={{ color: "#2563EB", fontWeight: "600", marginLeft: 4 }}>{title}</Body>
          </View>
        </Pressable>
        {helpText ? <InfoTooltip label={title} text={helpText} /> : null}
      </View>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

function SectionHeading({ title, helpText }: { title: string; helpText: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Subtitle>{title}</Subtitle>
      <InfoTooltip label={title} text={helpText} />
    </View>
  );
}

function RuleField<T extends { rule: string } & Record<string, unknown>>({
  label,
  helpText,
  amountHelpText,
  options,
  value,
  onChange,
}: {
  label: string;
  helpText: string;
  amountHelpText: string;
  options: { value: T["rule"]; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const showAmount = value.rule === "minimum" || value.rule === "maximum" || value.rule === "exact";
  const amountCents =
    "amountCents" in value && typeof value.amountCents === "number" ? value.amountCents : 0;
  return (
    <View style={{ marginBottom: 8 }}>
      <Select
        label={`${label} rule`}
        helpText={helpText}
        options={options}
        value={value.rule}
        onValueChange={(rule) => {
          if (rule === "minimum" || rule === "maximum" || rule === "exact") {
            onChange({ rule, amountCents } as unknown as T);
          } else {
            onChange({ rule } as unknown as T);
          }
        }}
      />
      {showAmount ? (
        <Field
          label={`${label} amount (C$)`}
          helpText={amountHelpText}
          keyboardType="numeric"
          value={dollarsFromCents(amountCents)}
          onChangeText={(text) =>
            onChange({
              rule: value.rule as "minimum" | "maximum" | "exact",
              amountCents: centsFromDollars(text),
            } as unknown as T)
          }
        />
      ) : null}
    </View>
  );
}

function LimitRuleField(props: {
  label: string;
  helpText: string;
  amountHelpText: string;
  options: { value: LimitRuleV2["rule"]; label: string }[];
  value: LimitRuleV2;
  onChange: (next: LimitRuleV2) => void;
}) {
  return <RuleField<LimitRuleV2> {...props} />;
}

function DeductibleRuleField(props: {
  label: string;
  helpText: string;
  amountHelpText: string;
  options: { value: DeductibleRuleV2["rule"]; label: string }[];
  value: DeductibleRuleV2;
  onChange: (next: DeductibleRuleV2) => void;
}) {
  return <RuleField<DeductibleRuleV2> {...props} />;
}

function PreferenceSelect({
  label,
  helpText,
  value,
  onChange,
}: {
  label: string;
  helpText: string;
  value: CoveragePreference;
  onChange: (value: CoveragePreference) => void;
}) {
  return (
    <Select
      label={label}
      helpText={helpText}
      options={coveragePreferenceOptions}
      value={value}
      onValueChange={onChange}
    />
  );
}

function WaterEditorV2({
  name,
  helpText,
  value,
  onChange,
}: {
  name: string;
  helpText: string;
  value: WaterCoverageRequirementV2;
  onChange: (next: WaterCoverageRequirementV2) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <PreferenceSelect
        label={`${name} preference`}
        helpText={`${helpText} ${mandateHelp.coveragePreference}`}
        value={value.preference}
        onChange={(preference) => onChange({ ...value, preference })}
      />
      <LimitRuleField
        label={`${name} limit`}
        helpText={`${helpText} ${mandateHelp.limitRule}`}
        amountHelpText={`${helpText} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.limit}
        onChange={(limit) => onChange({ ...value, limit })}
      />
      <DeductibleRuleField
        label={`${name} deductible`}
        helpText={`${helpText} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${helpText} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.deductible}
        onChange={(deductible) => onChange({ ...value, deductible })}
      />
    </View>
  );
}

function AutoMandateEditorV2({
  value,
  onChange,
  titleText,
}: {
  value: AutoMandateV2;
  onChange: (next: AutoMandateV2) => void;
  titleText: string;
}) {
  return (
    <>
      {titleText ? <Subtitle>{titleText}</Subtitle> : null}
      <Select
        label="Coverage form"
        helpText={mandateHelp.autoCoverageForm}
        options={autoCoverageFormOptions}
        value={value.coverageForm.value}
        onValueChange={(nextValue) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, value: nextValue } })
        }
      />
      <Select
        label="Coverage form preference"
        helpText={mandateHelp.coveragePreference}
        options={coveragePreferenceOptions}
        value={value.coverageForm.preference}
        onValueChange={(preference) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, preference } })
        }
      />
      <LimitRuleField
        label="Liability"
        helpText={`${mandateHelp.autoLiability} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.autoLiability} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.liability}
        onChange={(liability) => onChange({ ...value, liability })}
      />
      <DeductibleRuleField
        label="Collision deductible"
        helpText={`${mandateHelp.collisionDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.collisionDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.collisionDeductible}
        onChange={(collisionDeductible) => onChange({ ...value, collisionDeductible })}
      />
      <DeductibleRuleField
        label="Comprehensive deductible"
        helpText={`${mandateHelp.comprehensiveDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.comprehensiveDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.comprehensiveDeductible}
        onChange={(comprehensiveDeductible) => onChange({ ...value, comprehensiveDeductible })}
      />
      <DeductibleRuleField
        label="Glass deductible"
        helpText={`${mandateHelp.glassDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.glassDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.glassDeductible}
        onChange={(glassDeductible) => onChange({ ...value, glassDeductible })}
      />
      {(
        Object.entries(autoEndorsementLabels) as [keyof AutoMandateV2["endorsements"], string][]
      ).map(([key, label]) => (
        <PreferenceSelect
          key={key}
          label={label}
          helpText={`${autoEndorsementHelp[key]} ${mandateHelp.coveragePreference}`}
          value={value.endorsements[key]}
          onChange={(preference) =>
            onChange({
              ...value,
              endorsements: { ...value.endorsements, [key]: preference },
            })
          }
        />
      ))}
    </>
  );
}

function PropertyMandateEditorV2({
  value,
  onChange,
  titleText,
}: {
  value: PropertyMandateV2;
  onChange: (next: PropertyMandateV2) => void;
  titleText: string;
}) {
  return (
    <>
      {titleText ? <Subtitle>{titleText}</Subtitle> : null}
      <Select
        label="Coverage form"
        helpText={mandateHelp.propertyCoverageForm}
        options={propertyCoverageFormOptions}
        value={value.coverageForm.value}
        onValueChange={(nextValue) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, value: nextValue } })
        }
      />
      <Select
        label="Coverage form preference"
        helpText={mandateHelp.coveragePreference}
        options={coveragePreferenceOptions}
        value={value.coverageForm.preference}
        onValueChange={(preference) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, preference } })
        }
      />
      <Select
        label="Settlement basis"
        helpText={mandateHelp.settlementBasis}
        options={propertySettlementOptions}
        value={value.settlementBasis.value}
        onValueChange={(nextValue) =>
          onChange({ ...value, settlementBasis: { ...value.settlementBasis, value: nextValue } })
        }
      />
      <Select
        label="Settlement preference"
        helpText={mandateHelp.coveragePreference}
        options={coveragePreferenceOptions}
        value={value.settlementBasis.preference}
        onValueChange={(preference) =>
          onChange({ ...value, settlementBasis: { ...value.settlementBasis, preference } })
        }
      />
      <LimitRuleField
        label="Dwelling limit"
        helpText={`${mandateHelp.dwellingLimit} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.dwellingLimit} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.dwellingLimit}
        onChange={(dwellingLimit) => onChange({ ...value, dwellingLimit })}
      />
      <LimitRuleField
        label="Contents limit"
        helpText={`${mandateHelp.contentsLimit} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.contentsLimit} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.contentsLimit}
        onChange={(contentsLimit) => onChange({ ...value, contentsLimit })}
      />
      <LimitRuleField
        label="Detached structures limit"
        helpText={`${mandateHelp.detachedStructuresLimit} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.detachedStructuresLimit} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.detachedStructuresLimit}
        onChange={(detachedStructuresLimit) => onChange({ ...value, detachedStructuresLimit })}
      />
      <LimitRuleField
        label="Personal liability limit"
        helpText={`${mandateHelp.personalLiabilityLimit} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.personalLiabilityLimit} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.personalLiabilityLimit}
        onChange={(personalLiabilityLimit) => onChange({ ...value, personalLiabilityLimit })}
      />
      <LimitRuleField
        label="Additional living expense limit"
        helpText={`${mandateHelp.additionalLivingExpenseLimit} ${mandateHelp.limitRule}`}
        amountHelpText={`${mandateHelp.additionalLivingExpenseLimit} ${mandateHelp.limitAmount}`}
        options={limitRuleOptions}
        value={value.additionalLivingExpenseLimit}
        onChange={(additionalLivingExpenseLimit) =>
          onChange({ ...value, additionalLivingExpenseLimit })
        }
      />
      <DeductibleRuleField
        label="Base deductible"
        helpText={`${mandateHelp.baseDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.baseDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.baseDeductible}
        onChange={(baseDeductible) => onChange({ ...value, baseDeductible })}
      />
      <DeductibleRuleField
        label="Water deductible"
        helpText={`${mandateHelp.waterDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.waterDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.waterDeductible}
        onChange={(waterDeductible) => onChange({ ...value, waterDeductible })}
      />
      <DeductibleRuleField
        label="Wind/hail deductible"
        helpText={`${mandateHelp.windHailDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.windHailDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.windHailDeductible}
        onChange={(windHailDeductible) => onChange({ ...value, windHailDeductible })}
      />
      <DeductibleRuleField
        label="Earthquake deductible"
        helpText={`${mandateHelp.earthquakeDeductible} ${mandateHelp.deductibleRule}`}
        amountHelpText={`${mandateHelp.earthquakeDeductible} ${mandateHelp.deductibleAmount}`}
        options={deductibleRuleOptions}
        value={value.earthquakeDeductible}
        onChange={(earthquakeDeductible) => onChange({ ...value, earthquakeDeductible })}
      />
      <WaterEditorV2
        name="Sewer backup"
        helpText={mandateHelp.sewerBackup}
        value={value.sewerBackup}
        onChange={(sewerBackup) => onChange({ ...value, sewerBackup })}
      />
      <WaterEditorV2
        name="Overland water"
        helpText={mandateHelp.overlandWater}
        value={value.overlandWater}
        onChange={(overlandWater) => onChange({ ...value, overlandWater })}
      />
      {(
        Object.entries(propertyOptionalCoverageLabels) as [
          keyof PropertyMandateV2["optionalCoverages"],
          string,
        ][]
      ).map(([key, label]) => (
        <PreferenceSelect
          key={key}
          label={label}
          helpText={`${propertyOptionalCoverageHelp[key]} ${mandateHelp.coveragePreference}`}
          value={value.optionalCoverages[key]}
          onChange={(preference) =>
            onChange({
              ...value,
              optionalCoverages: { ...value.optionalCoverages, [key]: preference },
            })
          }
        />
      ))}
    </>
  );
}

function diffRule<T extends { rule: string } & Record<string, unknown>>(a: T, b: T): T | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  return b;
}

function diffAutoMandate(
  defaults: AutoMandateV2,
  next: AutoMandateV2,
): AutoMandateOverrideValuesV2 {
  const patch: AutoMandateOverrideValuesV2 = {};
  if (JSON.stringify(defaults.coverageForm) !== JSON.stringify(next.coverageForm)) {
    patch.coverageForm = next.coverageForm;
  }
  const liabilityDiff = diffRule(defaults.liability, next.liability);
  if (liabilityDiff) patch.liability = liabilityDiff;
  const collisionDiff = diffRule(defaults.collisionDeductible, next.collisionDeductible);
  if (collisionDiff) patch.collisionDeductible = collisionDiff;
  const comprehensiveDiff = diffRule(
    defaults.comprehensiveDeductible,
    next.comprehensiveDeductible,
  );
  if (comprehensiveDiff) patch.comprehensiveDeductible = comprehensiveDiff;
  const glassDiff = diffRule(defaults.glassDeductible, next.glassDeductible);
  if (glassDiff) patch.glassDeductible = glassDiff;

  const endorsements: Partial<AutoMandateV2["endorsements"]> = {};
  for (const key of Object.keys(defaults.endorsements) as (keyof AutoMandateV2["endorsements"])[]) {
    if (defaults.endorsements[key] !== next.endorsements[key]) {
      endorsements[key] = next.endorsements[key];
    }
  }
  if (Object.keys(endorsements).length > 0) {
    patch.endorsements = endorsements;
  }
  return patch;
}

function diffWater(
  defaults: WaterCoverageRequirementV2,
  next: WaterCoverageRequirementV2,
): Partial<WaterCoverageRequirementV2> | undefined {
  const patch: Partial<WaterCoverageRequirementV2> = {};
  if (defaults.preference !== next.preference) patch.preference = next.preference;
  const limitDiff = diffRule(defaults.limit, next.limit);
  if (limitDiff) patch.limit = limitDiff;
  const deductibleDiff = diffRule(defaults.deductible, next.deductible);
  if (deductibleDiff) patch.deductible = deductibleDiff;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function diffPropertyMandate(
  defaults: PropertyMandateV2,
  next: PropertyMandateV2,
): PropertyMandateOverrideValuesV2 {
  const patch: PropertyMandateOverrideValuesV2 = {};
  if (JSON.stringify(defaults.coverageForm) !== JSON.stringify(next.coverageForm))
    patch.coverageForm = next.coverageForm;
  if (JSON.stringify(defaults.settlementBasis) !== JSON.stringify(next.settlementBasis))
    patch.settlementBasis = next.settlementBasis;
  const dwellingDiff = diffRule(defaults.dwellingLimit, next.dwellingLimit);
  if (dwellingDiff) patch.dwellingLimit = dwellingDiff;
  const contentsDiff = diffRule(defaults.contentsLimit, next.contentsLimit);
  if (contentsDiff) patch.contentsLimit = contentsDiff;
  const detachedDiff = diffRule(defaults.detachedStructuresLimit, next.detachedStructuresLimit);
  if (detachedDiff) patch.detachedStructuresLimit = detachedDiff;
  const personalLiabilityDiff = diffRule(
    defaults.personalLiabilityLimit,
    next.personalLiabilityLimit,
  );
  if (personalLiabilityDiff) patch.personalLiabilityLimit = personalLiabilityDiff;
  const aleDiff = diffRule(
    defaults.additionalLivingExpenseLimit,
    next.additionalLivingExpenseLimit,
  );
  if (aleDiff) patch.additionalLivingExpenseLimit = aleDiff;
  const baseDeductibleDiff = diffRule(defaults.baseDeductible, next.baseDeductible);
  if (baseDeductibleDiff) patch.baseDeductible = baseDeductibleDiff;
  const waterDeductibleDiff = diffRule(defaults.waterDeductible, next.waterDeductible);
  if (waterDeductibleDiff) patch.waterDeductible = waterDeductibleDiff;
  const windHailDiff = diffRule(defaults.windHailDeductible, next.windHailDeductible);
  if (windHailDiff) patch.windHailDeductible = windHailDiff;
  const earthquakeDiff = diffRule(defaults.earthquakeDeductible, next.earthquakeDeductible);
  if (earthquakeDiff) patch.earthquakeDeductible = earthquakeDiff;

  const sewerDiff = diffWater(defaults.sewerBackup, next.sewerBackup);
  if (sewerDiff) patch.sewerBackup = sewerDiff;
  const overlandDiff = diffWater(defaults.overlandWater, next.overlandWater);
  if (overlandDiff) patch.overlandWater = overlandDiff;

  const optionalCoverages: Partial<PropertyMandateV2["optionalCoverages"]> = {};
  for (const key of Object.keys(
    defaults.optionalCoverages,
  ) as (keyof PropertyMandateV2["optionalCoverages"])[]) {
    if (defaults.optionalCoverages[key] !== next.optionalCoverages[key]) {
      optionalCoverages[key] = next.optionalCoverages[key];
    }
  }
  if (Object.keys(optionalCoverages).length > 0) {
    patch.optionalCoverages = optionalCoverages;
  }
  return patch;
}

function Toggle({
  label,
  helpText,
  value,
  onChange,
}: {
  label: string;
  helpText: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
      }}
    >
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", marginRight: 12 }}>
        <Body>{label}</Body>
        <InfoTooltip label={label} text={helpText} />
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={helpText}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}

type VehicleRow = {
  id: string;
  year: number;
  make: string;
  model: string;
  financing_status: string;
  vehicle_use_class: string;
  is_classic: boolean;
  is_modified: boolean;
};

type PropertyRow = {
  id: string;
  address_line1: string;
  city: string;
  property_type: string;
};

export default function EditMandate() {
  const { data: household, isLoading: householdLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [mandate, setMandate] = useState<HouseholdCoverageMandateV2 | null>(null);
  const [switching, setSwitching] = useState<SwitchingPreferencesV2 | null>(null);
  const [versions, setVersions] = useState<{ mandateVersion: number; switchingVersion: number }>({
    mandateVersion: 0,
    switchingVersion: 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["edit-mandate", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) throw new Error("No household");
      const [loadResult, vehicles, properties, insurers] = await Promise.all([
        loadHouseholdMandateV2(supabase, household.id).catch((err) => {
          if (err instanceof MandateValidationError) {
            throw new Error(
              `Mandate validation failed: ${err.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`,
            );
          }
          throw err;
        }),
        supabase
          .from("vehicles")
          .select(
            "id, year, make, model, financing_status, vehicle_use_class, is_classic, is_modified",
          )
          .eq("household_id", household.id),
        supabase
          .from("properties")
          .select("id, address_line1, city, property_type")
          .eq("household_id", household.id),
        supabase.from("insurers").select("id, name").eq("active", true),
      ]);
      if (vehicles.error) throw vehicles.error;
      if (properties.error) throw properties.error;
      return {
        loadResult,
        vehicles: (vehicles.data ?? []) as VehicleRow[],
        properties: (properties.data ?? []) as PropertyRow[],
        insurers: insurers.data ?? [],
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    setMandate(data.loadResult.mandate);
    setSwitching(data.loadResult.switching);
    setVersions(data.loadResult.versions);
  }, [data]);

  const filteredInsurers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.insurers ?? []).filter((insurer) => insurer.name.toLowerCase().includes(term));
  }, [search, data?.insurers]);

  if (householdLoading || isLoading || !household || !mandate || !switching) return <Loading />;

  const updateAuto = (auto: AutoMandateV2) =>
    setMandate((previous) => (previous ? { ...previous, householdAutoDefaults: auto } : previous));
  const updateProperty = (property: PropertyMandateV2) =>
    setMandate((previous) =>
      previous ? { ...previous, householdPropertyDefaults: property } : previous,
    );

  const handleVehicleOverrideChange = (vehicleId: string, next: AutoMandateV2) => {
    setMandate((previous) => {
      if (!previous) return previous;
      const patch = diffAutoMandate(previous.householdAutoDefaults, next);
      return updateVehicleOverrideV2(previous, vehicleId, patch);
    });
  };

  const handlePropertyOverrideChange = (propertyId: string, next: PropertyMandateV2) => {
    setMandate((previous) => {
      if (!previous) return previous;
      const patch = diffPropertyMandate(previous.householdPropertyDefaults, next);
      return updatePropertyOverrideV2(previous, propertyId, patch);
    });
  };

  const toggleExcludedInsurer = (insurerId: string) => {
    const current = new Set(switching.excludedInsurerIds);
    if (current.has(insurerId)) current.delete(insurerId);
    else current.add(insurerId);
    setSwitching({ ...switching, excludedInsurerIds: Array.from(current) });
  };

  const save = async () => {
    if (!mandate || !switching) return;
    setBusy(true);
    setError(null);
    try {
      const { data: result, error: saveError } = await invokeEdgeFunction<{
        success: boolean;
        mandateVersion?: number;
        switchingVersion?: number;
        code?: string;
        message?: string;
      }>("save-household-mandate", {
        householdId: household.id,
        expectedMandateVersion: versions.mandateVersion,
        expectedSwitchingVersion: versions.switchingVersion,
        mandate,
        switching,
      });
      if (saveError) {
        if (saveError.code === "STALE_VERSION") {
          setError("The mandate was changed by another session. Please review and save again.");
          queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
        } else {
          setError(saveError.message ?? "Save failed");
        }
        setBusy(false);
        return;
      }
      if (!result?.success) {
        setError(result?.message ?? "Save failed");
        setBusy(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["coverage", household.id] });
      queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
      setBusy(false);
      router.back();
    } catch (caughtError) {
      setBusy(false);
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader title="Edit mandate" onBack={() => router.back()} />
      <Screen style={{ flex: 1, padding: 0 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          <Title>Coverage mandate</Title>
          <Body muted>
            Edit your household defaults, then customize per-vehicle and per-property rules below.
            Tap any question mark for a plain-language explanation.
          </Body>
          <View style={{ height: 16 }} />

          <Card>
            <Collapsible
              title="Auto household defaults"
              helpText={mandateHelp.autoHouseholdDefaults}
            >
              <AutoMandateEditorV2
                value={mandate.householdAutoDefaults}
                onChange={updateAuto}
                titleText=""
              />
            </Collapsible>
          </Card>

          <Card>
            <Collapsible
              title="Property household defaults"
              helpText={mandateHelp.propertyHouseholdDefaults}
            >
              <PropertyMandateEditorV2
                value={mandate.householdPropertyDefaults}
                onChange={updateProperty}
                titleText=""
              />
            </Collapsible>
          </Card>

          <Card>
            <SectionHeading title="Vehicles" helpText={mandateHelp.vehicles} />
            {(data?.vehicles ?? []).length === 0 ? (
              <Body muted>No vehicles on file.</Body>
            ) : (
              (data?.vehicles ?? []).map((vehicle) => {
                const override = mandate.vehicleOverrides.find(
                  (item) => item.vehicleId === vehicle.id,
                );
                const effective = resolveEffectiveVehicleMandateV2(mandate, vehicle.id);
                return (
                  <View key={vehicle.id} style={{ marginBottom: 16 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Body>
                    <Body muted>
                      {vehicle.financing_status.replace("_", " ")} ·{" "}
                      {vehicle.vehicle_use_class.replace("_", " ")}
                      {vehicle.is_classic ? " · Classic" : ""}
                      {vehicle.is_modified ? " · Modified" : ""}
                    </Body>
                    <Collapsible
                      title={override ? "Override household defaults" : "Use household defaults"}
                      helpText={mandateHelp.vehicleOverride}
                    >
                      <AutoMandateEditorV2
                        value={effective}
                        onChange={(next) => handleVehicleOverrideChange(vehicle.id, next)}
                        titleText=""
                      />
                      {override ? (
                        <PrimaryButton
                          label="Use household defaults"
                          onPress={() =>
                            setMandate((previous) =>
                              previous ? clearVehicleOverrideV2(previous, vehicle.id) : previous,
                            )
                          }
                        />
                      ) : null}
                    </Collapsible>
                  </View>
                );
              })
            )}
          </Card>

          <Card>
            <SectionHeading title="Properties" helpText={mandateHelp.properties} />
            {(data?.properties ?? []).length === 0 ? (
              <Body muted>No properties on file.</Body>
            ) : (
              (data?.properties ?? []).map((property) => {
                const override = mandate.propertyOverrides.find(
                  (item) => item.propertyId === property.id,
                );
                const effective = resolveEffectivePropertyMandateV2(mandate, property.id);
                return (
                  <View key={property.id} style={{ marginBottom: 16 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {property.address_line1}, {property.city}
                    </Body>
                    <Body muted>{property.property_type.replace("_", " ")}</Body>
                    <Collapsible
                      title={override ? "Override household defaults" : "Use household defaults"}
                      helpText={mandateHelp.propertyOverride}
                    >
                      <PropertyMandateEditorV2
                        value={effective}
                        onChange={(next) => handlePropertyOverrideChange(property.id, next)}
                        titleText=""
                      />
                      {override ? (
                        <PrimaryButton
                          label="Use household defaults"
                          onPress={() =>
                            setMandate((previous) =>
                              previous ? clearPropertyOverrideV2(previous, property.id) : previous,
                            )
                          }
                        />
                      ) : null}
                    </Collapsible>
                  </View>
                );
              })
            )}
          </Card>

          <Card>
            <Collapsible title="Switching rules" helpText={mandateHelp.switchingRules}>
              <Field
                label="Minimum net annual savings before switching (C$)"
                helpText={mandateHelp.minimumSavings}
                keyboardType="numeric"
                value={dollarsFromCents(switching.minNetAnnualSavingsCents)}
                onChangeText={(text) =>
                  setSwitching({
                    ...switching,
                    minNetAnnualSavingsCents: centsFromDollars(text),
                  })
                }
              />
              <Field
                label="Maximum acceptable deductible increase (C$)"
                helpText={mandateHelp.maximumDeductibleIncrease}
                keyboardType="numeric"
                value={dollarsFromCents(switching.maxDeductibleIncreaseCents)}
                onChangeText={(text) =>
                  setSwitching({
                    ...switching,
                    maxDeductibleIncreaseCents: centsFromDollars(text),
                  })
                }
              />
              <Toggle
                label="Only switch at renewal"
                helpText={mandateHelp.renewalOnly}
                value={switching.renewalOnlySwitching}
                onChange={(value) => setSwitching({ ...switching, renewalOnlySwitching: value })}
              />
              <Toggle
                label="Optimize home and auto together"
                helpText={mandateHelp.householdOptimization}
                value={switching.householdOptimizationEnabled}
                onChange={(value) =>
                  setSwitching({ ...switching, householdOptimizationEnabled: value })
                }
              />
              <Toggle
                label="Allow different insurers per policy"
                helpText={mandateHelp.splitInsurers}
                value={switching.splitInsurersAllowed}
                onChange={(value) => setSwitching({ ...switching, splitInsurersAllowed: value })}
              />
              <Toggle
                label="Allow bundle breakup"
                helpText={mandateHelp.bundleBreakup}
                value={switching.allowBundleBreakup}
                onChange={(value) => setSwitching({ ...switching, allowBundleBreakup: value })}
              />
              <Toggle
                label="Allow deductible increases"
                helpText={mandateHelp.deductibleIncreases}
                value={switching.deductibleIncreasesAllowed}
                onChange={(value) =>
                  setSwitching({ ...switching, deductibleIncreasesAllowed: value })
                }
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 6,
                }}
              >
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                  <Body>Customer approval required</Body>
                  <InfoTooltip
                    label="Customer approval required"
                    text={mandateHelp.customerApproval}
                  />
                </View>
                <Body>Yes</Body>
              </View>
              <Select
                label="Preferred payment frequency"
                helpText={mandateHelp.paymentFrequency}
                options={paymentFrequencyOptions}
                value={switching.preferredPaymentFrequency}
                onValueChange={(value) =>
                  setSwitching({ ...switching, preferredPaymentFrequency: value })
                }
              />
              <Select
                label="Preferred billing method"
                helpText={mandateHelp.billingMethod}
                options={billingMethodOptions}
                value={switching.preferredBillingMethod}
                onValueChange={(value) =>
                  setSwitching({ ...switching, preferredBillingMethod: value })
                }
              />
              <Select
                label="Broker/direct preference"
                helpText={mandateHelp.brokerDirect}
                options={brokerDirectOptions}
                value={switching.brokerDirectPreference}
                onValueChange={(value) =>
                  setSwitching({ ...switching, brokerDirectPreference: value })
                }
              />
              <Select
                label="Minimum insurer financial rating"
                helpText={mandateHelp.financialRating}
                options={financialRatingOptions}
                value={switching.minimumInsurerFinancialRating}
                onValueChange={(value) =>
                  setSwitching({ ...switching, minimumInsurerFinancialRating: value })
                }
              />

              <View style={{ marginTop: 12 }}>
                <SectionHeading title="Excluded insurers" helpText={mandateHelp.excludedInsurers} />
                <Field
                  label="Search insurers"
                  helpText={mandateHelp.insurerSearch}
                  value={search}
                  onChangeText={setSearch}
                />
                {filteredInsurers.map((insurer) => {
                  const selected = switching.excludedInsurerIds.includes(insurer.id);
                  return (
                    <View
                      key={insurer.id}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingVertical: 6,
                      }}
                    >
                      <Body>{insurer.name}</Body>
                      <Switch
                        accessibilityLabel={`Exclude ${insurer.name}`}
                        accessibilityHint="When enabled, this insurer cannot be recommended"
                        value={selected}
                        onValueChange={() => toggleExcludedInsurer(insurer.id)}
                      />
                    </View>
                  );
                })}
              </View>
            </Collapsible>
          </Card>

          {error ? <Body style={{ color: "red" }}>{error}</Body> : null}
          <PrimaryButton label="Save changes" onPress={save} loading={busy} />
          <View style={{ height: 24 }} />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
