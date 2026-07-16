"use client";

import { useQuery } from "@tanstack/react-query";
import {
  loadHouseholdMandateV2,
  resolveEffectivePropertyMandateV2,
  resolveEffectiveVehicleMandateV2,
} from "@autopilot/database";
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
  labelForLimit,
  labelForPaymentFrequency,
  labelForPreference,
  labelForPropertyForm,
  labelForSettlement,
  propertyOptionalCoverageLabels,
} from "@/lib/mandate";
import type { CaseDetail } from "../page";
import type {
  AutoMandateV2,
  HouseholdCoverageMandateV2,
  PropertyMandateV2,
  SwitchingPreferencesV2,
  WaterCoverageRequirementV2,
} from "@autopilot/schemas";

function KV({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-4 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}

function WaterRows({ name, water }: { name: string; water: WaterCoverageRequirementV2 }) {
  return (
    <>
      <KV label={`${name} preference`} value={labelForPreference(water.preference)} />
      <KV label={`${name} limit`} value={water.limit ? labelForLimit(water.limit) : "—"} />
      <KV
        label={`${name} deductible`}
        value={water.deductible ? labelForDeductible(water.deductible) : "—"}
      />
    </>
  );
}

function AutoMandate({ auto }: { auto: AutoMandateV2 }) {
  return (
    <ul className="space-y-1">
      <KV label="Coverage form" value={labelForAutoForm(auto.coverageForm.value)} />
      <KV
        label="Coverage form preference"
        value={labelForPreference(auto.coverageForm.preference)}
      />
      <KV label="Liability" value={labelForLimit(auto.liability)} />
      <KV label="Collision deductible" value={labelForDeductible(auto.collisionDeductible)} />
      <KV
        label="Comprehensive deductible"
        value={labelForDeductible(auto.comprehensiveDeductible)}
      />
      <KV label="Glass deductible" value={labelForDeductible(auto.glassDeductible)} />
      {(
        Object.entries(autoEndorsementLabels) as [keyof AutoMandateV2["endorsements"], string][]
      ).map(([key, label]) => (
        <KV key={key} label={label} value={labelForPreference(auto.endorsements[key])} />
      ))}
    </ul>
  );
}

function PropertyMandate({ property }: { property: PropertyMandateV2 }) {
  return (
    <ul className="space-y-1">
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
      <KV label="Dwelling limit" value={labelForLimit(property.dwellingLimit)} />
      <KV label="Contents limit" value={labelForLimit(property.contentsLimit)} />
      <KV
        label="Detached structures limit"
        value={labelForLimit(property.detachedStructuresLimit)}
      />
      <KV label="Personal liability limit" value={labelForLimit(property.personalLiabilityLimit)} />
      <KV
        label="Additional living expense limit"
        value={labelForLimit(property.additionalLivingExpenseLimit)}
      />
      <KV label="Base deductible" value={labelForDeductible(property.baseDeductible)} />
      <KV label="Water deductible" value={labelForDeductible(property.waterDeductible)} />
      <KV label="Wind/hail deductible" value={labelForDeductible(property.windHailDeductible)} />
      <KV label="Earthquake deductible" value={labelForDeductible(property.earthquakeDeductible)} />
      <WaterRows name="Sewer backup" water={property.sewerBackup} />
      <WaterRows name="Overland water" water={property.overlandWater} />
      {(
        Object.entries(propertyOptionalCoverageLabels) as [
          keyof PropertyMandateV2["optionalCoverages"],
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
  prefs: SwitchingPreferencesV2;
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
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mandate", caseRow.household_id],
    queryFn: async () => {
      const supabase = supabaseBrowser();
      const [vehicles, properties, insurers, mandateResult] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id, year, make, model")
          .eq("household_id", caseRow.household_id),
        supabase
          .from("properties")
          .select("id, address_line1, city")
          .eq("household_id", caseRow.household_id),
        supabase.from("insurers").select("id, name"),
        loadHouseholdMandateV2(supabase, caseRow.household_id),
      ]);
      const insurerMap = new Map((insurers.data ?? []).map((i) => [i.id, i.name]));
      const excludedNames = (mandateResult.switching.excludedInsurerIds ?? [])
        .map((id) => insurerMap.get(id))
        .filter((name): name is string => Boolean(name));
      return {
        mandate: mandateResult.mandate as HouseholdCoverageMandateV2,
        switching: mandateResult.switching as SwitchingPreferencesV2,
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        excludedNames,
      };
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;

  if (isError) {
    return (
      <Card>
        <CardTitle>Mandate unavailable</CardTitle>
        <p className="text-sm text-ink-muted">Could not load this household&apos;s mandate.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 rounded bg-primary px-4 py-2 text-sm text-white"
        >
          Retry
        </button>
      </Card>
    );
  }

  if (!data) return null;

  const { mandate, switching } = data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Auto — household defaults</CardTitle>
        <AutoMandate auto={mandate.householdAutoDefaults} />
      </Card>

      {data.vehicles.map((vehicle) => {
        const effective = resolveEffectiveVehicleMandateV2(mandate, vehicle.id);
        const override = mandate.vehicleOverrides.find((o) => o.vehicleId === vehicle.id);
        return (
          <Card key={vehicle.id}>
            <CardTitle>
              Vehicle: {vehicle.year} {vehicle.make} {vehicle.model}
            </CardTitle>
            {override ? (
              <p className="mb-2 text-xs text-ink-muted">Overrides apply to this vehicle.</p>
            ) : null}
            <AutoMandate auto={effective} />
          </Card>
        );
      })}

      <Card>
        <CardTitle>Property — household defaults</CardTitle>
        <PropertyMandate property={mandate.householdPropertyDefaults} />
      </Card>

      {data.properties.map((property) => {
        const effective = resolveEffectivePropertyMandateV2(mandate, property.id);
        const override = mandate.propertyOverrides.find((o) => o.propertyId === property.id);
        return (
          <Card key={property.id}>
            <CardTitle>
              Property: {property.address_line1}, {property.city}
            </CardTitle>
            {override ? (
              <p className="mb-2 text-xs text-ink-muted">Overrides apply to this property.</p>
            ) : null}
            <PropertyMandate property={effective} />
          </Card>
        );
      })}

      <Card>
        <CardTitle>Switching rules</CardTitle>
        <SwitchingRules prefs={switching} excludedNames={data.excludedNames} />
      </Card>
    </div>
  );
}
