import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { formatEdmontonDate } from "@/lib/format";
import {
  formatFieldLabel,
  formatFieldValue,
  isRecord,
  OCCUPANCY_LABELS,
  VEHICLE_USE_LABELS,
} from "@/lib/review-entities-helpers";
import type { ExtractionCandidate } from "@/lib/extraction";
import { colors, spacing } from "@autopilot/design-tokens";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";
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
  HouseholdCoverageMandateV2,
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

function formatCoverageEntry(entry: unknown): string {
  if (!isRecord(entry)) return formatFieldValue(entry);
  const status = entry.status;
  if (status === "not_included") return "Not included";
  if (status === "absent" || status === "unknown") return "—";
  const value = entry.value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatCad(value);
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return formatFieldValue(value);
}

function currentPolicyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatCad(value);
  if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return formatEdmontonDate(value);
  }
  return String(value);
}

function CurrentCoverageCard({
  candidate,
  showHeader = true,
}: {
  candidate: ExtractionCandidate;
  showHeader?: boolean;
}) {
  const facts = isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
  const identity = isRecord(facts.identity) ? facts.identity : {};
  const currentPolicy = isRecord(facts.currentPolicy) ? facts.currentPolicy : {};
  const currentCoverage = isRecord(facts.currentCoverage) ? facts.currentCoverage : {};
  const isVehicle = candidate.asset_type === "vehicle";
  const useLabel: string | null = isVehicle
    ? identity.vehicleUse
      ? (VEHICLE_USE_LABELS[String(identity.vehicleUse).toLowerCase()] ??
        String(identity.vehicleUse))
      : null
    : identity.occupancy
      ? (OCCUPANCY_LABELS[String(identity.occupancy).toLowerCase()] ?? String(identity.occupancy))
      : null;

  return (
    <Card>
      {showHeader ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: spacing.sm,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: colors.accentSoft,
              alignItems: "center",
              justifyContent: "center",
              marginRight: spacing.sm,
            }}
          >
            <Body style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>
              {isVehicle ? "AUTO" : "HOME"}
            </Body>
          </View>
          <View style={{ flex: 1 }}>
            <Subtitle style={{ marginBottom: 0, fontSize: 16 }}>{candidate.display_label}</Subtitle>
            {useLabel ? <Caption numberOfLines={1}>{useLabel}</Caption> : null}
          </View>
        </View>
      ) : null}

      <Subtitle style={{ fontSize: 14, marginBottom: spacing.sm }}>Current policy</Subtitle>
      {currentPolicy.insurer !== undefined && currentPolicy.insurer !== null ? (
        <Row label="Insurer" value={String(currentPolicy.insurer)} />
      ) : null}
      {currentPolicy.policyNumber !== undefined && currentPolicy.policyNumber !== null ? (
        <Row label="Policy number" value={String(currentPolicy.policyNumber)} />
      ) : null}
      {currentPolicy.effectiveDate !== undefined && currentPolicy.effectiveDate !== null ? (
        <Row label="Effective date" value={currentPolicyValue(currentPolicy.effectiveDate)} />
      ) : null}
      {currentPolicy.expiryDate !== undefined && currentPolicy.expiryDate !== null ? (
        <Row label="Expiry date" value={currentPolicyValue(currentPolicy.expiryDate)} />
      ) : null}
      {currentPolicy.annualPremiumCents !== undefined &&
      currentPolicy.annualPremiumCents !== null ? (
        <Row label="Annual premium" value={currentPolicyValue(currentPolicy.annualPremiumCents)} />
      ) : null}

      <Subtitle style={{ fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm }}>
        Current coverage
      </Subtitle>
      {Object.keys(currentCoverage).length === 0 ? (
        <Body muted>No coverage details extracted.</Body>
      ) : (
        Object.entries(currentCoverage).map(([key, entry]) => (
          <Row
            key={key}
            label={formatFieldLabel(`currentCoverage.${key}`)}
            value={formatCoverageEntry(entry)}
          />
        ))
      )}
    </Card>
  );
}

function VehicleDetailsCard({
  vehicle,
  candidate,
}: {
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    financing_status: string | null;
    vehicle_use_class: string | null;
    is_classic: boolean;
    is_modified: boolean;
  };
  candidate?: ExtractionCandidate | null;
}) {
  const facts =
    candidate && isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
  const identity = isRecord(facts.identity) ? facts.identity : {};
  const use = identity.vehicleUse
    ? (VEHICLE_USE_LABELS[String(identity.vehicleUse).toLowerCase()] ?? String(identity.vehicleUse))
    : labelForValue(vehicleUseClassOptions, vehicle.vehicle_use_class as VehicleUseClass);
  const financing = labelForValue(
    financingStatusOptions,
    vehicle.financing_status as FinancingStatus,
  );
  const tags = [
    financing,
    use,
    vehicle.is_classic ? "Classic" : null,
    vehicle.is_modified ? "Modified" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const vin = identity.vin ? String(identity.vin) : null;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: colors.accentSoft,
            alignItems: "center",
            justifyContent: "center",
            marginRight: spacing.sm,
          }}
        >
          <Body style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>AUTO</Body>
        </View>
        <View style={{ flex: 1 }}>
          <Subtitle style={{ marginBottom: 0, fontSize: 16 }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Subtitle>
          {tags ? <Caption numberOfLines={1}>{tags}</Caption> : null}
        </View>
      </View>
      {vin ? <Row label="VIN" value={vin} /> : null}
    </Card>
  );
}

function PropertyDetailsCard({
  property,
  candidate,
}: {
  property: {
    id: string;
    address_line1: string | null;
    city: string | null;
    property_type: string | null;
  };
  candidate?: ExtractionCandidate | null;
}) {
  const facts =
    candidate && isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
  const identity = isRecord(facts.identity) ? facts.identity : {};
  const occupancy = identity.occupancy
    ? (OCCUPANCY_LABELS[String(identity.occupancy).toLowerCase()] ?? String(identity.occupancy))
    : null;
  const type = labelForValue(propertyTypeOptions, property.property_type as PropertyType);
  const tags = [type, occupancy].filter(Boolean).join(" · ");

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: colors.accentSoft,
            alignItems: "center",
            justifyContent: "center",
            marginRight: spacing.sm,
          }}
        >
          <Body style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>HOME</Body>
        </View>
        <View style={{ flex: 1 }}>
          <Subtitle style={{ marginBottom: 0, fontSize: 16 }}>
            {property.address_line1}, {property.city}
          </Subtitle>
          {tags ? <Caption numberOfLines={1}>{tags}</Caption> : null}
        </View>
      </View>
    </Card>
  );
}

function AssetRulesCard({
  type,
  assetId,
  mandate,
}: {
  type: "vehicle" | "property";
  assetId: string;
  mandate: HouseholdCoverageMandateV2 | null | undefined;
}) {
  if (!mandate) {
    return (
      <Card>
        <Body muted>Loading rules…</Body>
      </Card>
    );
  }
  if (type === "vehicle") {
    const effective = resolveEffectiveVehicleMandateV2(mandate, assetId);
    const override = mandate.vehicleOverrides.find((o) => o.vehicleId === assetId);
    return (
      <Card>
        {override ? (
          <View style={{ marginBottom: spacing.sm }}>
            <Body muted>Overrides apply to this vehicle</Body>
          </View>
        ) : null}
        {effective ? (
          <AutoMandateRows auto={effective} />
        ) : (
          <Body muted>No vehicle rules set.</Body>
        )}
      </Card>
    );
  }
  const effective = resolveEffectivePropertyMandateV2(mandate, assetId);
  const override = mandate.propertyOverrides.find((o) => o.propertyId === assetId);
  return (
    <Card>
      {override ? (
        <View style={{ marginBottom: spacing.sm }}>
          <Body muted>Overrides apply to this property</Body>
        </View>
      ) : null}
      {effective ? (
        <PropertyMandateRows property={effective} />
      ) : (
        <Body muted>No property rules set.</Body>
      )}
    </Card>
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
      const [drivers, vehicles, properties, insurers, mandateResult, assetCandidates] =
        await Promise.all([
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
          supabase
            .from("asset_candidates")
            .select(
              "id, display_label, asset_type, selected_facts_json, review_status, decision, approved_asset_id, approved_asset_type",
            )
            .eq("household_id", household.id)
            .in("review_status", ["approved", "confirmed"]),
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
        assetCandidates: (assetCandidates.data ?? []) as ExtractionCandidate[],
      };
    },
  });

  const [showCurrentCoverage, setShowCurrentCoverage] = useState<Record<string, boolean>>({});
  const [showAssetRules, setShowAssetRules] = useState<Record<string, boolean>>({});

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
          <Title>Your coverage</Title>
          <Body muted style={{ marginBottom: spacing.md }}>
            Compare your current coverage, per-asset rules, and default coverage rules.
          </Body>

          <Card>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: spacing.sm,
              }}
            >
              <Subtitle style={{ marginBottom: 0 }}>Your assets</Subtitle>
              <Caption>
                {(data?.drivers ?? []).length} driver{(data?.drivers ?? []).length !== 1 ? "s" : ""}
                {" · "}
                {(data?.vehicles ?? []).length} car{(data?.vehicles ?? []).length !== 1 ? "s" : ""}
                {" · "}
                {(data?.properties ?? []).length} propert
                {(data?.properties ?? []).length !== 1 ? "ies" : "y"}
              </Caption>
            </View>

            <Subtitle style={{ fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm }}>
              Cars
            </Subtitle>
            {(data?.vehicles ?? []).length === 0 ? (
              <Body muted>No vehicles on file.</Body>
            ) : (
              (data?.vehicles ?? []).map((vehicle, index) => {
                const candidate = data?.assetCandidates.find(
                  (c) => c.approved_asset_id === vehicle.id && c.approved_asset_type === "vehicle",
                );
                const currentOpen = !!showCurrentCoverage[vehicle.id];
                const rulesOpen = !!showAssetRules[vehicle.id];
                return (
                  <View key={vehicle.id} style={{ marginBottom: spacing.lg }}>
                    <Body style={{ fontWeight: "700", marginBottom: spacing.xs }}>
                      {index + 1}. {vehicle.year} {vehicle.make} {vehicle.model}
                    </Body>
                    <VehicleDetailsCard vehicle={vehicle} candidate={candidate} />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
                      <SecondaryButton
                        label={currentOpen ? "Hide current coverage" : "Current coverage"}
                        onPress={() =>
                          setShowCurrentCoverage((prev) => ({
                            ...prev,
                            [vehicle.id]: !prev[vehicle.id],
                          }))
                        }
                        style={{ flex: 1, paddingVertical: 8 }}
                      />
                      <SecondaryButton
                        label={rulesOpen ? "Hide car rules" : "Car rules"}
                        onPress={() =>
                          setShowAssetRules((prev) => ({
                            ...prev,
                            [vehicle.id]: !prev[vehicle.id],
                          }))
                        }
                        style={{ flex: 1, paddingVertical: 8 }}
                      />
                    </View>
                    {currentOpen && candidate ? (
                      <CurrentCoverageCard candidate={candidate} showHeader={false} />
                    ) : currentOpen ? (
                      <Body muted style={{ marginTop: spacing.sm }}>
                        No current coverage details.
                      </Body>
                    ) : null}
                    {rulesOpen ? (
                      <AssetRulesCard type="vehicle" assetId={vehicle.id} mandate={mandate} />
                    ) : null}
                  </View>
                );
              })
            )}

            <Subtitle style={{ fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm }}>
              Properties
            </Subtitle>
            {(data?.properties ?? []).length === 0 ? (
              <Body muted>No properties on file.</Body>
            ) : (
              (data?.properties ?? []).map((property, index) => {
                const candidate = data?.assetCandidates.find(
                  (c) =>
                    c.approved_asset_id === property.id && c.approved_asset_type === "property",
                );
                const currentOpen = !!showCurrentCoverage[property.id];
                const rulesOpen = !!showAssetRules[property.id];
                return (
                  <View key={property.id} style={{ marginBottom: spacing.lg }}>
                    <Body style={{ fontWeight: "700", marginBottom: spacing.xs }}>
                      {index + 1}. {property.address_line1}, {property.city}
                    </Body>
                    <PropertyDetailsCard property={property} candidate={candidate} />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
                      <SecondaryButton
                        label={currentOpen ? "Hide current coverage" : "Current coverage"}
                        onPress={() =>
                          setShowCurrentCoverage((prev) => ({
                            ...prev,
                            [property.id]: !prev[property.id],
                          }))
                        }
                        style={{ flex: 1, paddingVertical: 8 }}
                      />
                      <SecondaryButton
                        label={rulesOpen ? "Hide property rules" : "Property rules"}
                        onPress={() =>
                          setShowAssetRules((prev) => ({
                            ...prev,
                            [property.id]: !prev[property.id],
                          }))
                        }
                        style={{ flex: 1, paddingVertical: 8 }}
                      />
                    </View>
                    {currentOpen && candidate ? (
                      <CurrentCoverageCard candidate={candidate} showHeader={false} />
                    ) : currentOpen ? (
                      <Body muted style={{ marginTop: spacing.sm }}>
                        No current coverage details.
                      </Body>
                    ) : null}
                    {rulesOpen ? (
                      <AssetRulesCard type="property" assetId={property.id} mandate={mandate} />
                    ) : null}
                  </View>
                );
              })
            )}
          </Card>

          <Card>
            <Subtitle style={{ marginBottom: spacing.sm }}>Coverage rules</Subtitle>

            <Subtitle style={{ fontSize: 14, marginBottom: spacing.sm }}>Switching rules</Subtitle>
            {data?.switching ? (
              <>
                <SwitchingRows prefs={data.switching} />
                <Row
                  label="Excluded insurers"
                  value={data?.excludedNames.length ? data.excludedNames.join(", ") : "None"}
                />
              </>
            ) : (
              <Body muted>Loading…</Body>
            )}

            <Subtitle style={{ fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm }}>
              Default rules for cars
            </Subtitle>
            {mandate ? (
              <AutoMandateRows auto={mandate.householdAutoDefaults} />
            ) : (
              <Body muted>Loading…</Body>
            )}

            <Subtitle style={{ fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm }}>
              Default rules for properties
            </Subtitle>
            {mandate ? (
              <PropertyMandateRows property={mandate.householdPropertyDefaults} />
            ) : (
              <Body muted>Loading…</Body>
            )}
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
