"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import { Shell } from "@/components/shell";
import { Badge, Skeleton, Table, Td, Th } from "@/components/ui";

interface InsurerRow {
  id: string;
  name: string;
  active: boolean;
  provinces: string[];
  products: string[];
  distribution: string;
  contact_method: string;
  email_supported: boolean;
  portal_supported: boolean;
  api_supported: boolean;
  bundle_supported: boolean;
  internal_notes: string;
}

export default function InsurersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["insurer-directory"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("insurer_directory")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as InsurerRow[];
    },
  });

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-semibold">Insurer directory</h1>
      <p className="mb-4 text-sm text-ink-muted">
        All insurers are fictional. Internal notes are visible to staff only.
      </p>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Active</Th>
              <Th>Provinces</Th>
              <Th>Products</Th>
              <Th>Distribution</Th>
              <Th>Contact</Th>
              <Th>Email</Th>
              <Th>Portal</Th>
              <Th>API</Th>
              <Th>Bundle</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.name}</Td>
                <Td>
                  <Badge tone={i.active ? "accent" : "danger"}>{i.active ? "Active" : "Paused"}</Badge>
                </Td>
                <Td>{i.provinces.join(", ")}</Td>
                <Td>{i.products.join(", ")}</Td>
                <Td>{i.distribution}</Td>
                <Td>{i.contact_method}</Td>
                <Td>{i.email_supported ? "Yes" : "No"}</Td>
                <Td>{i.portal_supported ? "Yes" : "No"}</Td>
                <Td>{i.api_supported ? "Yes" : "No"}</Td>
                <Td>{i.bundle_supported ? "Yes" : "No"}</Td>
                <Td className="max-w-64 truncate text-xs text-ink-muted">{i.internal_notes}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Shell>
  );
}
