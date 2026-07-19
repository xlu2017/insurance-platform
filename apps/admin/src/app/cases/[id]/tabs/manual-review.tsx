"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import type { CaseDetail } from "../page";

interface PolicyDocumentRow {
  id: string;
  file_name: string;
  status: string;
}

interface ManualCandidateRow {
  id: string;
  asset_type: string;
  display_label: string;
  review_status: string;
  decision: string;
  selected_facts_json: unknown;
}

export function ManualReviewTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data: documents, isLoading: docsLoading } = useQuery({
    queryKey: ["policy-documents", caseRow.household_id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("policy_documents")
        .select("id, file_name, status")
        .eq("household_id", caseRow.household_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PolicyDocumentRow[];
    },
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<ManualCandidateRow[]>({
    queryKey: ["manual-candidates", caseRow.household_id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("asset_candidates")
        .select(
          "id, asset_type, display_label, match_classification, review_status, decision, selected_facts_json",
        )
        .eq("household_id", caseRow.household_id)
        .eq("source", "manual_review")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ManualCandidateRow[];
    },
  });

  const [assetType, setAssetType] = useState<"property" | "vehicle">("property");
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<Record<string, string>>({});
  const [coverage, setCoverage] = useState<Record<string, string>>({});

  const fingerprint = useMemo(
    () =>
      Object.entries(identity)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}:${v}`)
        .join("|"),
    [identity],
  );

  const save = useMutation({
    mutationFn: async () => {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      if (!selectedDoc) throw new Error("Select a policy document");
      if (!displayLabel) throw new Error("Display label is required");

      const mandateSuggestions: Record<string, { rule: string; amountCents?: number }> = {};
      for (const [key, value] of Object.entries(coverage)) {
        if (!value) continue;
        const cents = Number(value) * 100;
        if (!Number.isNaN(cents) && cents > 0) {
          mandateSuggestions[key] = { rule: "minimum", amountCents: Math.round(cents) };
        }
      }

      const selectedFacts = {
        identity,
        currentPolicy: {
          insurerName: policy.insurerName || "",
          policyNumber: policy.policyNumber || "",
          annualPremiumCents: policy.annualPremiumDollars
            ? Math.round(Number(policy.annualPremiumDollars) * 100)
            : 0,
          effectiveDate: policy.effectiveDate || "",
          expiryDate: policy.expiryDate || "",
        },
        currentCoverage: Object.fromEntries(
          Object.entries(coverage).map(([k, v]) => [k, v ? Math.round(Number(v) * 100) : null]),
        ),
        mandateSuggestions,
      };

      const { data, error } = await supabase.rpc("save_manual_policy_review_v1", {
        p_household_id: caseRow.household_id,
        p_actor_profile_id: user.id,
        p_client_request_id: `admin-${caseRow.household_id}-${Date.now()}`,
        p_policy_document_id: selectedDoc,
        p_asset_type: assetType,
        p_identity_fingerprint: fingerprint || `${assetType}-manual`,
        p_display_label: displayLabel,
        p_match_classification: "new",
        p_selected_facts_json: selectedFacts,
        p_provenance_json: { source: "admin_manual_review", case_id: caseRow.id },
      });
      if (error) throw error;
      return data as { candidate_id?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-candidates", caseRow.household_id] });
      setMessage("Manual candidate saved.");
      setDisplayLabel("");
      setIdentity({});
      setPolicy({});
      setCoverage({});
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (docsLoading || candidatesLoading) return <Skeleton className="h-48" />;

  const identityFields =
    assetType === "property"
      ? [
          { key: "fullAddress", label: "Full address" },
          { key: "city", label: "City" },
          { key: "province", label: "Province" },
          { key: "postalCode", label: "Postal code" },
          { key: "yearBuilt", label: "Year built" },
        ]
      : [
          { key: "year", label: "Year" },
          { key: "make", label: "Make" },
          { key: "model", label: "Model" },
          { key: "vin", label: "VIN" },
        ];

  const coverageFields =
    assetType === "property"
      ? [
          { key: "dwellingLimitCents", label: "Dwelling limit ($)" },
          { key: "baseDeductibleCents", label: "Base deductible ($)" },
        ]
      : [
          { key: "thirdPartyLiabilityCents", label: "Third-party liability ($)" },
          { key: "collisionDeductibleCents", label: "Collision deductible ($)" },
        ];

  const update = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    key: string,
    value: string,
  ) => {
    setter((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Record manual candidate</CardTitle>
        <p className="mb-3 text-xs text-ink-muted">
          Create a structured candidate from a customer-uploaded policy document without external
          PDF processing.
        </p>
        <div className="space-y-3">
          <div>
            <Label>Policy document</Label>
            <Select value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
              <option value="">Select a document</option>
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Asset type</Label>
            <Select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as "property" | "vehicle")}
            >
              <option value="property">Property</option>
              <option value="vehicle">Vehicle</option>
            </Select>
          </div>
          <div>
            <Label>Display label</Label>
            <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {identityFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  value={identity[f.key] || ""}
                  onChange={(e) => update(setIdentity, f.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Insurer name</Label>
              <Input
                value={policy.insurerName || ""}
                onChange={(e) => update(setPolicy, "insurerName", e.target.value)}
              />
            </div>
            <div>
              <Label>Policy number</Label>
              <Input
                value={policy.policyNumber || ""}
                onChange={(e) => update(setPolicy, "policyNumber", e.target.value)}
              />
            </div>
            <div>
              <Label>Annual premium (C$)</Label>
              <Input
                type="number"
                value={policy.annualPremiumDollars || ""}
                onChange={(e) => update(setPolicy, "annualPremiumDollars", e.target.value)}
              />
            </div>
            <div>
              <Label>Expiry date</Label>
              <Input
                type="date"
                value={policy.expiryDate || ""}
                onChange={(e) => update(setPolicy, "expiryDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {coverageFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  type="number"
                  value={coverage[f.key] || ""}
                  onChange={(e) => update(setCoverage, f.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save manual candidate
          </Button>
          {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
        </div>
      </Card>

      <div className="space-y-3">
        <Card>
          <CardTitle>Manual candidates</CardTitle>
          {(candidates ?? []).length === 0 ? (
            <EmptyState title="No manual candidates" hint="Record a candidate on the left." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Label</Th>
                  <Th>Status</Th>
                  <Th>Decision</Th>
                </tr>
              </thead>
              <tbody>
                {candidates!.map((c) => (
                  <tr key={c.id}>
                    <Td>{c.asset_type}</Td>
                    <Td>{c.display_label}</Td>
                    <Td>{c.review_status}</Td>
                    <Td>{c.decision}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
