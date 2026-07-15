"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Button, Card, CardTitle, Input, Skeleton, Table, Td, Th } from "@/components/ui";
import { formatEdmonton, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface InsurerRow {
  id: string;
  name: string;
  active: boolean;
  bundle_supported: boolean;
  products: string[];
}

interface QuoteRequestRow {
  id: string;
  insurer_id: string;
  state: string;
  product_lines: string[];
  inclusion_reason: string;
  sent_at: string | null;
  insurers: { name: string } | null;
}

export function ShortlistTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const { data: insurers, isLoading } = useQuery({
    queryKey: ["insurers"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("insurers")
        .select("id, name, active, bundle_supported, products")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as InsurerRow[];
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["quote-requests", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("quote_requests")
        .select("id, insurer_id, state, product_lines, inclusion_reason, sent_at, insurers(name)")
        .eq("case_id", caseRow.id)
        .order("created_at");
      if (error) throw error;
      return data as unknown as QuoteRequestRow[];
    },
  });

  const requestedInsurerIds = new Set((requests ?? []).map((r) => r.insurer_id));

  const createRequest = useMutation({
    mutationFn: async (insurer: InsurerRow) => {
      const supabase = supabaseBrowser();
      const { error } = await supabase.from("quote_requests").insert({
        case_id: caseRow.id,
        insurer_id: insurer.id,
        state: "queued",
        product_lines: insurer.products,
        inclusion_reason: reasons[insurer.id] ?? "Candidate insurer",
      });
      if (error) throw error;
      await supabase.from("audit_events").insert({
        action: "quote_request_created",
        entity_type: "quote_request",
        household_id: caseRow.household_id,
        case_id: caseRow.id,
        after_summary: { insurer: insurer.name },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-requests", caseRow.id] }),
    onError: (e: Error) => setMessage(e.message),
  });

  const sendEmail = useMutation({
    mutationFn: async (requestId: string) => {
      const supabase = supabaseBrowser();
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/send-quote-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ quoteRequestId: requestId }),
        },
      );
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-requests", caseRow.id] });
      setMessage("Structured quote-request email dispatched through the email adapter.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const markResponse = useMutation({
    mutationFn: async ({ id, state }: { id: string; state: string }) => {
      const { error } = await supabaseBrowser()
        .from("quote_requests")
        .update({ state })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-requests", caseRow.id] }),
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Candidate insurers</CardTitle>
        <p className="mb-3 text-xs text-ink-muted">
          The incumbent is included automatically when quote requests are created. Record why each
          insurer is on the shortlist.
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Insurer</Th>
              <Th>Products</Th>
              <Th>Bundle</Th>
              <Th>Reason for inclusion</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(insurers ?? []).map((insurer) => (
              <tr key={insurer.id}>
                <Td className="font-medium">{insurer.name}</Td>
                <Td>{insurer.products.join(", ")}</Td>
                <Td>{insurer.bundle_supported ? "Yes" : "No"}</Td>
                <Td>
                  <Input
                    placeholder="Why include this insurer?"
                    value={reasons[insurer.id] ?? ""}
                    onChange={(e) =>
                      setReasons((r) => ({ ...r, [insurer.id]: e.target.value }))
                    }
                  />
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={requestedInsurerIds.has(insurer.id) || createRequest.isPending}
                    onClick={() => createRequest.mutate(insurer)}
                  >
                    {requestedInsurerIds.has(insurer.id) ? "Requested" : "Create quote request"}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardTitle>Quote requests</CardTitle>
        <Table>
          <thead>
            <tr>
              <Th>Insurer</Th>
              <Th>Lines</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
              <Th>Reason</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {(requests ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.insurers?.name}</Td>
                <Td>{r.product_lines.join(", ")}</Td>
                <Td>
                  <Badge tone={r.state === "response_received" ? "accent" : "neutral"}>
                    {titleCase(r.state)}
                  </Badge>
                </Td>
                <Td>{formatEdmonton(r.sent_at)}</Td>
                <Td className="max-w-56 truncate">{r.inclusion_reason}</Td>
                <Td className="space-x-2 whitespace-nowrap">
                  {r.state === "queued" ? (
                    <Button size="sm" onClick={() => sendEmail.mutate(r.id)} disabled={sendEmail.isPending}>
                      Send test email
                    </Button>
                  ) : null}
                  {r.state === "sent" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markResponse.mutate({ id: r.id, state: "response_received" })}
                      >
                        Response received
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markResponse.mutate({ id: r.id, state: "declined" })}
                      >
                        Declined
                      </Button>
                    </>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {message ? <p className="mt-3 text-sm text-ink-muted">{message}</p> : null}
      </Card>
    </div>
  );
}
