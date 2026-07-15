"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import { formatCad } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface RequirementsRow {
  auto_requirements: Record<string, number | boolean>;
  property_requirements: Record<string, number | boolean>;
}

interface PreferencesRow {
  min_net_annual_savings_cents: number;
  renewal_only_switching: boolean;
  household_optimization_enabled: boolean;
  split_insurers_allowed: boolean;
  excluded_insurer_ids: string[];
  deductible_increases_allowed: boolean;
  customer_approval_required: boolean;
}

function RequirementList({ values }: { values: Record<string, number | boolean> }) {
  return (
    <ul className="space-y-1 text-sm">
      {Object.entries(values).map(([key, value]) => (
        <li key={key} className="flex justify-between gap-4">
          <span className="text-ink-muted">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
          <span className="font-medium">
            {typeof value === "boolean"
              ? value
                ? "Yes"
                : "No"
              : key.endsWith("Cents")
                ? formatCad(value)
                : value}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MandateTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mandate", caseRow.household_id],
    queryFn: async () => {
      const supabase = supabaseBrowser();
      const [req, prefs] = await Promise.all([
        supabase
          .from("coverage_requirements")
          .select("auto_requirements, property_requirements")
          .eq("household_id", caseRow.household_id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("switching_preferences")
          .select("*")
          .eq("household_id", caseRow.household_id)
          .eq("is_current", true)
          .maybeSingle(),
      ]);
      return {
        requirements: req.data as RequirementsRow | null,
        preferences: prefs.data as PreferencesRow | null,
      };
    },
  });

  if (isLoading || !data) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardTitle>Auto requirements</CardTitle>
        {data.requirements ? (
          <RequirementList values={data.requirements.auto_requirements} />
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>
      <Card>
        <CardTitle>Property requirements</CardTitle>
        {data.requirements ? (
          <RequirementList values={data.requirements.property_requirements} />
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>
      <Card>
        <CardTitle>Switching rules</CardTitle>
        {data.preferences ? (
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span className="text-ink-muted">Minimum net annual savings</span>
              <span className="font-medium">
                {formatCad(data.preferences.min_net_annual_savings_cents)}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Renewal-only switching</span>
              <span className="font-medium">
                {data.preferences.renewal_only_switching ? "Yes" : "No"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Optimize home and auto together</span>
              <span className="font-medium">
                {data.preferences.household_optimization_enabled ? "Yes" : "No"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Split insurers allowed</span>
              <span className="font-medium">
                {data.preferences.split_insurers_allowed ? "Yes" : "No"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Deductible increases allowed</span>
              <span className="font-medium">
                {data.preferences.deductible_increases_allowed ? "Yes" : "No"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Customer approval required</span>
              <span className="font-medium">Always</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Excluded insurers</span>
              <span className="font-medium">{data.preferences.excluded_insurer_ids.length}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Not set.</p>
        )}
      </Card>
    </div>
  );
}
