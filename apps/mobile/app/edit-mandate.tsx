import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import {
  Body,
  Card,
  Field,
  Loading,
  PrimaryButton,
  Screen,
  Select,
  Subtitle,
  Title,
} from "@/components/ui";
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
import {
  loadHouseholdMandateV2,
  MandateValidationError,
  resolveEffectivePropertyMandateV2,
  resolveEffectiveVehicleMandateV2,
  saveHouseholdMandateV2,
  updatePropertyOverrideV2,
  updateVehicleOverrideV2,
  clearVehicleOverrideV2,
  clearPropertyOverrideV2,
} from "@autopilot/database";
import type {
  AutoMandateOverrideValuesV2,
  AutoMandateV2,
  CoveragePreference,
  HouseholdCoverageMandateV2,
  MonetaryRule,
  PropertyMandateOverrideValuesV2,
  PropertyMandateV2,
  SwitchingPreferencesV2,
  WaterCoverageRequirementV2,
} from "@autopilot/schemas";

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Body style={{ color: "#2563EB", fontWeight: "600" }}>
          {open ? "▾ " : "▸ "}
          {title}
        </Body>
      </Pressable>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

function MonetaryRuleField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: MonetaryRule["rule"]; label: string }[];
  value: MonetaryRule;
  onChange: (next: MonetaryRule) => void;
}) {
  const showAmount = value.rule === "minimum" || value.rule === "maximum" || value.rule === "exact";
  const amountCents = "amountCents" in value ? value.amountCents : 0;
  return (
    <View style={{ marginBottom: 8 }}>
      <Select
        label={`${label} rule`}
        options={options}
        value={value.rule}
        onValueChange={(rule) => {
          if (rule === "minimum" || rule === "maximum" || rule === "exact") {
            onChange({ rule, amountCents });
          } else {
            onChange({ rule });
          }
        }}
      />
      {showAmount ? (
        <Field
          label={`${label} amount (C$)`}
          keyboardType="numeric"
          value={dollarsFromCents(amountCents)}
          onChangeText={(text) =>
            onChange({
              rule: value.rule as "minimum" | "maximum" | "exact",
              amountCents: centsFromDollars(text),
            })
          }
        />
      ) : null}
    </View>
  );
}

function PreferenceSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CoveragePreference;
  onChange: (v: CoveragePreference) => void;
}) {
  return (
    <Select
      label={label}
      options={coveragePreferenceOptions}
      value={value}
      onValueChange={onChange}
    />
  );
}

function WaterEditorV2({
  name,
  value,
  onChange,
}: {
  name: string;
  value: WaterCoverageRequirementV2;
  onChange: (next: WaterCoverageRequirementV2) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <PreferenceSelect
        label={`${name} preference`}
        value={value.preference}
        onChange={(preference) => onChange({ ...value, preference })}
      />
      <MonetaryRuleField
        label={`${name} limit`}
        options={limitRuleOptions}
        value={value.limit}
        onChange={(limit) => onChange({ ...value, limit })}
      />
      <MonetaryRuleField
        label={`${name} deductible`}
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
        options={autoCoverageFormOptions}
        value={value.coverageForm.value}
        onValueChange={(v) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, value: v } })
        }
      />
      <Select
        label="Coverage form preference"
        options={coveragePreferenceOptions}
        value={value.coverageForm.preference}
        onValueChange={(v) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, preference: v } })
        }
      />
      <MonetaryRuleField
        label="Liability"
        options={limitRuleOptions}
        value={value.liability}
        onChange={(liability) => onChange({ ...value, liability })}
      />
      <MonetaryRuleField
        label="Collision deductible"
        options={deductibleRuleOptions}
        value={value.collisionDeductible}
        onChange={(collisionDeductible) => onChange({ ...value, collisionDeductible })}
      />
      <MonetaryRuleField
        label="Comprehensive deductible"
        options={deductibleRuleOptions}
        value={value.comprehensiveDeductible}
        onChange={(comprehensiveDeductible) => onChange({ ...value, comprehensiveDeductible })}
      />
      <MonetaryRuleField
        label="Glass deductible"
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
          value={value.endorsements[key]}
          onChange={(v) =>
            onChange({ ...value, endorsements: { ...value.endorsements, [key]: v } })
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
        options={propertyCoverageFormOptions}
        value={value.coverageForm.value}
        onValueChange={(v) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, value: v } })
        }
      />
      <Select
        label="Coverage form preference"
        options={coveragePreferenceOptions}
        value={value.coverageForm.preference}
        onValueChange={(v) =>
          onChange({ ...value, coverageForm: { ...value.coverageForm, preference: v } })
        }
      />
      <Select
        label="Settlement basis"
        options={propertySettlementOptions}
        value={value.settlementBasis.value}
        onValueChange={(v) =>
          onChange({ ...value, settlementBasis: { ...value.settlementBasis, value: v } })
        }
      />
      <Select
        label="Settlement preference"
        options={coveragePreferenceOptions}
        value={value.settlementBasis.preference}
        onValueChange={(v) =>
          onChange({ ...value, settlementBasis: { ...value.settlementBasis, preference: v } })
        }
      />
      <MonetaryRuleField
        label="Dwelling limit"
        options={limitRuleOptions}
        value={value.dwellingLimit}
        onChange={(dwellingLimit) => onChange({ ...value, dwellingLimit })}
      />
      <MonetaryRuleField
        label="Contents limit"
        options={limitRuleOptions}
        value={value.contentsLimit}
        onChange={(contentsLimit) => onChange({ ...value, contentsLimit })}
      />
      <MonetaryRuleField
        label="Detached structures limit"
        options={limitRuleOptions}
        value={value.detachedStructuresLimit}
        onChange={(detachedStructuresLimit) => onChange({ ...value, detachedStructuresLimit })}
      />
      <MonetaryRuleField
        label="Personal liability limit"
        options={limitRuleOptions}
        value={value.personalLiabilityLimit}
        onChange={(personalLiabilityLimit) => onChange({ ...value, personalLiabilityLimit })}
      />
      <MonetaryRuleField
        label="Additional living expense limit"
        options={limitRuleOptions}
        value={value.additionalLivingExpenseLimit}
        onChange={(additionalLivingExpenseLimit) =>
          onChange({ ...value, additionalLivingExpenseLimit })
        }
      />
      <MonetaryRuleField
        label="Base deductible"
        options={deductibleRuleOptions}
        value={value.baseDeductible}
        onChange={(baseDeductible) => onChange({ ...value, baseDeductible })}
      />
      <MonetaryRuleField
        label="Water deductible"
        options={deductibleRuleOptions}
        value={value.waterDeductible}
        onChange={(waterDeductible) => onChange({ ...value, waterDeductible })}
      />
      <MonetaryRuleField
        label="Wind/hail deductible"
        options={deductibleRuleOptions}
        value={value.windHailDeductible}
        onChange={(windHailDeductible) => onChange({ ...value, windHailDeductible })}
      />
      <MonetaryRuleField
        label="Earthquake deductible"
        options={deductibleRuleOptions}
        value={value.earthquakeDeductible}
        onChange={(earthquakeDeductible) => onChange({ ...value, earthquakeDeductible })}
      />
      <WaterEditorV2
        name="Sewer backup"
        value={value.sewerBackup}
        onChange={(sewerBackup) => onChange({ ...value, sewerBackup })}
      />
      <WaterEditorV2
        name="Overland water"
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
          value={value.optionalCoverages[key]}
          onChange={(v) =>
            onChange({ ...value, optionalCoverages: { ...value.optionalCoverages, [key]: v } })
          }
        />
      ))}
    </>
  );
}

function diffMonetaryRule(a: MonetaryRule, b: MonetaryRule): MonetaryRule | undefined {
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
  const liabilityDiff = diffMonetaryRule(defaults.liability, next.liability);
  if (liabilityDiff) patch.liability = liabilityDiff;
  const collisionDiff = diffMonetaryRule(defaults.collisionDeductible, next.collisionDeductible);
  if (collisionDiff) patch.collisionDeductible = collisionDiff;
  const comprehensiveDiff = diffMonetaryRule(
    defaults.comprehensiveDeductible,
    next.comprehensiveDeductible,
  );
  if (comprehensiveDiff) patch.comprehensiveDeductible = comprehensiveDiff;
  const glassDiff = diffMonetaryRule(defaults.glassDeductible, next.glassDeductible);
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
  const limitDiff = diffMonetaryRule(defaults.limit, next.limit);
  if (limitDiff) patch.limit = limitDiff;
  const deductibleDiff = diffMonetaryRule(defaults.deductible, next.deductible);
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
  const dwellingDiff = diffMonetaryRule(defaults.dwellingLimit, next.dwellingLimit);
  if (dwellingDiff) patch.dwellingLimit = dwellingDiff;
  const contentsDiff = diffMonetaryRule(defaults.contentsLimit, next.contentsLimit);
  if (contentsDiff) patch.contentsLimit = contentsDiff;
  const detachedDiff = diffMonetaryRule(
    defaults.detachedStructuresLimit,
    next.detachedStructuresLimit,
  );
  if (detachedDiff) patch.detachedStructuresLimit = detachedDiff;
  const personalLiabilityDiff = diffMonetaryRule(
    defaults.personalLiabilityLimit,
    next.personalLiabilityLimit,
  );
  if (personalLiabilityDiff) patch.personalLiabilityLimit = personalLiabilityDiff;
  const aleDiff = diffMonetaryRule(
    defaults.additionalLivingExpenseLimit,
    next.additionalLivingExpenseLimit,
  );
  if (aleDiff) patch.additionalLivingExpenseLimit = aleDiff;
  const baseDeductibleDiff = diffMonetaryRule(defaults.baseDeductible, next.baseDeductible);
  if (baseDeductibleDiff) patch.baseDeductible = baseDeductibleDiff;
  const waterDeductibleDiff = diffMonetaryRule(defaults.waterDeductible, next.waterDeductible);
  if (waterDeductibleDiff) patch.waterDeductible = waterDeductibleDiff;
  const windHailDiff = diffMonetaryRule(defaults.windHailDeductible, next.windHailDeductible);
  if (windHailDiff) patch.windHailDeductible = windHailDiff;
  const earthquakeDiff = diffMonetaryRule(defaults.earthquakeDeductible, next.earthquakeDeductible);
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
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
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
      <Body>{label}</Body>
      <Switch value={value} onValueChange={onChange} />
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
              `Mandate validation failed: ${err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
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

  if (householdLoading || isLoading || !household || !mandate || !switching) return <Loading />;

  const updateAuto = (auto: AutoMandateV2) =>
    setMandate((prev) => (prev ? { ...prev, householdAutoDefaults: auto } : prev));
  const updateProperty = (property: PropertyMandateV2) =>
    setMandate((prev) => (prev ? { ...prev, householdPropertyDefaults: property } : prev));

  const handleVehicleOverrideChange = (vehicleId: string, next: AutoMandateV2) => {
    setMandate((prev) => {
      if (!prev) return prev;
      const defaults = prev.householdAutoDefaults;
      const patch = diffAutoMandate(defaults, next);
      return updateVehicleOverrideV2(prev, vehicleId, patch);
    });
  };

  const handlePropertyOverrideChange = (propertyId: string, next: PropertyMandateV2) => {
    setMandate((prev) => {
      if (!prev) return prev;
      const defaults = prev.householdPropertyDefaults;
      const patch = diffPropertyMandate(defaults, next);
      return updatePropertyOverrideV2(prev, propertyId, patch);
    });
  };

  const filteredInsurers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.insurers ?? []).filter((i) => i.name.toLowerCase().includes(term));
  }, [search, data?.insurers]);

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
      const result = await saveHouseholdMandateV2(supabase, {
        householdId: household.id,
        expectedMandateVersion: versions.mandateVersion,
        expectedSwitchingVersion: versions.switchingVersion,
        mandate,
        switching,
      });
      if (!result.success) {
        if (result.code === "STALE_VERSION") {
          setError("The mandate was changed by another session. Please review and save again.");
          queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
        } else {
          setError(result.message ?? "Save failed");
        }
        setBusy(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["coverage", household.id] });
      queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
      setBusy(false);
      router.back();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Edit mandate" }}
      />
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Coverage mandate</Title>
          <Body muted>
            Edit your household defaults, then customize per-vehicle and per-property rules below.
          </Body>
          <View style={{ height: 16 }} />

          <Card>
            <Collapsible title="Auto household defaults">
              <AutoMandateEditorV2
                value={mandate.householdAutoDefaults}
                onChange={updateAuto}
                titleText=""
              />
            </Collapsible>
          </Card>

          <Card>
            <Collapsible title="Property household defaults">
              <PropertyMandateEditorV2
                value={mandate.householdPropertyDefaults}
                onChange={updateProperty}
                titleText=""
              />
            </Collapsible>
          </Card>

          <Card>
            <Subtitle>Vehicles</Subtitle>
            {(data?.vehicles ?? []).length === 0 ? (
              <Body muted>No vehicles on file.</Body>
            ) : (
              (data?.vehicles ?? []).map((vehicle) => {
                const override = mandate.vehicleOverrides.find((o) => o.vehicleId === vehicle.id);
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
                            setMandate((prev) =>
                              prev ? clearVehicleOverrideV2(prev, vehicle.id) : prev,
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
            <Subtitle>Properties</Subtitle>
            {(data?.properties ?? []).length === 0 ? (
              <Body muted>No properties on file.</Body>
            ) : (
              (data?.properties ?? []).map((property) => {
                const override = mandate.propertyOverrides.find(
                  (o) => o.propertyId === property.id,
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
                            setMandate((prev) =>
                              prev ? clearPropertyOverrideV2(prev, property.id) : prev,
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
            <Collapsible title="Switching rules">
              <Field
                label="Minimum net annual savings before switching (C$)"
                keyboardType="numeric"
                value={dollarsFromCents(switching.minNetAnnualSavingsCents)}
                onChangeText={(text) =>
                  setSwitching({ ...switching, minNetAnnualSavingsCents: centsFromDollars(text) })
                }
              />
              <Field
                label="Maximum acceptable deductible increase (C$)"
                keyboardType="numeric"
                value={dollarsFromCents(switching.maxDeductibleIncreaseCents)}
                onChangeText={(text) =>
                  setSwitching({ ...switching, maxDeductibleIncreaseCents: centsFromDollars(text) })
                }
              />
              <Toggle
                label="Only switch at renewal"
                value={switching.renewalOnlySwitching}
                onChange={(v) => setSwitching({ ...switching, renewalOnlySwitching: v })}
              />
              <Toggle
                label="Optimize home and auto together"
                value={switching.householdOptimizationEnabled}
                onChange={(v) => setSwitching({ ...switching, householdOptimizationEnabled: v })}
              />
              <Toggle
                label="Allow different insurers per policy"
                value={switching.splitInsurersAllowed}
                onChange={(v) => setSwitching({ ...switching, splitInsurersAllowed: v })}
              />
              <Toggle
                label="Allow bundle breakup"
                value={switching.allowBundleBreakup}
                onChange={(v) => setSwitching({ ...switching, allowBundleBreakup: v })}
              />
              <Toggle
                label="Allow deductible increases"
                value={switching.deductibleIncreasesAllowed}
                onChange={(v) => setSwitching({ ...switching, deductibleIncreasesAllowed: v })}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 6,
                }}
              >
                <Body>Customer approval required</Body>
                <Body>Yes</Body>
              </View>
              <Select
                label="Preferred payment frequency"
                options={paymentFrequencyOptions}
                value={switching.preferredPaymentFrequency}
                onValueChange={(v) => setSwitching({ ...switching, preferredPaymentFrequency: v })}
              />
              <Select
                label="Preferred billing method"
                options={billingMethodOptions}
                value={switching.preferredBillingMethod}
                onValueChange={(v) => setSwitching({ ...switching, preferredBillingMethod: v })}
              />
              <Select
                label="Broker/direct preference"
                options={brokerDirectOptions}
                value={switching.brokerDirectPreference}
                onValueChange={(v) => setSwitching({ ...switching, brokerDirectPreference: v })}
              />
              <Select
                label="Minimum insurer financial rating"
                options={financialRatingOptions}
                value={switching.minimumInsurerFinancialRating}
                onValueChange={(v) =>
                  setSwitching({ ...switching, minimumInsurerFinancialRating: v })
                }
              />

              <View style={{ marginTop: 12 }}>
                <Subtitle>Excluded insurers</Subtitle>
                <Field label="Search insurers" value={search} onChangeText={setSearch} />
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
