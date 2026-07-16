"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Json } from "@autopilot/database";
import {
  autoCoverageForms,
  financingStatuses,
  propertyCoverageForms,
  propertySettlements,
  propertyTypes,
  quoteDataSources,
  vehicleUseClasses,
} from "@autopilot/schemas";
import { supabaseBrowser } from "@/lib/supabase";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { formatCad, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

const triStateOptions = [
  { value: "", label: "Unanswered" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_applicable", label: "Not applicable" },
];

function triStateToBoolean(value: string): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no" || value === "not_applicable") return false;
  return undefined;
}

function buildCoverageFlag(form: QuoteForm, key: keyof QuoteForm): boolean | undefined {
  const raw = form[key];
  return triStateToBoolean(typeof raw === "string" ? raw : "");
}

const QuoteForm = z.object({
  insurerId: z.string().uuid({ message: "Select an insurer" }),
  state: z.enum(["estimate", "conditional", "bindable"]),
  isIncumbent: z.boolean().default(false),
  dataSource: z.enum(quoteDataSources as unknown as [string, ...string[]]).default("manual_entry"),
  expiresAt: z.string().optional(),
  autoPremiumDollars: z.coerce.number().nonnegative().optional(),
  propertyPremiumDollars: z.coerce.number().nonnegative().optional(),
  autoAssetId: z.string().optional(),
  propertyAssetId: z.string().optional(),
  policyFeesDollars: z.coerce.number().nonnegative().default(0),
  paymentFeesDollars: z.coerce.number().nonnegative().default(0),
  bundleDiscountDollars: z.coerce.number().nonnegative().default(0),
  cancellationChargeDollars: z.coerce.number().nonnegative().default(0),
  liabilityLimitDollars: z.coerce.number().nonnegative().default(2_000_000),
  collisionDeductibleDollars: z.coerce.number().nonnegative().default(500),
  comprehensiveDeductibleDollars: z.coerce.number().nonnegative().default(500),
  dwellingLimitDollars: z.coerce.number().nonnegative().default(450_000),
  baseDeductibleDollars: z.coerce.number().nonnegative().default(1000),
  contentsLimitDollars: z.coerce.number().nonnegative().default(0),
  detachedStructuresLimitDollars: z.coerce.number().nonnegative().default(0),
  personalLiabilityLimitDollars: z.coerce.number().nonnegative().default(0),
  additionalLivingExpenseLimitDollars: z.coerce.number().nonnegative().default(0),
  waterDeductibleDollars: z.coerce.number().nonnegative().optional(),
  windHailDeductibleDollars: z.coerce.number().nonnegative().optional(),
  earthquakeDeductibleDollars: z.coerce.number().nonnegative().optional(),
  sewerBackupLimitDollars: z.coerce.number().nonnegative().default(0),
  sewerBackupDeductibleDollars: z.coerce.number().nonnegative().default(0),
  overlandWaterLimitDollars: z.coerce.number().nonnegative().default(0),
  overlandWaterDeductibleDollars: z.coerce.number().nonnegative().default(0),
  autoCoverageForm: z
    .enum(autoCoverageForms as unknown as [string, ...string[]])
    .default("unknown"),
  vehicleClass: z.enum(vehicleUseClasses as unknown as [string, ...string[]]).default("unknown"),
  financingStatus: z.enum(financingStatuses as unknown as [string, ...string[]]).default("unknown"),
  propertyType: z.enum(propertyTypes as unknown as [string, ...string[]]).default("unknown"),
  propertyCoverageForm: z
    .enum(propertyCoverageForms as unknown as [string, ...string[]])
    .default("unknown"),
  settlementBasis: z
    .enum(propertySettlements as unknown as [string, ...string[]])
    .default("unknown"),
  collisionIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  comprehensiveIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  accidentForgivenessIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  rentalVehicleCoverageIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  nonOwnedAutomobileIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  familyProtectionIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  depreciationWaiverIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  oemPartsIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  roadsideAssistanceIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  disappearingDeductibleIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  glassCoverageIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  telematicsRequired: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  windHailIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  earthquakeIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  sewerBackupIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  overlandWaterIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  groundwaterIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  iceDamIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  equipmentBreakdownIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  serviceLineIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  bylawCoverageIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  homeSystemsIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  cyberCoverageIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  scheduledValuablesIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  homeBusinessIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  shortTermRentalPermissionIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  claimsForgivenessIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  additionalLivingExpensesIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  replacementCostIncluded: z.enum(["", "yes", "no", "not_applicable"]).default(""),
  underwritingConditions: z.string().default(""),
  endorsements: z.string().default(""),
  exclusions: z.string().default(""),
});

type QuoteForm = z.infer<typeof QuoteForm>;

interface CoverageRow {
  coverage: Json;
  raw_coverage: Json;
  normalized_coverage: Json;
  validation_status: string;
  validation_errors: { path: string[]; code: string; message: string }[];
  data_source: string | null;
  validated_at: string | null;
  validated_by: string | null;
  coverage_schema_version: number | null;
}

interface QuoteComponentRow {
  id: string;
  product_line: string;
  annual_premium_cents: number;
  asset_id: string | null;
  quote_coverages: CoverageRow[];
}

interface QuoteRow {
  id: string;
  state: string;
  version: number;
  is_incumbent: boolean;
  policy_fees_cents: number;
  bundle_discount_cents: number;
  underwriting_conditions: string[];
  insurers: { name: string } | null;
  quote_policy_components: QuoteComponentRow[];
}

export function QuotesTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["quotes", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("quotes")
        .select(
          "id, state, version, is_incumbent, policy_fees_cents, bundle_discount_cents, underwriting_conditions, insurers(name), quote_policy_components(id, product_line, annual_premium_cents, asset_id, quote_coverages(coverage, raw_coverage, normalized_coverage, validation_status, validation_errors, data_source, validated_at, validated_by, coverage_schema_version))",
        )
        .eq("case_id", caseRow.id)
        .order("created_at");
      if (error) throw error;
      return data as unknown as QuoteRow[];
    },
  });

  const { data: insurers } = useQuery({
    queryKey: ["insurers-all"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("insurers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: householdAssets } = useQuery({
    queryKey: ["household-assets", caseRow.household_id],
    queryFn: async () => {
      const supabase = supabaseBrowser();
      const [{ data: vehicles }, { data: properties }] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id, make, model, year")
          .eq("household_id", caseRow.household_id),
        supabase
          .from("properties")
          .select("id, address_line1")
          .eq("household_id", caseRow.household_id),
      ]);
      const v = (vehicles ?? []).map((a) => ({
        id: a.id,
        label: `${a.year ?? ""} ${a.make ?? ""} ${a.model ?? ""}`.trim() || a.id,
      }));
      const p = (properties ?? []).map((a) => ({
        id: a.id,
        label: a.address_line1 || a.id,
      }));
      return { vehicles: v, properties: p };
    },
  });

  const { register, handleSubmit, reset, watch, formState, setValue } = useForm<QuoteForm>({
    resolver: zodResolver(QuoteForm),
    defaultValues: { state: "estimate", isIncumbent: false, dataSource: "manual_entry" },
  });

  const selectedAutoAssetId = watch("autoAssetId");
  const selectedPropertyAssetId = watch("propertyAssetId");

  const saveQuote = useMutation({
    mutationFn: async (values: QuoteForm & { requireValid: boolean }) => {
      const supabase = supabaseBrowser();
      const conditions = values.underwritingConditions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const autoAssetId = values.autoAssetId ?? householdAssets?.vehicles[0]?.id;
      const propertyAssetId = values.propertyAssetId ?? householdAssets?.properties[0]?.id;

      const components: {
        productLine: "auto" | "property";
        assetId: string;
        annualPremiumCents: number;
        coverage: Record<string, unknown>;
      }[] = [];

      if (values.autoPremiumDollars && values.autoPremiumDollars > 0) {
        if (!autoAssetId) throw new Error("No vehicle asset found for this household.");
        const collisionIncluded = buildCoverageFlag(values, "collisionIncluded");
        const comprehensiveIncluded = buildCoverageFlag(values, "comprehensiveIncluded");
        const coverage: Record<string, unknown> = {
          thirdPartyLiabilityCents: Math.round(values.liabilityLimitDollars * 100),
          coverageForm: values.autoCoverageForm,
          collisionDeductibleCents: collisionIncluded
            ? Math.round(values.collisionDeductibleDollars * 100)
            : null,
          comprehensiveDeductibleCents: comprehensiveIncluded
            ? Math.round(values.comprehensiveDeductibleDollars * 100)
            : null,
          glassDeductibleCents: null,
          vehicleClass: values.vehicleClass,
          financingStatus: values.financingStatus,
          endorsements: values.endorsements,
          exclusions: values.exclusions,
        };
        const autoFlags: [string, string][] = [
          ["collisionIncluded", "collisionIncluded"],
          ["comprehensiveIncluded", "comprehensiveIncluded"],
          ["accidentForgivenessIncluded", "accidentForgivenessIncluded"],
          ["rentalVehicleCoverageIncluded", "rentalVehicleCoverageIncluded"],
          ["nonOwnedAutomobileIncluded", "nonOwnedAutomobileIncluded"],
          ["familyProtectionIncluded", "familyProtectionIncluded"],
          ["depreciationWaiverIncluded", "depreciationWaiverIncluded"],
          ["oemPartsIncluded", "oemPartsIncluded"],
          ["roadsideAssistanceIncluded", "roadsideAssistanceIncluded"],
          ["disappearingDeductibleIncluded", "disappearingDeductibleIncluded"],
          ["glassCoverageIncluded", "glassCoverageIncluded"],
          ["telematicsRequired", "telematicsRequired"],
        ];
        for (const [formKey, coverageKey] of autoFlags) {
          const flag = buildCoverageFlag(values, formKey as keyof QuoteForm);
          if (flag !== undefined) coverage[coverageKey] = flag;
        }
        components.push({
          productLine: "auto",
          assetId: autoAssetId,
          annualPremiumCents: Math.round(values.autoPremiumDollars * 100),
          coverage,
        });
      }

      if (values.propertyPremiumDollars && values.propertyPremiumDollars > 0) {
        if (!propertyAssetId) throw new Error("No property asset found for this household.");
        const replacementCost = buildCoverageFlag(values, "replacementCostIncluded");
        const additionalLiving = buildCoverageFlag(values, "additionalLivingExpensesIncluded");
        const coverage: Record<string, unknown> = {
          propertyType: values.propertyType,
          coverageForm: values.propertyCoverageForm,
          settlementBasis: values.settlementBasis,
          dwellingLimitCents: Math.round(values.dwellingLimitDollars * 100),
          contentsLimitCents: Math.round(values.contentsLimitDollars * 100),
          detachedStructuresLimitCents: Math.round(values.detachedStructuresLimitDollars * 100),
          personalLiabilityLimitCents: Math.round(values.personalLiabilityLimitDollars * 100),
          additionalLivingExpenseLimitCents: additionalLiving
            ? Math.round(values.additionalLivingExpenseLimitDollars * 100)
            : 0,
          baseDeductibleCents: Math.round(values.baseDeductibleDollars * 100),
          waterDeductibleCents: values.waterDeductibleDollars
            ? Math.round(values.waterDeductibleDollars * 100)
            : null,
          windHailDeductibleCents: values.windHailDeductibleDollars
            ? Math.round(values.windHailDeductibleDollars * 100)
            : null,
          earthquakeDeductibleCents: values.earthquakeDeductibleDollars
            ? Math.round(values.earthquakeDeductibleDollars * 100)
            : null,
          sewerBackupLimitCents: Math.round(values.sewerBackupLimitDollars * 100),
          sewerBackupDeductibleCents: Math.round(values.sewerBackupDeductibleDollars * 100),
          overlandWaterLimitCents: Math.round(values.overlandWaterLimitDollars * 100),
          overlandWaterDeductibleCents: Math.round(values.overlandWaterDeductibleDollars * 100),
          replacementCostIncluded: replacementCost ?? false,
          additionalLivingExpensesIncluded: additionalLiving ?? false,
          endorsements: values.endorsements,
          exclusions: values.exclusions,
        };
        const propertyFlags: [string, string][] = [
          ["windHailIncluded", "windHailIncluded"],
          ["earthquakeIncluded", "earthquakeIncluded"],
          ["sewerBackupIncluded", "sewerBackupIncluded"],
          ["overlandWaterIncluded", "overlandWaterIncluded"],
          ["groundwaterIncluded", "groundwaterIncluded"],
          ["iceDamIncluded", "iceDamIncluded"],
          ["equipmentBreakdownIncluded", "equipmentBreakdownIncluded"],
          ["serviceLineIncluded", "serviceLineIncluded"],
          ["bylawCoverageIncluded", "bylawCoverageIncluded"],
          ["homeSystemsIncluded", "homeSystemsIncluded"],
          ["cyberCoverageIncluded", "cyberCoverageIncluded"],
          ["scheduledValuablesIncluded", "scheduledValuablesIncluded"],
          ["homeBusinessIncluded", "homeBusinessIncluded"],
          ["shortTermRentalPermissionIncluded", "shortTermRentalPermissionIncluded"],
          ["claimsForgivenessIncluded", "claimsForgivenessIncluded"],
        ];
        for (const [formKey, coverageKey] of propertyFlags) {
          const flag = buildCoverageFlag(values, formKey as keyof QuoteForm);
          if (flag !== undefined) coverage[coverageKey] = flag;
        }
        components.push({
          productLine: "property",
          assetId: propertyAssetId,
          annualPremiumCents: Math.round(values.propertyPremiumDollars * 100),
          coverage,
        });
      }

      if (components.length === 0) {
        throw new Error("Enter at least one premium (auto or property).");
      }

      const { data, error } = await supabase.functions.invoke("save-case-quote", {
        body: {
          caseId: caseRow.id,
          saveIntent: values.requireValid ? "validate" : "draft",
          insurerId: values.insurerId,
          state: values.state,
          isIncumbent: values.isIncumbent,
          expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
          policyFeesCents: Math.round(values.policyFeesDollars * 100),
          paymentFeesCents: Math.round(values.paymentFeesDollars * 100),
          bundleDiscountCents: Math.round(values.bundleDiscountDollars * 100),
          cancellationChargeCents: Math.round(values.cancellationChargeDollars * 100),
          underwritingConditions: conditions,
          dataSource: values.dataSource,
          components,
        },
      });

      if (error) {
        const status = error.context?.statusCode ?? error.status ?? 500;
        if (status === 409) {
          throw new Error(`Version conflict: ${error.message}. Please refresh and try again.`);
        }
        throw new Error(error.message);
      }

      if (data && typeof data === "object" && "success" in data && !data.success) {
        throw new Error((data as { message?: string }).message ?? "Quote save failed");
      }

      const response = data as {
        quoteId?: string;
        version?: number;
        aggregateStatus?: string;
        components?: { validation_status: string; validation_errors?: { message: string }[] }[];
      };

      if (values.requireValid && response.aggregateStatus !== "valid") {
        const errors = (response.components ?? [])
          .flatMap((c) => c.validation_errors ?? [])
          .map((e) => e.message)
          .join("; ");
        throw new Error(
          errors ? `Quote is not valid: ${errors}` : "Quote is not valid. Review missing fields.",
        );
      }

      return response;
    },
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", caseRow.id] });
      setQuoteStatus(variables.requireValid ? "valid" : (response.aggregateStatus ?? "saved"));
      if (variables.requireValid) {
        reset();
        setMessage("Quote validated and saved.");
      } else {
        setMessage("Quote draft saved.");
      }
    },
    onError: (e: Error) => {
      setQuoteStatus("error");
      setMessage(e.message);
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;

  function TriStateSelect({
    label,
    name,
    error,
  }: {
    label: string;
    name: keyof QuoteForm;
    error?: string;
  }) {
    return (
      <div>
        <Label>{label}</Label>
        <Select className="w-full" {...register(name as Path<QuoteForm>)}>
          {triStateOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  function EnumSelect({
    label,
    name,
    options,
    error,
  }: {
    label: string;
    name: keyof QuoteForm;
    options: readonly string[];
    error?: string;
  }) {
    return (
      <div>
        <Label>{label}</Label>
        <Select className="w-full" {...register(name as Path<QuoteForm>)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {titleCase(o)}
            </option>
          ))}
        </Select>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div>
        <CardTitle>Received quotes</CardTitle>
        <Table>
          <thead>
            <tr>
              <Th>Insurer</Th>
              <Th>Lines / validation</Th>
              <Th>Premiums</Th>
              <Th>Bundle discount</Th>
              <Th>Quote state</Th>
              <Th>Conditions</Th>
            </tr>
          </thead>
          <tbody>
            {(quotes ?? []).map((q) => {
              const aggregateStatus =
                q.quote_policy_components.length === 0
                  ? "incomplete"
                  : q.quote_policy_components.every((c) =>
                        c.quote_coverages?.some((r) => r.validation_status === "valid"),
                      )
                    ? "valid"
                    : q.quote_policy_components.some((c) =>
                          c.quote_coverages?.some((r) => r.validation_status === "invalid"),
                        )
                      ? "invalid"
                      : "incomplete";
              return (
                <tr key={q.id}>
                  <Td className="font-medium">
                    {q.insurers?.name}
                    {q.is_incumbent ? " (incumbent)" : ""}
                    <Badge
                      tone={
                        aggregateStatus === "valid"
                          ? "accent"
                          : aggregateStatus === "invalid"
                            ? "danger"
                            : "warning"
                      }
                      className="ml-2"
                    >
                      {titleCase(aggregateStatus)}
                    </Badge>
                  </Td>
                  <Td>
                    {q.quote_policy_components.map((c) => {
                      const cov = c.quote_coverages?.find(
                        (r) => r.validation_status !== "superseded",
                      );
                      const tone =
                        cov?.validation_status === "valid"
                          ? "accent"
                          : cov?.validation_status === "incomplete"
                            ? "warning"
                            : cov?.validation_status === "invalid"
                              ? "danger"
                              : "neutral";
                      return (
                        <div key={c.id} className="mb-2">
                          <div className="text-xs uppercase text-ink-muted">{c.product_line}</div>
                          {cov ? (
                            <Badge tone={tone}>{titleCase(cov.validation_status)}</Badge>
                          ) : (
                            <span className="text-xs text-ink-muted">No coverage row</span>
                          )}
                          {cov?.validation_errors && cov.validation_errors.length > 0 ? (
                            <ul className="mt-1 max-w-xs list-disc pl-4 text-xs text-danger">
                              {cov.validation_errors.map((e, i) => (
                                <li key={i}>{e.message}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                    <div className="mt-1 text-xs text-ink-muted">v{q.version}</div>
                  </Td>
                  <Td>
                    {q.quote_policy_components
                      .map((c) => `${c.product_line}: ${formatCad(c.annual_premium_cents)}`)
                      .join(", ")}
                  </Td>
                  <Td>{q.bundle_discount_cents > 0 ? formatCad(q.bundle_discount_cents) : "—"}</Td>
                  <Td>
                    <Badge tone={q.state === "bindable" ? "accent" : "neutral"}>
                      {titleCase(q.state)}
                    </Badge>
                  </Td>
                  <Td>{q.underwriting_conditions.length}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {quoteStatus ? (
          <p className="mt-2 text-sm text-ink-muted">Last save: {titleCase(quoteStatus)}</p>
        ) : null}
      </div>

      <Card>
        <CardTitle>Enter a quote</CardTitle>
        <form
          className="space-y-3"
          onSubmit={handleSubmit((v) => saveQuote.mutate({ ...v, requireValid: true }))}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Insurer</Label>
              <Select className="w-full" {...register("insurerId")}>
                <option value="">Select insurer</option>
                {(insurers ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              {formState.errors.insurerId ? (
                <p className="mt-1 text-xs text-danger">{formState.errors.insurerId.message}</p>
              ) : null}
            </div>
            <div>
              <Label>Quote type</Label>
              <Select className="w-full" {...register("state")}>
                <option value="estimate">Estimate</option>
                <option value="conditional">Conditional</option>
                <option value="bindable">Bindable</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isIncumbent" {...register("isIncumbent")} />
              <Label htmlFor="isIncumbent">Incumbent</Label>
            </div>
            <div>
              <Label>Data source</Label>
              <Select className="w-full" {...register("dataSource")}>
                {quoteDataSources.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Expiry</Label>
              <Input type="date" {...register("expiresAt")} />
            </div>
            <div>
              <Label>Bundle discount (C$)</Label>
              <Input type="number" step="0.01" {...register("bundleDiscountDollars")} />
            </div>
            <div>
              <Label>Auto premium (C$)</Label>
              <Input type="number" step="0.01" {...register("autoPremiumDollars")} />
            </div>
            <div>
              <Label>Property premium (C$)</Label>
              <Input type="number" step="0.01" {...register("propertyPremiumDollars")} />
            </div>
            <div>
              <Label>Auto asset</Label>
              <Select
                className="w-full"
                value={selectedAutoAssetId ?? householdAssets?.vehicles[0]?.id ?? ""}
                onChange={(e) => setValue("autoAssetId", e.target.value)}
              >
                <option value="">Select vehicle</option>
                {(householdAssets?.vehicles ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Property asset</Label>
              <Select
                className="w-full"
                value={selectedPropertyAssetId ?? householdAssets?.properties[0]?.id ?? ""}
                onChange={(e) => setValue("propertyAssetId", e.target.value)}
              >
                <option value="">Select property</option>
                {(householdAssets?.properties ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Policy fees (C$)</Label>
              <Input type="number" step="0.01" {...register("policyFeesDollars")} />
            </div>
            <div>
              <Label>Payment fees (C$)</Label>
              <Input type="number" step="0.01" {...register("paymentFeesDollars")} />
            </div>
            <div>
              <Label>Cancellation charge (C$)</Label>
              <Input type="number" step="0.01" {...register("cancellationChargeDollars")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <EnumSelect
              label="Auto coverage form"
              name="autoCoverageForm"
              options={autoCoverageForms}
            />
            <EnumSelect label="Vehicle class" name="vehicleClass" options={vehicleUseClasses} />
            <EnumSelect
              label="Financing status"
              name="financingStatus"
              options={financingStatuses}
            />
            <EnumSelect label="Property type" name="propertyType" options={propertyTypes} />
            <EnumSelect
              label="Property coverage form"
              name="propertyCoverageForm"
              options={propertyCoverageForms}
            />
            <EnumSelect
              label="Settlement basis"
              name="settlementBasis"
              options={propertySettlements}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div>
              <Label>Liability limit (C$)</Label>
              <Input type="number" {...register("liabilityLimitDollars")} />
            </div>
            <div>
              <Label>Collision deductible (C$)</Label>
              <Input type="number" {...register("collisionDeductibleDollars")} />
            </div>
            <div>
              <Label>Comprehensive deductible (C$)</Label>
              <Input type="number" {...register("comprehensiveDeductibleDollars")} />
            </div>
            <div>
              <Label>Dwelling limit (C$)</Label>
              <Input type="number" {...register("dwellingLimitDollars")} />
            </div>
            <div>
              <Label>Base deductible (C$)</Label>
              <Input type="number" {...register("baseDeductibleDollars")} />
            </div>
            <div>
              <Label>Contents limit (C$)</Label>
              <Input type="number" {...register("contentsLimitDollars")} />
            </div>
            <div>
              <Label>Detached structures limit (C$)</Label>
              <Input type="number" {...register("detachedStructuresLimitDollars")} />
            </div>
            <div>
              <Label>Personal liability limit (C$)</Label>
              <Input type="number" {...register("personalLiabilityLimitDollars")} />
            </div>
            <div>
              <Label>Additional living expense limit (C$)</Label>
              <Input type="number" {...register("additionalLivingExpenseLimitDollars")} />
            </div>
            <div>
              <Label>Water deductible (C$)</Label>
              <Input type="number" {...register("waterDeductibleDollars")} />
            </div>
            <div>
              <Label>Wind/hail deductible (C$)</Label>
              <Input type="number" {...register("windHailDeductibleDollars")} />
            </div>
            <div>
              <Label>Earthquake deductible (C$)</Label>
              <Input type="number" {...register("earthquakeDeductibleDollars")} />
            </div>
            <div>
              <Label>Sewer backup limit (C$)</Label>
              <Input type="number" {...register("sewerBackupLimitDollars")} />
            </div>
            <div>
              <Label>Sewer backup deductible (C$)</Label>
              <Input type="number" {...register("sewerBackupDeductibleDollars")} />
            </div>
            <div>
              <Label>Overland water limit (C$)</Label>
              <Input type="number" {...register("overlandWaterLimitDollars")} />
            </div>
            <div>
              <Label>Overland water deductible (C$)</Label>
              <Input type="number" {...register("overlandWaterDeductibleDollars")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <TriStateSelect label="Collision" name="collisionIncluded" />
            <TriStateSelect label="Comprehensive" name="comprehensiveIncluded" />
            <TriStateSelect label="Accident forgiveness" name="accidentForgivenessIncluded" />
            <TriStateSelect label="Rental vehicle" name="rentalVehicleCoverageIncluded" />
            <TriStateSelect label="Non-owned automobile" name="nonOwnedAutomobileIncluded" />
            <TriStateSelect label="Family protection" name="familyProtectionIncluded" />
            <TriStateSelect label="Depreciation waiver" name="depreciationWaiverIncluded" />
            <TriStateSelect label="OEM parts" name="oemPartsIncluded" />
            <TriStateSelect label="Roadside assistance" name="roadsideAssistanceIncluded" />
            <TriStateSelect label="Disappearing deductible" name="disappearingDeductibleIncluded" />
            <TriStateSelect label="Glass coverage" name="glassCoverageIncluded" />
            <TriStateSelect label="Telematics required" name="telematicsRequired" />
            <TriStateSelect label="Wind/hail" name="windHailIncluded" />
            <TriStateSelect label="Earthquake" name="earthquakeIncluded" />
            <TriStateSelect label="Sewer backup" name="sewerBackupIncluded" />
            <TriStateSelect label="Overland water" name="overlandWaterIncluded" />
            <TriStateSelect label="Groundwater" name="groundwaterIncluded" />
            <TriStateSelect label="Ice dam" name="iceDamIncluded" />
            <TriStateSelect label="Equipment breakdown" name="equipmentBreakdownIncluded" />
            <TriStateSelect label="Service line" name="serviceLineIncluded" />
            <TriStateSelect label="Bylaw coverage" name="bylawCoverageIncluded" />
            <TriStateSelect label="Home systems" name="homeSystemsIncluded" />
            <TriStateSelect label="Cyber coverage" name="cyberCoverageIncluded" />
            <TriStateSelect label="Scheduled valuables" name="scheduledValuablesIncluded" />
            <TriStateSelect label="Home business" name="homeBusinessIncluded" />
            <TriStateSelect
              label="Short-term rental permission"
              name="shortTermRentalPermissionIncluded"
            />
            <TriStateSelect label="Claims forgiveness" name="claimsForgivenessIncluded" />
            <TriStateSelect label="Replacement cost" name="replacementCostIncluded" />
            <TriStateSelect
              label="Additional living expenses"
              name="additionalLivingExpensesIncluded"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div>
              <Label>Underwriting conditions (one per line)</Label>
              <textarea
                className="w-full rounded-md border border-line bg-surface p-2 text-sm"
                rows={2}
                {...register("underwritingConditions")}
              />
            </div>
            <div>
              <Label>Endorsements</Label>
              <Input {...register("endorsements")} />
            </div>
            <div>
              <Label>Exclusions</Label>
              <Input {...register("exclusions")} />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={saveQuote.isPending}
              onClick={handleSubmit((v) => saveQuote.mutate({ ...v, requireValid: false }))}
            >
              {saveQuote.isPending ? "Saving…" : "Save draft"}
            </Button>
            <Button type="submit" disabled={saveQuote.isPending}>
              {saveQuote.isPending ? "Saving…" : "Validate and save"}
            </Button>
          </div>
          {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
        </form>
      </Card>
    </div>
  );
}
