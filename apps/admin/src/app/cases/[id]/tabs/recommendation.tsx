"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
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
import { formatCad, formatEdmonton, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface RecommendationRow {
  id: string;
  status: string;
  version: number;
  current_total_cents: number;
  proposed_total_cents: number;
  net_savings_cents: number;
  reason_codes: string[];
  comparison: { proposedInsurer?: string; bundled?: boolean };
  created_at: string;
  recommendation_options: {
    rank: number;
    bundled: boolean;
    total_cents: number;
    net_savings_cents: number;
    eligible: boolean;
    reason_codes: string[];
  }[];
  recommendation_approvals: {
    approver_role: string;
    approved: boolean;
    notes: string;
    created_at: string;
    profiles: { full_name: string } | null;
  }[];
}

export function RecommendationTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();
      setRole(profile?.role ?? null);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["recommendation", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("recommendations")
        .select(
          "*, recommendation_options(rank, bundled, total_cents, net_savings_cents, eligible, reason_codes), recommendation_approvals(approver_role, approved, notes, created_at, profiles(full_name))",
        )
        .eq("case_id", caseRow.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as RecommendationRow[];
    },
  });

  const review = useMutation({
    mutationFn: async ({ rec, approved }: { rec: RecommendationRow; approved: boolean }) => {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("review_recommendation", {
        p_recommendation_id: rec.id,
        p_approved: approved,
        p_notes: approved ? "Licensed review approval" : "Licensed review rejection",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recommendation", caseRow.id] });
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      setMessage("Review recorded.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data || data.length === 0)
    return (
      <EmptyState
        title="No recommendation yet"
        hint="Generate one from the Comparison tab once quotes are entered."
      />
    );

  return (
    <div className="space-y-4">
      {data.map((rec) => (
        <Card key={rec.id}>
          <div className="mb-3 flex items-center gap-3">
            <CardTitle className="mb-0">Recommendation v{rec.version}</CardTitle>
            <Badge
              tone={
                rec.status === "awaiting_review"
                  ? "warning"
                  : rec.status === "rejected"
                    ? "danger"
                    : "accent"
              }
            >
              {titleCase(rec.status)}
            </Badge>
            <span className="text-xs text-ink-muted">{formatEdmonton(rec.created_at)}</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <p className="text-xs text-ink-muted">Proposed insurer</p>
              <p className="font-medium">{rec.comparison.proposedInsurer ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Current annual cost</p>
              <p className="font-medium">{formatCad(rec.current_total_cents)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Proposed annual cost</p>
              <p className="font-medium">{formatCad(rec.proposed_total_cents)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Net annual savings</p>
              <p className="font-medium text-accent">{formatCad(rec.net_savings_cents)}</p>
            </div>
          </div>
          <p className="mb-3 text-xs text-ink-muted">Reason codes: {rec.reason_codes.join(", ")}</p>
          {rec.recommendation_options.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>Rank</Th>
                  <Th>Bundled</Th>
                  <Th>Total</Th>
                  <Th>Savings</Th>
                  <Th>Eligible</Th>
                </tr>
              </thead>
              <tbody>
                {rec.recommendation_options
                  .slice()
                  .sort((a, b) => a.rank - b.rank)
                  .map((o) => (
                    <tr key={o.rank}>
                      <Td>{o.rank}</Td>
                      <Td>{o.bundled ? "Yes" : "No"}</Td>
                      <Td>{formatCad(o.total_cents)}</Td>
                      <Td>{formatCad(o.net_savings_cents)}</Td>
                      <Td>{o.eligible ? "Yes" : "No"}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          ) : null}
          {rec.recommendation_approvals.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {rec.recommendation_approvals.map((a, i) => (
                <li key={i} className="text-ink-muted">
                  {a.approved ? "Approved" : "Rejected"} by{" "}
                  {a.profiles?.full_name ?? a.approver_role} ({a.approver_role}) —{" "}
                  {formatEdmonton(a.created_at)}
                </li>
              ))}
            </ul>
          ) : null}
          {rec.status === "awaiting_review" &&
          (role === "reviewer" || role === "admin") &&
          caseRow.state === "licensed_review" ? (
            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => review.mutate({ rec, approved: true })}
                disabled={review.isPending}
              >
                Approve and publish to customer
              </Button>
              <Button
                variant="outline"
                onClick={() => review.mutate({ rec, approved: false })}
                disabled={review.isPending}
              >
                Reject back to comparison
              </Button>
            </div>
          ) : rec.status === "awaiting_review" ? (
            <p className="mt-3 text-xs text-ink-muted">
              Awaiting licensed reviewer approval. Sign in as a reviewer to approve.
            </p>
          ) : null}
        </Card>
      ))}
      {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
    </div>
  );
}
