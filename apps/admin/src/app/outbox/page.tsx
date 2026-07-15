"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Shell } from "@/components/shell";
import { EmptyState, Skeleton, Table, Td, Th } from "@/components/ui";
import { formatEdmonton, titleCase } from "@/lib/utils";

interface OutboxRow {
  id: string;
  to_email: string;
  email_type: string;
  subject: string;
  provider: string;
  sent_at: string | null;
  created_at: string;
}

export default function OutboxPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["outbox"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("email_outbox")
        .select("id, to_email, email_type, subject, provider, sent_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as OutboxRow[];
    },
  });

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-semibold">Email outbox</h1>
      <p className="mb-4 text-sm text-ink-muted">
        When no Resend API key is configured, outgoing email is captured here instead of being sent.
      </p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (data ?? []).length === 0 ? (
        <EmptyState title="No email captured yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>To</Th>
              <Th>Type</Th>
              <Th>Subject</Th>
              <Th>Provider</Th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <Td className="whitespace-nowrap">{formatEdmonton(row.created_at)}</Td>
                <Td>{row.to_email}</Td>
                <Td>{titleCase(row.email_type)}</Td>
                <Td className="max-w-96 truncate">{row.subject}</Td>
                <Td>{row.provider}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Shell>
  );
}
