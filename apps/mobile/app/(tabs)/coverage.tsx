import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Card, Loading, PrimaryButton, Row, Screen, Subtitle, Title } from "@/components/ui";
import {
  autoCoverageFormOptions,
  autoEndorsementLabels,
  billingMethodOptions,
  brokerDirectOptions,
  coveragePreferenceOptions,
  deductibleRuleOptions,
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
  formatCad,
} from "@/lib/mandate";
import type {
  AutoRequirements,
  PropertyRequirements,
  SwitchingPreferences,
  VehicleUseClass,
  FinancingStatus,
  PropertyType,
} from "@autopilot/schemas";

function labelForValue<T extends string>(
  options: { value: T; label: string }[],
  value: T | undefined,
): string {
  if (value === undefined) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

function displayRuleAndCents(rule: string | undefined, cents: number | undefined): string {
  if (!rule) return "—";
  const ruleLabel = limitRuleOptions.find((o) => o.value === rule)?.label ?? rule;
  if (rule === "any") return "Any";
  return `${ruleLabel} ${formatCad(cents ?? 0)}`;
}

function displayDeductibleRuleAndCents(
  rule: string | undefined,
  cents: number | undefined,
): string {
  if (!rule) return "—";
  const ruleLabel = deductibleRuleOptions.find((o) => o.value === rule)?.label ?? rule;
  if (rule === "any") return "Any";
  return `${ruleLabel} ${formatCad(cents ?? 0)}`;
}

function displayPreference(value: string | undefined): string {
  return coveragePreferenceOptions.find((o) => o.value === value)?.label ?? "—";
}

function AutoMandateRows({ auto }: { auto: AutoRequirements }) {
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
      <Row
        label="Liability"
        value={displayRuleAndCents(auto.liability.rule, auto.liability.cents)}
      />
      <Row
        label="Collision deductible"
        value={displayDeductibleRuleAndCents(
          auto.collisionDeductible.rule,
          auto.collisionDeductible.cents,
        )}
      />
      <Row
        label="Comprehensive deductible"
        value={displayDeductibleRuleAndCents(
          auto.comprehensiveDeductible.rule,
          auto.comprehensiveDeductible.cents,
        )}
      />
      <Row
        label="Glass deductible"
        value={displayDeductibleRuleAndCents(auto.glassDeductible.rule, auto.glassDeductible.cents)}
      />
      {(
        Object.entries(autoEndorsementLabels) as [keyof typeof autoEndorsementLabels, string][]
      ).map(([key, label]) => (
        <Row key={key} label={label} value={displayPreference(auto.endorsements[key])} />
      ))}
      <Row
        label="Vehicle use class"
        value={labelForValue(vehicleUseClassOptions, auto.vehicleClass)}
      />
      <Row
        label="Financing status"
        value={labelForValue(financingStatusOptions, auto.financingStatus)}
      />
    </>
  );
}

function WaterRows({
  name,
  water,
}: {
  name: string;
  water: {
    preference: string;
    limit: { rule: string; cents: number };
    deductible: { rule: string; cents: number };
  };
}) {
  return (
    <>
      <Row label={`${name} preference`} value={displayPreference(water.preference)} />
      <Row
        label={`${name} limit`}
        value={displayRuleAndCents(water.limit.rule, water.limit.cents)}
      />
      <Row
        label={`${name} deductible`}
        value={displayDeductibleRuleAndCents(water.deductible.rule, water.deductible.cents)}
      />
    </>
  );
}

function PropertyMandateRows({ property }: { property: PropertyRequirements }) {
  return (
    <>
      <Row
        label="Property type"
        value={labelForValue(propertyTypeOptions, property.propertyType)}
      />
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
      <Row
        label="Dwelling limit"
        value={displayRuleAndCents(property.dwellingLimit.rule, property.dwellingLimit.cents)}
      />
      <Row
        label="Contents limit"
        value={displayRuleAndCents(property.contentsLimit.rule, property.contentsLimit.cents)}
      />
      <Row
        label="Detached structures limit"
        value={displayRuleAndCents(
          property.detachedStructuresLimit.rule,
          property.detachedStructuresLimit.cents,
        )}
      />
      <Row
        label="Personal liability limit"
        value={displayRuleAndCents(
          property.personalLiabilityLimit.rule,
          property.personalLiabilityLimit.cents,
        )}
      />
      <Row
        label="Additional living expense limit"
        value={displayRuleAndCents(
          property.additionalLivingExpenseLimit.rule,
          property.additionalLivingExpenseLimit.cents,
        )}
      />
      <Row
        label="Base deductible"
        value={displayDeductibleRuleAndCents(
          property.baseDeductible.rule,
          property.baseDeductible.cents,
        )}
      />
      <Row
        label="Water deductible"
        value={displayDeductibleRuleAndCents(
          property.waterDeductible.rule,
          property.waterDeductible.cents,
        )}
      />
      <Row
        label="Wind/hail deductible"
        value={displayDeductibleRuleAndCents(
          property.windHailDeductible.rule,
          property.windHailDeductible.cents,
        )}
      />
      <Row
        label="Earthquake deductible"
        value={displayDeductibleRuleAndCents(
          property.earthquakeDeductible.rule,
          property.earthquakeDeductible.cents,
        )}
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
          keyof typeof propertyOptionalCoverageLabels,
          string,
        ][]
      ).map(([key, label]) => (
        <Row key={key} label={label} value={displayPreference(property.optionalCoverages[key])} />
      ))}
    </>
  );
}

function SwitchingRows({ prefs }: { prefs: SwitchingPreferences }) {
  return (
    <>
      <Row label="Minimum net annual savings" value={formatCad(prefs.minNetAnnualSavingsCents)} />
      <Row label="Maximum premium increase" value={formatCad(prefs.maxPremiumIncreaseCents)} />
      <Row
        label="Maximum deductible increase"
        value={formatCad(prefs.maxDeductibleIncreaseCents)}
      />
      <Row label="Only switch at renewal" value={prefs.renewalOnlySwitching ? "Yes" : "No"} />
      <Row
        label="Optimize home and auto together"
        value={prefs.householdOptimizationEnabled ? "Yes" : "No"}
      />
      <Row label="Split insurers allowed" value={prefs.splitInsurersAllowed ? "Yes" : "No"} />
      <Row label="Allow bundle breakup" value={prefs.allowBundleBreakup ? "Yes" : "No"} />
      <Row
        label="Deductible increases allowed"
        value={prefs.deductibleIncreasesAllowed ? "Yes" : "No"}
      />
      <Row
        label="Material coverage reductions allowed"
        value={prefs.materialCoverageReductionsAllowed ? "Yes" : "No"}
      />
      <Row
        label="Customer approval required"
        value={prefs.customerApprovalRequired ? "Yes" : "No"}
      />
      <Row
        label="Switch only after customer approval"
        value={prefs.switchOnlyAfterCustomerApproval ? "Yes" : "No"}
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
        label="Broker/direct preference"
        value={labelForValue(brokerDirectOptions, prefs.brokerDirectPreference)}
      />
      <Row
        label="Minimum insurer financial rating"
        value={labelForValue(financialRatingOptions, prefs.minimumInsurerFinancialRating)}
      />
    </>
  );
}

export default function Coverage() {
  const { data: household, isLoading } = useHousehold();

  const { data } = useQuery({
    queryKey: ["coverage", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const [drivers, vehicles, properties, requirements, preferences, insurers] =
        await Promise.all([
          supabase.from("drivers").select("id, full_name").eq("household_id", household!.id),
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
          supabase
            .from("coverage_requirements")
            .select("auto_requirements, property_requirements, vehicle_mandates, property_mandates")
            .eq("household_id", household!.id)
            .eq("is_current", true)
            .maybeSingle(),
          supabase
            .from("switching_preferences")
            .select("*")
            .eq("household_id", household!.id)
            .eq("is_current", true)
            .maybeSingle(),
          supabase.from("insurers").select("id, name"),
        ]);
      const mandate = parseHouseholdMandate(requirements.data, preferences.data);
      const excludedNames =
        preferences.data?.excluded_insurer_ids
          ?.map((id: string) => (insurers.data ?? []).find((i) => i.id === id)?.name)
          .filter(Boolean) ?? [];
      return {
        drivers: drivers.data ?? [],
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        requirements: requirements.data,
        preferences: preferences.data,
        mandate,
        excludedNames,
        insurerMap: new Map((insurers.data ?? []).map((i) => [i.id, i.name])),
      };
    },
  });

  if (isLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Create your household to view coverage and mandate details.</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton
          label="Continue setup"
          onPress={() => router.push("/onboarding/household")}
        />
      </Screen>
    );
  }

  const mandate = data?.mandate;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Coverage mandate</Title>
          <Body muted>Your standing instructions. Every comparison is bound by these rules.</Body>
          <PrimaryButton
            label="Edit mandate"
            onPress={() => router.push("/edit-mandate")}
            testID="edit-mandate"
          />
          <View style={{ height: 12 }} />
          <Card>
            <Subtitle>Household</Subtitle>
            <Row
              label="Drivers"
              value={(data?.drivers ?? []).map((d) => d.full_name).join(", ") || "—"}
            />
            <Row
              label="Vehicles"
              value={
                (data?.vehicles ?? []).map((v) => `${v.year} ${v.make} ${v.model}`).join(", ") ||
                "—"
              }
            />
            <Row
              label="Properties"
              value={
                (data?.properties ?? []).map((p) => `${p.address_line1}, ${p.city}`).join("; ") ||
                "—"
              }
            />
          </Card>

          <Card>
            <Subtitle>Auto — household defaults</Subtitle>
            {mandate ? <AutoMandateRows auto={mandate.auto} /> : <Body muted>Loading…</Body>}
          </Card>

          {(data?.vehicles ?? []).map((vehicle) => {
            const override = mandate?.vehicleOverrides?.[vehicle.id];
            const effective = override ? { ...mandate!.auto, ...override } : mandate?.auto;
            return (
              <Card key={vehicle.id}>
                <Subtitle>
                  Vehicle: {vehicle.year} {vehicle.make} {vehicle.model}
                </Subtitle>
                <Body muted>
                  {labelForValue(
                    financingStatusOptions,
                    vehicle.financing_status as FinancingStatus,
                  )}{" "}
                  ·{" "}
                  {labelForValue(
                    vehicleUseClassOptions,
                    vehicle.vehicle_use_class as VehicleUseClass,
                  )}
                  {vehicle.is_classic ? " · Classic" : ""}
                  {vehicle.is_modified ? " · Modified" : ""}
                </Body>
                {override ? (
                  <View style={{ marginVertical: 8 }}>
                    <Body muted>Overrides apply to this vehicle</Body>
                  </View>
                ) : null}
                {effective ? <AutoMandateRows auto={effective} /> : null}
              </Card>
            );
          })}

          <Card>
            <Subtitle>Property — household defaults</Subtitle>
            {mandate ? (
              <PropertyMandateRows property={mandate.property} />
            ) : (
              <Body muted>Loading…</Body>
            )}
          </Card>

          {(data?.properties ?? []).map((property) => {
            const override = mandate?.propertyOverrides?.[property.id];
            const effective = override ? { ...mandate!.property, ...override } : mandate?.property;
            return (
              <Card key={property.id}>
                <Subtitle>
                  Property: {property.address_line1}, {property.city}
                </Subtitle>
                <Body muted>
                  {labelForValue(propertyTypeOptions, property.property_type as PropertyType)}
                </Body>
                {override ? (
                  <View style={{ marginVertical: 8 }}>
                    <Body muted>Overrides apply to this property</Body>
                  </View>
                ) : null}
                {effective ? <PropertyMandateRows property={effective} /> : null}
              </Card>
            );
          })}

          <Card>
            <Subtitle>Switching rules</Subtitle>
            {mandate ? <SwitchingRows prefs={mandate.switching} /> : <Body muted>Loading…</Body>}
            <Row
              label="Excluded insurers"
              value={data?.excludedNames.length ? data.excludedNames.join(", ") : "None"}
            />
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
