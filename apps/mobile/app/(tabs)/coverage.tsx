import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useState } from "react";
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
  formatCad,
  limitRuleOptions,
  paymentFrequencyOptions,
  propertyCoverageFormOptions,
  propertyOptionalCoverageLabels,
  propertySettlementOptions,
  propertyTypeOptions,
  vehicleUseClassOptions,
} from "@/lib/mandate";
import {
  loadHouseholdMandateV2,
  resolveEffectivePropertyMandateV2,
  resolveEffectiveVehicleMandateV2,
} from "@autopilot/database";
import type {
  AutoMandateV2,
  FinancingStatus,
  MonetaryRule,
  PropertyMandateV2,
  PropertyType,
  SwitchingPreferencesV2,
  VehicleUseClass,
} from "@autopilot/schemas";

function labelForValue<T extends string>(
  options: { value: T; label: string }[],
  value: T | undefined,
): string {
  if (value === undefined) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

function displayPreference(value: string | undefined): string {
  return coveragePreferenceOptions.find((o) => o.value === value)?.label ?? "—";
}

function displayMonetaryRule(rule?: MonetaryRule): string {
  if (!rule) return "—";
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return "Match current or better";
  const options = limitRuleOptions;
  const label = options.find((o) => o.value === rule.rule)?.label ?? rule.rule;
  return `${label} ${formatCad(rule.amountCents)}`;
}

function displayDeductibleRule(rule?: MonetaryRule): string {
  if (!rule) return "—";
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return "Match current or better";
  const label = deductibleRuleOptions.find((o) => o.value === rule.rule)?.label ?? rule.rule;
  return `${label} ${formatCad(rule.amountCents)}`;
}

function AutoSummary({ auto }: { auto: AutoMandateV2 }) {
  return (
    <>
      <Row label="Liability" value={displayMonetaryRule(auto.liability)} />
      <Row label="Collision deductible" value={displayDeductibleRule(auto.collisionDeductible)} />
      <Row
        label="Comprehensive deductible"
        value={displayDeductibleRule(auto.comprehensiveDeductible)}
      />
      <Row label="Telematics" value={displayPreference(auto.endorsements.telematics)} />
    </>
  );
}

function PropertySummary({ property }: { property: PropertyMandateV2 }) {
  return (
    <>
      <Row
        label="Replacement-cost coverage"
        value={labelForValue(propertySettlementOptions, property.settlementBasis.value)}
      />
      <Row label="Base deductible" value={displayDeductibleRule(property.baseDeductible)} />
      <Row label="Sewer backup" value={displayPreference(property.sewerBackup.preference)} />
      <Row label="Overland water" value={displayPreference(property.overlandWater.preference)} />
    </>
  );
}

function AutoMandateRows({ auto }: { auto: AutoMandateV2 }) {
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

function PropertyMandateRows({ property }: { property: PropertyMandateV2 }) {
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

function SwitchingRows({ prefs }: { prefs: SwitchingPreferencesV2 }) {
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
    </>
  );
}

export default function Coverage() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();

  const {
    data,
    isLoading: isLoadingCoverage,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["coverage", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) throw new Error("No household");
      const [drivers, vehicles, properties, insurers, mandateResult] = await Promise.all([
        supabase.from("drivers").select("id, full_name").eq("household_id", household.id),
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
        loadHouseholdMandateV2(supabase, household.id),
      ]);
      const insurerMap = new Map((insurers.data ?? []).map((i) => [i.id, i.name]));
      const excludedNames = mandateResult.switching.excludedInsurerIds
        .map((id) => insurerMap.get(id))
        .filter(Boolean);
      return {
        drivers: drivers.data ?? [],
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        mandate: mandateResult.mandate,
        switching: mandateResult.switching,
        excludedNames,
      };
    },
  });

  const [showDetails, setShowDetails] = useState(false);

  if (isLoadingHousehold || isLoadingCoverage) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Set up your account to view your coverage rules.</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton
          label="Continue setup"
          onPress={() => router.push("/onboarding/household")}
        />
      </Screen>
    );
  }

  if (isError) {
    const code = error instanceof Error ? error.name : "LOAD_FAILED";
    const message = error instanceof Error ? error.message : "Could not load coverage details";
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Coverage unavailable</Title>
        <Body muted>{message}</Body>
        <Body muted style={{ marginTop: 8 }}>
          Code: {code}
        </Body>
        <View style={{ height: 16 }} />
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  const mandate = data?.mandate;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Your coverage rules</Title>
          <Body muted>
            These are the coverage and switching rules we will use when comparing your insurance.
          </Body>
          <PrimaryButton
            label={showDetails ? "Hide all coverage details" : "View all coverage details"}
            onPress={() => setShowDetails((value) => !value)}
            testID="toggle-coverage-details"
          />
          <View style={{ height: 12 }} />
          <Card>
            <Subtitle>Your household</Subtitle>
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
            <Subtitle>Rules for all vehicles</Subtitle>
            {mandate ? (
              showDetails ? (
                <AutoMandateRows auto={mandate.householdAutoDefaults} />
              ) : (
                <AutoSummary auto={mandate.householdAutoDefaults} />
              )
            ) : (
              <Body muted>Loading…</Body>
            )}
          </Card>

          {showDetails
            ? (data?.vehicles ?? []).map((vehicle) => {
                const effective = mandate
                  ? resolveEffectiveVehicleMandateV2(mandate, vehicle.id)
                  : undefined;
                const override = mandate?.vehicleOverrides.find((o) => o.vehicleId === vehicle.id);
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
              })
            : null}

          <Card>
            <Subtitle>Rules for all properties</Subtitle>
            {mandate ? (
              showDetails ? (
                <PropertyMandateRows property={mandate.householdPropertyDefaults} />
              ) : (
                <PropertySummary property={mandate.householdPropertyDefaults} />
              )
            ) : (
              <Body muted>Loading…</Body>
            )}
          </Card>

          {showDetails
            ? (data?.properties ?? []).map((property) => {
                const effective = mandate
                  ? resolveEffectivePropertyMandateV2(mandate, property.id)
                  : undefined;
                const override = mandate?.propertyOverrides.find(
                  (o) => o.propertyId === property.id,
                );
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
              })
            : null}

          {showDetails ? (
            <Card>
              <Subtitle>Switching preferences</Subtitle>
              {data?.switching ? (
                <SwitchingRows prefs={data.switching} />
              ) : (
                <Body muted>Loading…</Body>
              )}
              <Row
                label="Excluded insurers"
                value={data?.excludedNames.length ? data.excludedNames.join(", ") : "None"}
              />
            </Card>
          ) : null}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
