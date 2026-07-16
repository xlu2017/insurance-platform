"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui";
import { formatCad } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface GeneratedResult {
  recommendationId: string;
  version: number;
  recommended: {
    totalCents: number;
    netSavingsCents: number;
    autoInsurer: string;
    propertyInsurer: string;
    bundled: boolean;
  };
  optionsCount: number;
}

interface QuoteRow {
  id: string;
  state: string;
  is_incumbent: boolean;
  insurers: { name: string } | null;
  quote_policy_components: { product_line: string; annual_premium_cents: number }[];
}

export function ComparisonTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["case-quotes", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("quotes")
        .select(
          "id, state, is_incumbent, insurers(name), quote_policy_components(product_line, annual_premium_cents)",
        )
        .eq("case_id", caseRow.id);
      if (error) throw error;
      return (data ?? []) as unknown as QuoteRow[];
    },
  });

  const generateRecommendation = useMutation({
    mutationFn: async () => {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.functions.invoke("recommendation-generator", {
        body: { caseId: caseRow.id },
      });
      if (error) throw new Error(error.message ?? "Generation failed");
      if (data && data.error) throw new Error(data.error);
      if (!data || !data.recommendationId) {
        throw new Error(
          data?.eligible === 0 ? "No eligible configuration found." : "Generation failed",
        );
      }
      return data as GeneratedResult;
    },
    onSuccess: (result) => {
      setGenerated(result);
      setMessage("Recommendation created and sent to licensed review.");
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      queryClient.invalidateQueries({ queryKey: ["recommendation", caseRow.id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  const canGenerate = caseRow.state === "comparing_quotes";

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Case quotes</CardTitle>
        {quotes && quotes.length > 0 ? (
          <ul className="mt-2 space-y-2 text-sm">
            {quotes.map((q) => {
              const premium = q.quote_policy_components.reduce(
                (sum, c) => sum + c.annual_premium_cents,
                0,
              );
              return (
                <li
                  key={q.id}
                  className="flex items-center justify-between rounded-md border border-line p-2"
                >
                  <span>
                    {q.insurers?.name ?? "Unknown insurer"} {q.is_incumbent ? "(incumbent)" : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    {formatCad(premium)}
                    <Badge tone={q.state === "bindable" ? "accent" : "warning"}>{q.state}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No quotes entered yet.</p>
        )}
      </Card>

      {generated ? (
        <Card>
          <CardTitle>Generated recommendation v{generated.version}</CardTitle>
          <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <p className="text-xs text-ink-muted">Proposed insurer</p>
              <p className="font-medium">{generated.recommended.autoInsurer}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Proposed annual cost</p>
              <p className="font-medium">{formatCad(generated.recommended.totalCents)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Net annual savings</p>
              <p className="font-medium text-accent">
                {formatCad(generated.recommended.netSavingsCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Bundle</p>
              <p className="font-medium">{generated.recommended.bundled ? "Yes" : "No"}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{generated.optionsCount} options evaluated.</p>
        </Card>
      ) : null}

      {canGenerate ? (
        <Button
          disabled={!quotes || quotes.length === 0 || generateRecommendation.isPending}
          onClick={() => generateRecommendation.mutate()}
        >
          {generateRecommendation.isPending
            ? "Generating…"
            : "Generate recommendation and send to licensed review"}
        </Button>
      ) : (
        <EmptyState
          title="Comparison complete"
          hint={
            caseRow.state === "licensed_review"
              ? "A recommendation has been generated and is awaiting licensed review."
              : "Generate a recommendation while the case is in comparing_quotes."
          }
        />
      )}
      {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
    </div>
  );
}
