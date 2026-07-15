"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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

const QuoteForm = z.object({
  insurerId: z.string().uuid({ message: "Select an insurer" }),
  state: z.enum(["estimate", "conditional", "bindable"]),
  expiresAt: z.string().optional(),
  autoPremiumDollars: z.coerce.number().nonnegative().optional(),
  propertyPremiumDollars: z.coerce.number().nonnegative().optional(),
  policyFeesDollars: z.coerce.number().nonnegative().default(0),
  paymentFeesDollars: z.coerce.number().nonnegative().default(0),
  bundleDiscountDollars: z.coerce.number().nonnegative().default(0),
  cancellationChargeDollars: z.coerce.number().nonnegative().default(0),
  liabilityLimitDollars: z.coerce.number().nonnegative().default(2_000_000),
  collisionDeductibleDollars: z.coerce.number().nonnegative().default(500),
  comprehensiveDeductibleDollars: z.coerce.number().nonnegative().default(500),
  dwellingLimitDollars: z.coerce.number().nonnegative().default(450_000),
  baseDeductibleDollars: z.coerce.number().nonnegative().default(1000),
  underwritingConditions: z.string().default(""),
  exclusions: z.string().default(""),
  endorsements: z.string().default(""),
});
type QuoteForm = z.infer<typeof QuoteForm>;

interface QuoteRow {
  id: string;
  state: string;
  is_incumbent: boolean;
  policy_fees_cents: number;
  bundle_discount_cents: number;
  underwriting_conditions: string[];
  insurers: { name: string } | null;
  quote_policy_components: { product_line: string; annual_premium_cents: number }[];
}

export function QuotesTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["quotes", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("quotes")
        .select(
          "id, state, is_incumbent, policy_fees_cents, bundle_discount_cents, underwriting_conditions, insurers(name), quote_policy_components(product_line, annual_premium_cents)",
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

  const { register, handleSubmit, reset, formState } = useForm<QuoteForm>({
    resolver: zodResolver(QuoteForm),
    defaultValues: { state: "estimate" },
  });

  const createQuote = useMutation({
    mutationFn: async (values: QuoteForm) => {
      const supabase = supabaseBrowser();
      const conditions = values.underwritingConditions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const { data: quote, error } = await supabase
        .from("quotes")
        .insert({
          case_id: caseRow.id,
          insurer_id: values.insurerId,
          state: values.state,
          policy_fees_cents: Math.round(values.policyFeesDollars * 100),
          payment_fees_cents: Math.round(values.paymentFeesDollars * 100),
          bundle_discount_cents: Math.round(values.bundleDiscountDollars * 100),
          cancellation_charge_cents: Math.round(values.cancellationChargeDollars * 100),
          underwriting_conditions: conditions,
          expires_at: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const components: {
        product_line: string;
        annual_premium_cents: number;
        coverage: Record<string, unknown>;
      }[] = [];
      if (values.autoPremiumDollars && values.autoPremiumDollars > 0) {
        components.push({
          product_line: "auto",
          annual_premium_cents: Math.round(values.autoPremiumDollars * 100),
          coverage: {
            thirdPartyLiabilityCents: Math.round(values.liabilityLimitDollars * 100),
            collisionIncluded: true,
            collisionDeductibleCents: Math.round(values.collisionDeductibleDollars * 100),
            comprehensiveIncluded: true,
            comprehensiveDeductibleCents: Math.round(values.comprehensiveDeductibleDollars * 100),
            accidentForgivenessIncluded: true,
            rentalVehicleCoverageIncluded: true,
            telematicsRequired: false,
            endorsements: values.endorsements,
            exclusions: values.exclusions,
          },
        });
      }
      if (values.propertyPremiumDollars && values.propertyPremiumDollars > 0) {
        components.push({
          product_line: "property",
          annual_premium_cents: Math.round(values.propertyPremiumDollars * 100),
          coverage: {
            dwellingLimitCents: Math.round(values.dwellingLimitDollars * 100),
            replacementCostIncluded: true,
            sewerBackupIncluded: true,
            overlandWaterIncluded: true,
            baseDeductibleCents: Math.round(values.baseDeductibleDollars * 100),
            waterDeductibleCents: 200000,
            additionalLivingExpensesIncluded: true,
            equipmentBreakdownIncluded: false,
            endorsements: values.endorsements,
            exclusions: values.exclusions,
          },
        });
      }
      if (components.length === 0)
        throw new Error("Enter at least one premium (auto or property).");

      for (const component of components) {
        const { data: comp, error: compError } = await supabase
          .from("quote_policy_components")
          .insert({
            quote_id: quote.id,
            product_line: component.product_line,
            annual_premium_cents: component.annual_premium_cents,
          })
          .select("id")
          .single();
        if (compError) throw compError;
        const { error: covError } = await supabase
          .from("quote_coverages")
          .insert({ quote_component_id: comp.id, coverage: component.coverage });
        if (covError) throw covError;
      }

      await supabase.from("audit_events").insert({
        action: "quote_created",
        entity_type: "quote",
        entity_id: quote.id,
        household_id: caseRow.household_id,
        case_id: caseRow.id,
        after_summary: { components: components.length },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes", caseRow.id] });
      reset();
      setMessage("Quote saved.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div>
        <CardTitle>Received quotes</CardTitle>
        <Table>
          <thead>
            <tr>
              <Th>Insurer</Th>
              <Th>Lines</Th>
              <Th>Premiums</Th>
              <Th>Bundle discount</Th>
              <Th>Status</Th>
              <Th>Conditions</Th>
            </tr>
          </thead>
          <tbody>
            {(quotes ?? []).map((q) => (
              <tr key={q.id}>
                <Td className="font-medium">
                  {q.insurers?.name}
                  {q.is_incumbent ? " (incumbent)" : ""}
                </Td>
                <Td>{q.quote_policy_components.map((c) => c.product_line).join(" + ")}</Td>
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
            ))}
          </tbody>
        </Table>
      </div>

      <Card>
        <CardTitle>Enter a quote</CardTitle>
        <form className="space-y-3" onSubmit={handleSubmit((v) => createQuote.mutate(v))}>
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
          </div>
          <div>
            <Label>Underwriting conditions (one per line)</Label>
            <textarea
              className="w-full rounded-md border border-line bg-surface p-2 text-sm"
              rows={2}
              {...register("underwritingConditions")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Endorsements</Label>
              <Input {...register("endorsements")} />
            </div>
            <div>
              <Label>Exclusions</Label>
              <Input {...register("exclusions")} />
            </div>
          </div>
          <Button type="submit" disabled={createQuote.isPending}>
            {createQuote.isPending ? "Saving…" : "Save quote"}
          </Button>
          {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
        </form>
      </Card>
    </div>
  );
}
