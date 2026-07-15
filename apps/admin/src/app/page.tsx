"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";
import { Shell } from "@/components/shell";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import { titleCase } from "@/lib/utils";

interface CaseRow {
  id: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export default function OverviewPage() {
  const { data: cases, isLoading } = useQuery({
    queryKey: ["overview-cases"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("optimization_cases")
        .select("id, state, created_at, updated_at");
      if (error) throw error;
      return data as CaseRow[];
    },
  });

  const { data: quoteRequests } = useQuery({
    queryKey: ["overview-quote-requests"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().from("quote_requests").select("id, state");
      if (error) throw error;
      return data as { id: string; state: string }[];
    },
  });

  const byState = new Map<string, number>();
  for (const c of cases ?? []) byState.set(c.state, (byState.get(c.state) ?? 0) + 1);

  const actionStates = [
    "extracting_information",
    "comparing_quotes",
    "licensed_review",
    "customer_decision",
    "switching",
  ];
  const requiringAction = (cases ?? []).filter((c) => actionStates.includes(c.state));
  const awaitingReview = byState.get("licensed_review") ?? 0;
  const approvalsAwaitingExecution = byState.get("customer_decision") ?? 0;
  const responses = (quoteRequests ?? []).filter((q) => q.state === "response_received").length;

  const completed = (cases ?? []).filter((c) => c.state === "completed");
  const avgDays =
    completed.length > 0
      ? Math.round(
          completed.reduce(
            (sum, c) =>
              sum +
              (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86_400_000,
            0,
          ) / completed.length,
        )
      : null;

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-semibold">Overview</h1>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardTitle>Cases requiring action</CardTitle>
              <p className="text-3xl font-semibold">{requiringAction.length}</p>
            </Card>
            <Card>
              <CardTitle>Awaiting licensed review</CardTitle>
              <p className="text-3xl font-semibold">{awaitingReview}</p>
            </Card>
            <Card>
              <CardTitle>Customer approvals to execute</CardTitle>
              <p className="text-3xl font-semibold">{approvalsAwaitingExecution}</p>
            </Card>
            <Card>
              <CardTitle>Quote responses received</CardTitle>
              <p className="text-3xl font-semibold">{responses}</p>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Active cases by state</CardTitle>
              <ul className="space-y-1 text-sm">
                {[...byState.entries()].map(([state, count]) => (
                  <li key={state} className="flex justify-between">
                    <Link href={`/cases?state=${state}`} className="text-accent hover:underline">
                      {titleCase(state)}
                    </Link>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardTitle>Average completion time</CardTitle>
              <p className="text-3xl font-semibold">{avgDays === null ? "—" : `${avgDays} days`}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Across {completed.length} completed case{completed.length === 1 ? "" : "s"}.
              </p>
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}
