"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Skeleton, Table, Td, Th } from "@/components/ui";
import { formatCad, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface PolicyRow {
  id: string;
  insurer_name: string;
  product_line: string;
  policy_number: string | null;
  annual_premium_cents: number;
  bundle_discount_cents: number;
  renewal_date: string | null;
  is_current: boolean;
}

export function PoliciesTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["policies", caseRow.household_id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("policies")
        .select("*")
        .eq("household_id", caseRow.household_id)
        .order("is_current", { ascending: false });
      if (error) throw error;
      return data as PolicyRow[];
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <Table>
      <thead>
        <tr>
          <Th>Insurer</Th>
          <Th>Line</Th>
          <Th>Policy #</Th>
          <Th>Annual premium</Th>
          <Th>Bundle discount</Th>
          <Th>Renewal</Th>
          <Th>Current</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).map((p) => (
          <tr key={p.id}>
            <Td>{p.insurer_name}</Td>
            <Td>{titleCase(p.product_line)}</Td>
            <Td>{p.policy_number ?? "—"}</Td>
            <Td>{formatCad(p.annual_premium_cents)}</Td>
            <Td>{p.bundle_discount_cents > 0 ? formatCad(p.bundle_discount_cents) : "—"}</Td>
            <Td>{p.renewal_date ?? "—"}</Td>
            <Td>{p.is_current ? "Yes" : "No"}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
