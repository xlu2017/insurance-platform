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
  defaultHouseholdMandate,
  deductibleRuleOptions,
  dollarsFromCents,
  financialRatingOptions,
  financingStatusOptions,
  limitRuleOptions,
  parseHouseholdMandate,
  paymentFrequencyOptions,
  propertyCoverageFormOptions,
  propertyOptionalCoverageLabels,
  propertySettlementOptions,
  propertyTypeOptions,
  vehicleUseClassOptions,
} from "@/lib/mandate";
import type {
  AutoRequirements,
  HouseholdMandate,
  PropertyRequirements,
  SwitchingPreferences,
} from "@autopilot/schemas";

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

function LimitField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: {
    rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
    cents: number;
  };
  onChange: (next: {
    rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
    cents: number;
  }) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Select
        label={`${label} rule`}
        options={limitRuleOptions}
        value={value.rule}
        onValueChange={(rule) => onChange({ ...value, rule })}
      />
      {value.rule !== "any" ? (
        <Field
          label={`${label} amount (C$)`}
          keyboardType="numeric"
          value={dollarsFromCents(value.cents)}
          onChangeText={(text) => onChange({ ...value, cents: centsFromDollars(text) })}
        />
      ) : null}
    </View>
  );
}

function DeductibleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: {
    rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
    cents: number;
  };
  onChange: (next: {
    rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
    cents: number;
  }) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Select
        label={`${label} rule`}
        options={deductibleRuleOptions}
        value={value.rule}
        onValueChange={(rule) => onChange({ ...value, rule })}
      />
      {value.rule !== "any" ? (
        <Field
          label={`${label} amount (C$)`}
          keyboardType="numeric"
          value={dollarsFromCents(value.cents)}
          onChangeText={(text) => onChange({ ...value, cents: centsFromDollars(text) })}
        />
      ) : null}
    </View>
  );
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

function PreferenceSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "required" | "preferred" | "indifferent" | "prohibited";
  onChange: (v: "required" | "preferred" | "indifferent" | "prohibited") => void;
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

function AutoRequirementsEditor({
  value,
  onChange,
  titleText,
}: {
  value: AutoRequirements;
  onChange: (next: AutoRequirements) => void;
  titleText: string;
}) {
  return (
    <>
      <Subtitle>{titleText}</Subtitle>
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
      <LimitField
        label="Liability"
        value={value.liability}
        onChange={(liability) => onChange({ ...value, liability })}
      />
      <DeductibleField
        label="Collision deductible"
        value={value.collisionDeductible}
        onChange={(collisionDeductible) => onChange({ ...value, collisionDeductible })}
      />
      <DeductibleField
        label="Comprehensive deductible"
        value={value.comprehensiveDeductible}
        onChange={(comprehensiveDeductible) => onChange({ ...value, comprehensiveDeductible })}
      />
      <DeductibleField
        label="Glass deductible"
        value={value.glassDeductible}
        onChange={(glassDeductible) => onChange({ ...value, glassDeductible })}
      />
      {(
        Object.entries(autoEndorsementLabels) as [keyof AutoRequirements["endorsements"], string][]
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
      <Select
        label="Vehicle use class"
        options={vehicleUseClassOptions}
        value={value.vehicleClass ?? "personal"}
        onValueChange={(v) => onChange({ ...value, vehicleClass: v })}
      />
      <Select
        label="Financing status"
        options={financingStatusOptions}
        value={value.financingStatus ?? "owned"}
        onValueChange={(v) => onChange({ ...value, financingStatus: v })}
      />
    </>
  );
}

function WaterEditor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: {
    preference: "required" | "preferred" | "indifferent" | "prohibited";
    limit: {
      rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
      cents: number;
    };
    deductible: {
      rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
      cents: number;
    };
  };
  onChange: (next: typeof value) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <PreferenceSelect
        label={`${name} preference`}
        value={value.preference}
        onChange={(preference) => onChange({ ...value, preference })}
      />
      <LimitField
        label={`${name} limit`}
        value={value.limit}
        onChange={(limit) => onChange({ ...value, limit })}
      />
      <DeductibleField
        label={`${name} deductible`}
        value={value.deductible}
        onChange={(deductible) => onChange({ ...value, deductible })}
      />
    </View>
  );
}

function PropertyRequirementsEditor({
  value,
  onChange,
  titleText,
}: {
  value: PropertyRequirements;
  onChange: (next: PropertyRequirements) => void;
  titleText: string;
}) {
  return (
    <>
      <Subtitle>{titleText}</Subtitle>
      <Select
        label="Property type"
        options={propertyTypeOptions}
        value={value.propertyType ?? "homeowner"}
        onValueChange={(v) => onChange({ ...value, propertyType: v })}
      />
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
      <LimitField
        label="Dwelling limit"
        value={value.dwellingLimit}
        onChange={(dwellingLimit) => onChange({ ...value, dwellingLimit })}
      />
      <LimitField
        label="Contents limit"
        value={value.contentsLimit}
        onChange={(contentsLimit) => onChange({ ...value, contentsLimit })}
      />
      <LimitField
        label="Detached structures limit"
        value={value.detachedStructuresLimit}
        onChange={(detachedStructuresLimit) => onChange({ ...value, detachedStructuresLimit })}
      />
      <LimitField
        label="Personal liability limit"
        value={value.personalLiabilityLimit}
        onChange={(personalLiabilityLimit) => onChange({ ...value, personalLiabilityLimit })}
      />
      <LimitField
        label="Additional living expense limit"
        value={value.additionalLivingExpenseLimit}
        onChange={(additionalLivingExpenseLimit) =>
          onChange({ ...value, additionalLivingExpenseLimit })
        }
      />
      <DeductibleField
        label="Base deductible"
        value={value.baseDeductible}
        onChange={(baseDeductible) => onChange({ ...value, baseDeductible })}
      />
      <DeductibleField
        label="Water deductible"
        value={value.waterDeductible}
        onChange={(waterDeductible) => onChange({ ...value, waterDeductible })}
      />
      <DeductibleField
        label="Wind/hail deductible"
        value={value.windHailDeductible}
        onChange={(windHailDeductible) => onChange({ ...value, windHailDeductible })}
      />
      <DeductibleField
        label="Earthquake deductible"
        value={value.earthquakeDeductible}
        onChange={(earthquakeDeductible) => onChange({ ...value, earthquakeDeductible })}
      />
      <WaterEditor
        name="Sewer backup"
        value={value.sewerBackup}
        onChange={(sewerBackup) => onChange({ ...value, sewerBackup })}
      />
      <WaterEditor
        name="Overland water"
        value={value.overlandWater}
        onChange={(overlandWater) => onChange({ ...value, overlandWater })}
      />
      {(
        Object.entries(propertyOptionalCoverageLabels) as [
          keyof PropertyRequirements["optionalCoverages"],
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

export default function EditMandate() {
  const { data: household, isLoading: householdLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [mandate, setMandate] = useState<HouseholdMandate>(defaultHouseholdMandate());

  const { data, isLoading } = useQuery({
    queryKey: ["edit-mandate", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const [req, prefs, vehicles, properties, insurers] = await Promise.all([
        supabase
          .from("coverage_requirements")
          .select(
            "id, version, auto_requirements, property_requirements, vehicle_mandates, property_mandates",
          )
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("switching_preferences")
          .select("*")
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("vehicles")
          .select(
            "id, year, make, model, financing_status, vehicle_use_class, is_classic, is_modified",
          )
          .eq("household_id", household!.id),
        supabase
          .from("properties")
          .select("id, address_line1, city, property_type")
          .eq("household_id", household!.id),
        supabase.from("insurers").select("id, name").eq("active", true),
      ]);
      if (req.error) throw req.error;
      if (prefs.error) throw prefs.error;
      if (vehicles.error) throw vehicles.error;
      if (properties.error) throw properties.error;
      return {
        requirements: req.data,
        preferences: prefs.data,
        vehicles: (vehicles.data ?? []) as VehicleRow[],
        properties: (properties.data ?? []) as PropertyRow[],
        insurers: insurers.data ?? [],
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    const parsed = parseHouseholdMandate(data.requirements, data.preferences);
    setMandate(parsed);
  }, [data]);

  if (householdLoading || isLoading || !household) return <Loading />;

  const updateAuto = (auto: AutoRequirements) => setMandate((prev) => ({ ...prev, auto }));
  const updateProperty = (property: PropertyRequirements) =>
    setMandate((prev) => ({ ...prev, property }));
  const updateSwitching = (switching: SwitchingPreferences) =>
    setMandate((prev) => ({ ...prev, switching }));

  const updateVehicleOverride = (id: string, patch: Partial<AutoRequirements>) =>
    setMandate((prev) => ({
      ...prev,
      vehicleOverrides: {
        ...prev.vehicleOverrides,
        [id]: { ...(prev.vehicleOverrides[id] ?? {}), ...patch },
      },
    }));

  const updatePropertyOverride = (id: string, patch: Partial<PropertyRequirements>) =>
    setMandate((prev) => ({
      ...prev,
      propertyOverrides: {
        ...prev.propertyOverrides,
        [id]: { ...(prev.propertyOverrides[id] ?? {}), ...patch },
      },
    }));

  const toggleExcludedInsurer = (insurerId: string) => {
    const current = new Set(mandate.switching.excludedInsurerIds);
    if (current.has(insurerId)) current.delete(insurerId);
    else current.add(insurerId);
    updateSwitching({ ...mandate.switching, excludedInsurerIds: Array.from(current) });
  };

  const filteredInsurers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.insurers ?? []).filter((i) => i.name.toLowerCase().includes(term));
  }, [search, data?.insurers]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const coveragePayload = {
      auto_requirements: mandate.auto,
      property_requirements: mandate.property,
      vehicle_mandates: mandate.vehicleOverrides,
      property_mandates: mandate.propertyOverrides,
      version: ((data?.requirements?.version as number) ?? 1) + 1,
      updated_by: userId,
    };

    let coverageId = data?.requirements?.id as string | undefined;
    if (coverageId) {
      const { error: updateError } = await supabase
        .from("coverage_requirements")
        .update(coveragePayload)
        .eq("id", coverageId);
      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    } else {
      const { data: created, error: insertError } = await supabase
        .from("coverage_requirements")
        .insert({
          household_id: household.id,
          is_current: true,
          ...coveragePayload,
          created_by: userId,
        })
        .select("id")
        .single();
      if (insertError) {
        setBusy(false);
        setError(insertError.message);
        return;
      }
      coverageId = created.id;
    }

    const switchingPayload = {
      ...mandate.switching,
      version: ((data?.preferences?.version as number) ?? 1) + 1,
      updated_by: userId,
    };

    if (data?.preferences?.id) {
      const { error: updateError } = await supabase
        .from("switching_preferences")
        .update(switchingPayload)
        .eq("id", data.preferences.id);
      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("switching_preferences").insert({
        household_id: household.id,
        is_current: true,
        ...switchingPayload,
        created_by: userId,
      });
      if (insertError) {
        setBusy(false);
        setError(insertError.message);
        return;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["coverage", household.id] });
    queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
    setBusy(false);
    router.back();
  };

  const switching = mandate.switching;

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
              <AutoRequirementsEditor value={mandate.auto} onChange={updateAuto} titleText="" />
            </Collapsible>
          </Card>

          <Card>
            <Collapsible title="Property household defaults">
              <PropertyRequirementsEditor
                value={mandate.property}
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
                const override = mandate.vehicleOverrides[vehicle.id] ?? {};
                const effective = { ...mandate.auto, ...override };
                return (
                  <View key={vehicle.id} style={{ marginBottom: 16 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Body>
                    <Collapsible title="Override household defaults">
                      <Select
                        label="Coverage form"
                        options={autoCoverageFormOptions}
                        value={effective.coverageForm.value}
                        onValueChange={(v) =>
                          updateVehicleOverride(vehicle.id, {
                            coverageForm: { ...effective.coverageForm, value: v },
                          })
                        }
                      />
                      <LimitField
                        label="Liability"
                        value={effective.liability}
                        onChange={(liability) => updateVehicleOverride(vehicle.id, { liability })}
                      />
                      <DeductibleField
                        label="Collision deductible"
                        value={effective.collisionDeductible}
                        onChange={(collisionDeductible) =>
                          updateVehicleOverride(vehicle.id, { collisionDeductible })
                        }
                      />
                      <DeductibleField
                        label="Comprehensive deductible"
                        value={effective.comprehensiveDeductible}
                        onChange={(comprehensiveDeductible) =>
                          updateVehicleOverride(vehicle.id, { comprehensiveDeductible })
                        }
                      />
                      <PreferenceSelect
                        label="Telematics"
                        value={effective.endorsements.telematics}
                        onChange={(v) =>
                          updateVehicleOverride(vehicle.id, {
                            endorsements: { ...effective.endorsements, telematics: v },
                          })
                        }
                      />
                      <Select
                        label="Vehicle use class"
                        options={vehicleUseClassOptions}
                        value={effective.vehicleClass ?? "personal"}
                        onValueChange={(v) =>
                          updateVehicleOverride(vehicle.id, { vehicleClass: v })
                        }
                      />
                      <Select
                        label="Financing status"
                        options={financingStatusOptions}
                        value={effective.financingStatus ?? "owned"}
                        onValueChange={(v) =>
                          updateVehicleOverride(vehicle.id, { financingStatus: v })
                        }
                      />
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
                const override = mandate.propertyOverrides[property.id] ?? {};
                const effective = { ...mandate.property, ...override };
                return (
                  <View key={property.id} style={{ marginBottom: 16 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {property.address_line1}, {property.city}
                    </Body>
                    <Collapsible title="Override household defaults">
                      <Select
                        label="Property type"
                        options={propertyTypeOptions}
                        value={effective.propertyType ?? "homeowner"}
                        onValueChange={(v) =>
                          updatePropertyOverride(property.id, { propertyType: v })
                        }
                      />
                      <Select
                        label="Coverage form"
                        options={propertyCoverageFormOptions}
                        value={effective.coverageForm.value}
                        onValueChange={(v) =>
                          updatePropertyOverride(property.id, {
                            coverageForm: { ...effective.coverageForm, value: v },
                          })
                        }
                      />
                      <Select
                        label="Settlement basis"
                        options={propertySettlementOptions}
                        value={effective.settlementBasis.value}
                        onValueChange={(v) =>
                          updatePropertyOverride(property.id, {
                            settlementBasis: { ...effective.settlementBasis, value: v },
                          })
                        }
                      />
                      <LimitField
                        label="Dwelling limit"
                        value={effective.dwellingLimit}
                        onChange={(dwellingLimit) =>
                          updatePropertyOverride(property.id, { dwellingLimit })
                        }
                      />
                      <DeductibleField
                        label="Base deductible"
                        value={effective.baseDeductible}
                        onChange={(baseDeductible) =>
                          updatePropertyOverride(property.id, { baseDeductible })
                        }
                      />
                      <WaterEditor
                        name="Sewer backup"
                        value={effective.sewerBackup}
                        onChange={(sewerBackup) =>
                          updatePropertyOverride(property.id, { sewerBackup })
                        }
                      />
                      <WaterEditor
                        name="Overland water"
                        value={effective.overlandWater}
                        onChange={(overlandWater) =>
                          updatePropertyOverride(property.id, { overlandWater })
                        }
                      />
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
                  updateSwitching({
                    ...switching,
                    minNetAnnualSavingsCents: centsFromDollars(text),
                  })
                }
              />
              <Field
                label="Maximum acceptable premium increase (C$)"
                keyboardType="numeric"
                value={dollarsFromCents(switching.maxPremiumIncreaseCents)}
                onChangeText={(text) =>
                  updateSwitching({ ...switching, maxPremiumIncreaseCents: centsFromDollars(text) })
                }
              />
              <Field
                label="Maximum acceptable deductible increase (C$)"
                keyboardType="numeric"
                value={dollarsFromCents(switching.maxDeductibleIncreaseCents)}
                onChangeText={(text) =>
                  updateSwitching({
                    ...switching,
                    maxDeductibleIncreaseCents: centsFromDollars(text),
                  })
                }
              />
              <Toggle
                label="Only switch at renewal"
                value={switching.renewalOnlySwitching}
                onChange={(v) => updateSwitching({ ...switching, renewalOnlySwitching: v })}
              />
              <Toggle
                label="Optimize home and auto together"
                value={switching.householdOptimizationEnabled}
                onChange={(v) => updateSwitching({ ...switching, householdOptimizationEnabled: v })}
              />
              <Toggle
                label="Allow different insurers per policy"
                value={switching.splitInsurersAllowed}
                onChange={(v) => updateSwitching({ ...switching, splitInsurersAllowed: v })}
              />
              <Toggle
                label="Allow bundle breakup"
                value={switching.allowBundleBreakup}
                onChange={(v) => updateSwitching({ ...switching, allowBundleBreakup: v })}
              />
              <Toggle
                label="Allow deductible increases"
                value={switching.deductibleIncreasesAllowed}
                onChange={(v) => updateSwitching({ ...switching, deductibleIncreasesAllowed: v })}
              />
              <Toggle
                label="Allow material coverage reductions"
                value={switching.materialCoverageReductionsAllowed}
                onChange={(v) =>
                  updateSwitching({ ...switching, materialCoverageReductionsAllowed: v })
                }
              />
              <Toggle
                label="Switch only after customer approval"
                value={switching.switchOnlyAfterCustomerApproval}
                onChange={(v) =>
                  updateSwitching({ ...switching, switchOnlyAfterCustomerApproval: v })
                }
              />
              <Select
                label="Preferred payment frequency"
                options={paymentFrequencyOptions}
                value={switching.preferredPaymentFrequency}
                onValueChange={(v) =>
                  updateSwitching({ ...switching, preferredPaymentFrequency: v })
                }
              />
              <Select
                label="Preferred billing method"
                options={billingMethodOptions}
                value={switching.preferredBillingMethod}
                onValueChange={(v) => updateSwitching({ ...switching, preferredBillingMethod: v })}
              />
              <Select
                label="Broker/direct preference"
                options={brokerDirectOptions}
                value={switching.brokerDirectPreference}
                onValueChange={(v) => updateSwitching({ ...switching, brokerDirectPreference: v })}
              />
              <Select
                label="Minimum insurer financial rating"
                options={financialRatingOptions}
                value={switching.minimumInsurerFinancialRating}
                onValueChange={(v) =>
                  updateSwitching({ ...switching, minimumInsurerFinancialRating: v })
                }
              />

              <View style={{ marginTop: 12 }}>
                <Subtitle>Excluded insurers</Subtitle>
                <Field label="Search insurers" value={search} onChangeText={setSearch} />
                {filteredInsurers.map((insurer) => {
                  const selected = mandate.switching.excludedInsurerIds.includes(insurer.id);
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
