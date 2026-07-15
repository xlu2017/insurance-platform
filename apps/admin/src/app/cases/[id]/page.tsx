"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Shell } from "@/components/shell";
import { Badge, Skeleton } from "@/components/ui";
import { cn, titleCase } from "@/lib/utils";
import { HouseholdTab } from "./tabs/household";
import { PoliciesTab } from "./tabs/policies";
import { DocumentsTab } from "./tabs/documents";
import { MandateTab } from "./tabs/mandate";
import { ShortlistTab } from "./tabs/shortlist";
import { QuotesTab } from "./tabs/quotes";
import { ComparisonTab } from "./tabs/comparison";
import { QuestionsTab } from "./tabs/questions";
import { RecommendationTab } from "./tabs/recommendation";
import { SwitchingTab } from "./tabs/switching";
import { AuditTab } from "./tabs/audit";

const tabs = [
  "household",
  "policies",
  "documents",
  "mandate",
  "shortlist",
  "quotes",
  "comparison",
  "questions",
  "recommendation",
  "switching",
  "audit",
] as const;
type Tab = (typeof tabs)[number];

export interface CaseDetail {
  id: string;
  household_id: string;
  state: string;
  renewal_date: string | null;
  notes: string;
  households: { id: string; name: string; province: string } | null;
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("household");

  const { data: caseRow, isLoading } = useQuery({
    queryKey: ["case", id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("optimization_cases")
        .select("id, household_id, state, renewal_date, notes, households(id, name, province)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as CaseDetail;
    },
  });

  return (
    <Shell>
      {isLoading || !caseRow ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <h1 className="text-xl font-semibold">{caseRow.households?.name ?? "Case"}</h1>
            <Badge tone="accent">{titleCase(caseRow.state)}</Badge>
            <span className="text-sm text-ink-muted">Renewal: {caseRow.renewal_date ?? "—"}</span>
          </div>
          <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-t-md px-3 py-2 text-sm hover:bg-surface",
                  tab === t && "border-b-2 border-accent font-medium text-accent",
                )}
              >
                {titleCase(t)}
              </button>
            ))}
          </div>
          {tab === "household" && <HouseholdTab caseRow={caseRow} />}
          {tab === "policies" && <PoliciesTab caseRow={caseRow} />}
          {tab === "documents" && <DocumentsTab caseRow={caseRow} />}
          {tab === "mandate" && <MandateTab caseRow={caseRow} />}
          {tab === "shortlist" && <ShortlistTab caseRow={caseRow} />}
          {tab === "quotes" && <QuotesTab caseRow={caseRow} />}
          {tab === "comparison" && <ComparisonTab caseRow={caseRow} />}
          {tab === "questions" && <QuestionsTab caseRow={caseRow} />}
          {tab === "recommendation" && <RecommendationTab caseRow={caseRow} />}
          {tab === "switching" && <SwitchingTab caseRow={caseRow} />}
          {tab === "audit" && <AuditTab caseRow={caseRow} />}
        </>
      )}
    </Shell>
  );
}
