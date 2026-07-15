"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Skeleton, Table, Td, Th } from "@/components/ui";
import { formatEdmonton, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  actor_role: string | null;
  before_summary: Record<string, unknown> | null;
  after_summary: Record<string, unknown> | null;
  created_at: string;
  profiles: { full_name: string } | null;
}

export function AuditTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("audit_events")
        .select(
          "id, action, entity_type, actor_role, before_summary, after_summary, created_at, profiles:actor_profile_id(full_name)",
        )
        .or(`case_id.eq.${caseRow.id},household_id.eq.${caseRow.household_id}`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as AuditRow[];
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Actor</Th>
          <Th>Action</Th>
          <Th>Entity</Th>
          <Th>Change</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).map((row) => (
          <tr key={row.id}>
            <Td className="whitespace-nowrap">{formatEdmonton(row.created_at)}</Td>
            <Td>
              {row.profiles?.full_name ?? "System"}
              {row.actor_role ? ` (${row.actor_role})` : ""}
            </Td>
            <Td>{titleCase(row.action)}</Td>
            <Td>{titleCase(row.entity_type)}</Td>
            <Td className="max-w-96 truncate text-xs text-ink-muted">
              {row.before_summary ? `from ${JSON.stringify(row.before_summary)} ` : ""}
              {row.after_summary ? `to ${JSON.stringify(row.after_summary)}` : ""}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
