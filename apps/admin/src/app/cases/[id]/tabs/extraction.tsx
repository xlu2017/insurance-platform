"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Card, EmptyState, Skeleton, Table, Td, Th } from "@/components/ui";
import { titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface Candidate {
  id: string;
  asset_type: string;
  display_label: string;
  occupancy: string | null;
  match_classification: string;
  decision: string;
  review_status: string;
  selected_facts_json: Record<string, string>;
  extracted_fact_assertions: { field_path: string; normalized_value: unknown }[];
}

interface Session {
  id: string;
  status: string;
  created_at: string;
  extracted_documents: { classification: string; file_digest: string; page_count: number }[];
  asset_candidates: Candidate[];
}

export function ExtractionTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["extraction-sessions", caseRow.household_id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("document_extraction_sessions")
        .select(
          "id, status, created_at, extracted_documents(classification, file_digest, page_count), asset_candidates(*, extracted_fact_assertions(field_path, normalized_value))",
        )
        .eq("household_id", caseRow.household_id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as unknown as Session[];
    },
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!sessions || sessions.length === 0) {
    return (
      <EmptyState
        title="No extraction sessions"
        hint="Uploaded documents will appear here after extraction."
      />
    );
  }

  return (
    <div className="space-y-6">
      {sessions.map((session) => (
        <Card key={session.id}>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="font-semibold">Extraction session</h3>
            <Badge>{titleCase(session.status)}</Badge>
          </div>
          <p className="text-sm text-ink-muted">
            {new Date(session.created_at).toLocaleString()} ·{" "}
            {session.extracted_documents?.length ?? 0} document(s)
          </p>
          {(session.asset_candidates?.length ?? 0) > 0 ? (
            <Table className="mt-4">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Label</Th>
                  <Th>Classification</Th>
                  <Th>Decision</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {session.asset_candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <Td>{titleCase(candidate.asset_type)}</Td>
                    <Td>{candidate.display_label}</Td>
                    <Td>{titleCase(candidate.match_classification)}</Td>
                    <Td>{titleCase(candidate.decision)}</Td>
                    <Td>{titleCase(candidate.review_status)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">No candidates extracted yet.</p>
          )}
        </Card>
      ))}
    </div>
  );
}
