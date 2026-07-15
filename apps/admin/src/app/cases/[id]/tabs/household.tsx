"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import type { CaseDetail } from "../page";

export function HouseholdTab({ caseRow }: { caseRow: CaseDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["household", caseRow.household_id],
    queryFn: async () => {
      const supabase = supabaseBrowser();
      const [drivers, vehicles, properties] = await Promise.all([
        supabase.from("drivers").select("*").eq("household_id", caseRow.household_id),
        supabase.from("vehicles").select("*").eq("household_id", caseRow.household_id),
        supabase.from("properties").select("*").eq("household_id", caseRow.household_id),
      ]);
      return {
        drivers: drivers.data ?? [],
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
      };
    },
  });

  if (isLoading || !data) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardTitle>Drivers</CardTitle>
        <ul className="space-y-2 text-sm">
          {data.drivers.map((d: { id: string; full_name: string; licence_class: string; years_licensed: number }) => (
            <li key={d.id}>
              <p className="font-medium">{d.full_name}</p>
              <p className="text-xs text-ink-muted">
                Class {d.licence_class} · {d.years_licensed} years licensed
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Vehicles</CardTitle>
        <ul className="space-y-2 text-sm">
          {data.vehicles.map((v: { id: string; year: number; make: string; model: string; primary_use: string }) => (
            <li key={v.id}>
              <p className="font-medium">
                {v.year} {v.make} {v.model}
              </p>
              <p className="text-xs text-ink-muted">Primary use: {v.primary_use}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Properties</CardTitle>
        <ul className="space-y-2 text-sm">
          {data.properties.map((p: { id: string; address_line1: string; city: string; province: string; dwelling_type: string; owner_occupied: boolean }) => (
            <li key={p.id}>
              <p className="font-medium">{p.address_line1}</p>
              <p className="text-xs text-ink-muted">
                {p.city}, {p.province} · {p.dwelling_type} ·{" "}
                {p.owner_occupied ? "owner-occupied" : "rented"}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
