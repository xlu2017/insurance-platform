"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { caseStates } from "@autopilot/schemas";
import { supabaseBrowser } from "@/lib/supabase";
import { Shell } from "@/components/shell";
import { Badge, EmptyState, Input, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { formatEdmonton, titleCase } from "@/lib/utils";

interface QueueRow {
  id: string;
  state: string;
  renewal_date: string | null;
  updated_at: string;
  households: { name: string } | null;
  case_assignments: { assignee_profile_id: string; profiles: { full_name: string } | null }[];
  recommendations: { status: string }[];
}

function CaseQueue() {
  const [state, setState] = useState("");
  const [customer, setCustomer] = useState("");

  useEffect(() => {
    setState(new URLSearchParams(window.location.search).get("state") ?? "");
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["case-queue"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("optimization_cases")
        .select(
          "id, state, renewal_date, updated_at, households(name), case_assignments(assignee_profile_id, profiles(full_name)), recommendations(status)",
        )
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as QueueRow[];
    },
  });

  const rows = (data ?? []).filter(
    (row) =>
      (!state || row.state === state) &&
      (!customer || (row.households?.name ?? "").toLowerCase().includes(customer.toLowerCase())),
  );

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Case queue</h1>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={state}
          onChange={(e) => setState(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {caseStates.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Filter by customer household"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          aria-label="Filter by customer"
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <EmptyState title="No cases match the current filters" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Household</Th>
              <Th>Status</Th>
              <Th>Assignee</Th>
              <Th>Renewal date</Th>
              <Th>Recommendation</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-subtle">
                <Td>
                  <Link
                    href={`/cases/${row.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {row.households?.name ?? "Household"}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={row.state === "licensed_review" ? "warning" : "accent"}>
                    {titleCase(row.state)}
                  </Badge>
                </Td>
                <Td>
                  {row.case_assignments.map((a) => a.profiles?.full_name).join(", ") ||
                    "Unassigned"}
                </Td>
                <Td>{row.renewal_date ?? "—"}</Td>
                <Td>
                  {row.recommendations.length > 0
                    ? titleCase(row.recommendations[row.recommendations.length - 1]!.status)
                    : "—"}
                </Td>
                <Td>{formatEdmonton(row.updated_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export default function CasesPage() {
  return (
    <Shell>
      <CaseQueue />
    </Shell>
  );
}
