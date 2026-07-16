"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { switchTransitions, type SwitchState } from "@autopilot/schemas";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui";
import { formatEdmonton } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface SwitchRow {
  id: string;
  state: SwitchState;
  replacement_confirmed_at: string | null;
  incumbent_cancelled_at: string | null;
  updated_at: string;
}

const stepLabels: Record<SwitchState, string> = {
  customer_approved: "Customer approved",
  replacement_pending: "Replacement pending",
  replacement_confirmed: "Replacement confirmed",
  incumbent_cancellation_pending: "Incumbent cancellation pending",
  incumbent_cancelled: "Incumbent cancelled",
  completed: "Completed",
  failed: "Failed",
};

export function SwitchingTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["switch", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("switch_events")
        .select("*")
        .eq("case_id", caseRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as SwitchRow | null;
    },
  });

  const advance = useMutation({
    mutationFn: async ({ row, next }: { row: SwitchRow; next: SwitchState }) => {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("advance_switch_event", {
        p_switch_event_id: row.id,
        p_target_state: next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["switch", caseRow.id] });
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      setMessage("Switch advanced.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data)
    return (
      <EmptyState
        title="No switch in progress"
        hint="A switch record is created when the customer approves a published recommendation."
      />
    );

  const nextStates = switchTransitions[data.state].filter((s) => s !== "failed");

  return (
    <Card>
      <CardTitle>Simulated switching logistics</CardTitle>
      <div className="mb-4 flex items-center gap-3">
        <Badge tone={data.state === "completed" ? "accent" : "warning"}>
          {stepLabels[data.state]}
        </Badge>
        <span className="text-xs text-ink-muted">Updated {formatEdmonton(data.updated_at)}</span>
      </div>
      <ul className="mb-4 space-y-1 text-sm">
        <li>
          Replacement confirmed:{" "}
          <span className="font-medium">{formatEdmonton(data.replacement_confirmed_at)}</span>
        </li>
        <li>
          Incumbent cancelled:{" "}
          <span className="font-medium">{formatEdmonton(data.incumbent_cancelled_at)}</span>
        </li>
      </ul>
      <p className="mb-3 text-xs text-ink-muted">
        The incumbent policy can never be cancelled before replacement coverage is confirmed — this
        is enforced by the database, not just this interface.
      </p>
      <div className="flex gap-2">
        {nextStates.map((next) => (
          <Button
            key={next}
            variant={next === "completed" ? "default" : "outline"}
            disabled={advance.isPending}
            onClick={() => advance.mutate({ row: data, next })}
          >
            Advance to: {stepLabels[next]}
          </Button>
        ))}
        {data.state !== "completed" && data.state !== "failed" ? (
          <Button
            variant="danger"
            disabled={advance.isPending}
            onClick={() => advance.mutate({ row: data, next: "failed" })}
          >
            Mark failed
          </Button>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-sm text-ink-muted">{message}</p> : null}
    </Card>
  );
}
