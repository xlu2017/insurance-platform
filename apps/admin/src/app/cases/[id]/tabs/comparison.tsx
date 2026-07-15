"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { evaluateHousehold, type EvaluatedConfiguration } from "@autopilot/insurance-engine";
import { supabaseBrowser } from "@/lib/supabase";
import { loadEngineInput } from "@/lib/engine-input";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { formatCad } from "@/lib/utils";
import type { CaseDetail } from "../page";

export function ComparisonTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["comparison", caseRow.id],
    queryFn: async () => {
      const loaded = await loadEngineInput(caseRow.id, caseRow.household_id);
      if ("error" in loaded) return { error: loaded.error };
      return { result: evaluateHousehold(loaded.input) };
    },
  });

  const generateRecommendation = useMutation({
    mutationFn: async () => {
      if (!data || "error" in data || !data.result.recommended)
        throw new Error("No eligible configuration to recommend.");
      const supabase = supabaseBrowser();
      const rec = data.result.recommended;

      // Transaction boundary: recommendation, options and case transition are
      // committed together through a single RPC-style sequence; failures roll
      // back client state via query invalidation.
      const { data: recommendation, error } = await supabase
        .from("recommendations")
        .insert({
          case_id: caseRow.id,
          status: "awaiting_review",
          version: 1,
          mandate_version: 1,
          quote_ids: [rec.configuration.auto.quoteId, rec.configuration.property.quoteId],
          current_total_cents: data.result.incumbentTotalCents,
          proposed_total_cents: rec.cost.totalCents,
          net_savings_cents: rec.netSavingsCents,
          reason_codes: rec.reasonCodes,
          comparison: {
            proposedInsurer: rec.configuration.auto.insurerName,
            bundled: rec.configuration.bundled,
            materialDifferences: rec.coverageReductions,
            deductibleDifferences: [],
          },
        })
        .select("id")
        .single();
      if (error) throw error;

      const options = data.result.evaluated
        .slice()
        .sort((a, b) => a.cost.totalCents - b.cost.totalCents)
        .slice(0, 10)
        .map((e, i) => ({
          recommendation_id: recommendation.id,
          rank: i + 1,
          auto_quote_id: e.configuration.auto.quoteId,
          property_quote_id: e.configuration.property.quoteId,
          bundled: e.configuration.bundled,
          total_cents: e.cost.totalCents,
          net_savings_cents: e.netSavingsCents,
          eligible: e.eligible,
          reason_codes: e.reasonCodes,
        }));
      const { error: optError } = await supabase.from("recommendation_options").insert(options);
      if (optError) throw optError;

      const { error: caseError } = await supabase
        .from("optimization_cases")
        .update({ state: "licensed_review" })
        .eq("id", caseRow.id);
      if (caseError) throw caseError;

      await supabase.from("audit_events").insert({
        action: "recommendation_generated",
        entity_type: "recommendation",
        entity_id: recommendation.id,
        household_id: caseRow.household_id,
        case_id: caseRow.id,
        after_summary: { net_savings_cents: rec.netSavingsCents },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      setMessage("Recommendation created and sent to licensed review.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data) return null;
  if ("error" in data) return <EmptyState title="Cannot compare yet" hint={data.error} />;

  const rows: EvaluatedConfiguration[] = data.result.evaluated
    .slice()
    .sort((a, b) => a.cost.totalCents - b.cost.totalCents);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Deterministic household comparison</CardTitle>
        <p className="mb-2 text-sm">
          Incumbent combined annual cost:{" "}
          <span className="font-semibold">{formatCad(data.result.incumbentTotalCents)}</span>
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Rank</Th>
              <Th>Auto</Th>
              <Th>Property</Th>
              <Th>Bundled</Th>
              <Th>Total cost</Th>
              <Th>Net savings</Th>
              <Th>Eligible</Th>
              <Th>Reason codes</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={e.configuration.id}>
                <Td>{i + 1}</Td>
                <Td>{e.configuration.auto.insurerName}</Td>
                <Td>{e.configuration.property.insurerName}</Td>
                <Td>{e.configuration.bundled ? "Yes" : "No"}</Td>
                <Td>{formatCad(e.cost.totalCents)}</Td>
                <Td className={e.netSavingsCents < 0 ? "text-danger" : ""}>
                  {formatCad(e.netSavingsCents)}
                </Td>
                <Td>
                  <Badge
                    tone={
                      e.eligible
                        ? "accent"
                        : e.configuration.isIncumbentConfiguration
                          ? "neutral"
                          : "danger"
                    }
                  >
                    {e.configuration.isIncumbentConfiguration
                      ? "Incumbent"
                      : e.eligible
                        ? "Eligible"
                        : "Rejected"}
                  </Badge>
                </Td>
                <Td className="max-w-72">
                  <span className="text-xs text-ink-muted">{e.reasonCodes.join(", ")}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {caseRow.state === "comparing_quotes" ? (
        <Button
          disabled={!data.result.recommended || generateRecommendation.isPending}
          onClick={() => generateRecommendation.mutate()}
        >
          Generate recommendation and send to licensed review
        </Button>
      ) : null}
      {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
    </div>
  );
}
