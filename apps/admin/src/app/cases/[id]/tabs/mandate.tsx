"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import { formatCad } from "@/lib/utils";
import {
  autoEndorsementLabels,
  labelForAutoForm,
  labelForBillingMethod,
  labelForBrokerDirect,
  labelForDeductible,
  labelForFinancialRating,
  labelForFinancingStatus,
  labelForLimit,
  labelForPaymentFrequency,
  labelForPreference,
  labelForPropertyForm,
  labelForPropertyType,
  labelForSettlement,
  labelForVehicleUseClass,
  propertyOptionalCoverageLabels,
} from "@/lib/mandate";
import type { CaseDetail } from "../page";
import type {
  AutoRequirements,
  HouseholdMandate,
  PropertyRequirements,
  SwitchingPreferences,
} from "@autopilot/schemas";

function KV({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-4 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}

function WaterRows({ name, water }: { name: string; water: PropertyRequirements["sewerBackup"] }) {
  return (
    <>
      <KV label={`${name} preference`} value={labelForPreference(water.preference)} />
      <KV label={`${name} limit`} value={labelForLimit(water.limit.rule, water.limit.cents)} />
      <KV
        label={`${name} deductible`}
        value={labelForDeductible(water.deductible.rule, water.deductible.cents)}
      />
    </>
  );
}

function AutoMandate({ auto }: { auto: AutoRequirements }) {
  return (
    <ul className="space-y-1">
      <KV label="Coverage form" value={labelForAutoForm(auto.coverageForm.value)} />
      <KV
        label="Coverage form preference"
        value={labelForPreference(auto.coverageForm.preference)}
      />
      <KV label="Liability" value={labelForLimit(auto.liability.rule, auto.liability.cents)} />
      <KV
        label="Collision deductible"
        value={labelForDeductible(auto.collisionDeductible.rule, auto.collisionDeductible.cents)}
      />
      <KV
        label="Comprehensive deductible"
        value={labelForDeductible(
          auto.comprehensiveDeductible.rule,
          auto.comprehensiveDeductible.cents,
        )}
      />
      <KV
        label="Glass deductible"
        value={labelForDeductible(auto.glassDeductible.rule, auto.glassDeductible.cents)}
      />
      {(
        Object.entries(autoEndorsementLabels) as [keyof AutoRequirements["endorsements"], string][]
      ).map(([key, label]) => (
        <KV key={key} label={label} value={labelForPreference(auto.endorsements[key])} />
      ))}
      <KV label="Vehicle use class" value={labelForVehicleUseClass(auto.vehicleClass)} />
      <KV label="Financing status" value={labelForFinancingStatus(auto.financingStatus)} />
    </ul>
  );
}

function PropertyMandate({ property }: { property: PropertyRequirements }) {
  return (
    <ul className="space-y-1">
      <KV label="Property type" value={labelForPropertyType(property.propertyType)} />
      <KV label="Coverage form" value={labelForPropertyForm(property.coverageForm.value)} />
      <KV
        label="Coverage form preference"
        value={labelForPreference(property.coverageForm.preference)}
      />
      <KV label="Settlement basis" value={labelForSettlement(property.settlementBasis.value)} />
      <KV
        label="Settlement preference"
        value={labelForPreference(property.settlementBasis.preference)}
      />
      <KV
        label="Dwelling limit"
        value={labelForLimit(property.dwellingLimit.rule, property.dwellingLimit.cents)}
      />
      <KV
        label="Contents limit"
        value={labelForLimit(property.contentsLimit.rule, property.contentsLimit.cents)}
      />
      <KV
        label="Detached structures limit"
        value={labelForLimit(
          property.detachedStructuresLimit.rule,
          property.detachedStructuresLimit.cents,
        )}
      />
      <KV
        label="Personal liability limit"
        value={labelForLimit(
          property.personalLiabilityLimit.rule,
          property.personalLiabilityLimit.cents,
        )}
      />
      <KV
        label="Additional living expense limit"
        value={labelForLimit(
          property.additionalLivingExpenseLimit.rule,
          property.additionalLivingExpenseLimit.cents,
        )}
      />
      <KV
        label="Base deductible"
        value={labelForDeductible(property.baseDeductible.rule, property.baseDeductible.cents)}
      />
      <KV
        label="Water deductible"
        value={labelForDeductible(property.waterDeductible.rule, property.waterDeductible.cents)}
      />
      <KV
        label="Wind/hail deductible"
        value={labelForDeductible(
          property.windHailDeductible.rule,
          property.windHailDeductible.cents,
        )}
      />
      <KV
        label="Earthquake deductible"
        value={labelForDeductible(
          property.earthquakeDeductible.rule,
          property.earthquakeDeductible.cents,
        )}
      />
      <WaterRows name="Sewer backup" water={property.sewerBackup} />
      <WaterRows name="Overland water" water={property.overlandWater} />
      {(
        Object.entries(propertyOptionalCoverageLabels) as [
          keyof PropertyRequirements["optionalCoverages"],
          string,
        ][]
      ).map(([key, label]) => (
        <KV key={key} label={label} value={labelForPreference(property.optionalCoverages[key])} />
      ))}
    </ul>
  );
}

function SwitchingRules({
  prefs,
  excludedNames,
}: {
  prefs: SwitchingPreferences;
  excludedNames: string[];
}) {
  return (
    <ul className="space-y-1">
      <KV label="Minimum net annual savings" value={formatCad(prefs.minNetAnnualSavingsCents)} />
      <KV label="Maximum premium increase" value={formatCad(prefs.maxPremiumIncreaseCents)} />
      <KV label="Maximum deductible increase" value={formatCad(prefs.maxDeductibleIncreaseCents)} />
      <KV label="Renewal-only switching" value={prefs.renewalOnlySwitching ? "Yes" : "No"} />
      <KV
        label="Optimize home and auto together"
        value={prefs.householdOptimizationEnabled ? "Yes" : "No"}
      />
      <KV label="Split insurers allowed" value={prefs.splitInsurersAllowed ? "Yes" : "No"} />
      <KV label="Allow bundle breakup" value={prefs.allowBundleBreakup ? "Yes" : "No"} />
      <KV
        label="Deductible increases allowed"
        value={prefs.deductibleIncreasesAllowed ? "Yes" : "No"}
      />
      <KV
        label="Material reductions allowed"
        value={prefs.materialCoverageReductionsAllowed ? "Yes" : "No"}
      />
      <KV
        label="Customer approval required"
        value={prefs.customerApprovalRequired ? "Yes" : "No"}
      />
      <KV
        label="Switch only after approval"
        value={prefs.switchOnlyAfterCustomerApproval ? "Yes" : "No"}
      />
      <KV
        label="Preferred payment frequency"
        value={labelForPaymentFrequency(prefs.preferredPaymentFrequency)}
      />
      <KV
        label="Preferred billing method"
        value={labelForBillingMethod(prefs.preferredBillingMethod)}
      />
      <KV
        label="Broker/direct preference"
        value={labelForBrokerDirect(prefs.brokerDirectPreference)}
      />
      <KV
        label="Minimum insurer rating"
        value={labelForFinancialRating(prefs.minimumInsurerFinancialRating)}
      />
      <KV
        label="Excluded insurers"
        value={excludedNames.length ? excludedNames.join(", ") : "None"}
      />
    </ul>
  );
}

export function MandateTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mandate", caseRow.household_id],
    queryFn: async () => {
      const supabase = supabaseBrowser();
      const [req, prefs, vehicles, properties, insurers] = await Promise.all([
        supabase
          .from("coverage_requirements")
          .select("auto_requirements, property_requirements, vehicle_mandates, property_mandates")
          .eq("household_id", caseRow.household_id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("switching_preferences")
          .select("*")
          .eq("household_id", caseRow.household_id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("vehicles")
          .select("id, year, make, model")
          .eq("household_id", caseRow.household_id),
        supabase
          .from("properties")
          .select("id, address_line1, city")
          .eq("household_id", caseRow.household_id),
        supabase.from("insurers").select("id, name"),
      ]);
      const mandate: HouseholdMandate | null = req.data
        ? {
            auto: req.data.auto_requirements as HouseholdMandate["auto"],
            property: req.data.property_requirements as HouseholdMandate["property"],
            switching: prefs.data as unknown as HouseholdMandate["switching"],
            vehicleOverrides: (req.data.vehicle_mandates ??
              {}) as HouseholdMandate["vehicleOverrides"],
            propertyOverrides: (req.data.property_mandates ??
              {}) as HouseholdMandate["propertyOverrides"],
          }
        : null;
      const excludedNames = ((prefs.data?.excluded_insurer_ids as string[] | undefined) ?? [])
        .map((id) => insurers.data?.find((i) => i.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      return {
        mandate,
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        excludedNames,
      };
    },
  });

  if (isLoading || !data) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Auto — household defaults</CardTitle>
        {data.mandate ? (
          <AutoMandate auto={data.mandate.auto} />
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>

      {data.vehicles.map((vehicle) => {
        const override = data.mandate?.vehicleOverrides?.[vehicle.id];
        const effective = override ? { ...data.mandate!.auto, ...override } : data.mandate?.auto;
        return (
          <Card key={vehicle.id}>
            <CardTitle>
              Vehicle: {vehicle.year} {vehicle.make} {vehicle.model}
            </CardTitle>
            {override ? (
              <p className="mb-2 text-xs text-ink-muted">Overrides apply to this vehicle.</p>
            ) : null}
            {effective ? (
              <AutoMandate auto={effective} />
            ) : (
              <p className="text-sm text-ink-muted">Not set.</p>
            )}
          </Card>
        );
      })}

      <Card>
        <CardTitle>Property — household defaults</CardTitle>
        {data.mandate ? (
          <PropertyMandate property={data.mandate.property} />
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>

      {data.properties.map((property) => {
        const override = data.mandate?.propertyOverrides?.[property.id];
        const effective = override
          ? { ...data.mandate!.property, ...override }
          : data.mandate?.property;
        return (
          <Card key={property.id}>
            <CardTitle>
              Property: {property.address_line1}, {property.city}
            </CardTitle>
            {override ? (
              <p className="mb-2 text-xs text-ink-muted">Overrides apply to this property.</p>
            ) : null}
            {effective ? (
              <PropertyMandate property={effective} />
            ) : (
              <p className="text-sm text-ink-muted">Not set.</p>
            )}
          </Card>
        );
      })}

      <Card>
        <CardTitle>Switching rules</CardTitle>
        {data.mandate ? (
          <SwitchingRules prefs={data.mandate.switching} excludedNames={data.excludedNames} />
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>
    </div>
  );
}
