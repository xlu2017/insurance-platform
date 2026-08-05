"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

interface BatchDocumentRow {
  id: string;
  policy_document_id: string;
  selected_file_name: string;
  review_status: string;
}

interface ManualCandidateRow {
  id: string;
  asset_type: string;
  display_label: string;
  review_status: string;
  decision: string;
  selected_facts_json: unknown;
}

interface ManualReviewBatch {
  id: string;
  session_id: string;
  status: string;
}

export function ManualReviewTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const saveRequestIdRef = useRef<string | null>(null);

  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ["manual-review-batch", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("document_processing_batches")
        .select("id, session_id, status")
        .eq("case_id", caseRow.id)
        .in("status", ["manual_review", "ready_for_review", "uploading_files"])
        .order("created_at", { ascending: false })
        .maybeSingle();
      if (error) throw error;
      return data as ManualReviewBatch | null;
    },
  });

  const { data: batchDocuments, isLoading: docsLoading } = useQuery({
    queryKey: ["manual-review-batch-documents", batch?.id],
    queryFn: async () => {
      if (!batch) return [];
      const { data, error } = await supabaseBrowser()
        .from("document_processing_batch_items")
        .select("id, policy_document_id, selected_file_name, review_status")
        .eq("batch_id", batch.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BatchDocumentRow[];
    },
    enabled: !!batch,
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<ManualCandidateRow[]>({
    queryKey: ["manual-candidates", batch?.session_id ?? caseRow.household_id],
    queryFn: async () => {
      const base = supabaseBrowser()
        .from("asset_candidates")
        .select(
          "id, asset_type, display_label, match_classification, review_status, decision, selected_facts_json",
        )
        .eq("household_id", caseRow.household_id);
      const { data, error } = batch?.session_id
        ? await base.eq("session_id", batch.session_id).order("created_at", { ascending: false })
        : await base
            .not("manual_reviewed_by", "is", null)
            .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ManualCandidateRow[];
    },
    enabled: !batchLoading,
  });

  useEffect(() => {
    if (candidates) {
      setSelectedCandidateIds(new Set(candidates.map((c) => c.id)));
    }
  }, [candidates]);

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
      if (!selectedDoc) throw new Error("Select a policy document from this batch");
      if (!displayLabel) throw new Error("Display label is required");
      if (!batch) throw new Error("No manual review batch found for this case");

      const mandateSuggestions: Record<string, { rule: string; amountCents?: number }> = {};
      const addMandate = (key: string, targetKey: string) => {
        const value = coverage[key];
        if (!value) return;
        const cents = Math.round(Number(value) * 100);
        if (!Number.isNaN(cents) && cents > 0) {
          mandateSuggestions[targetKey] = { rule: "minimum", amountCents: cents };
        }
      };
      addMandate("dwellingLimitCents", "dwelling");
      addMandate("personalLiabilityLimitCents", "liability");
      addMandate("thirdPartyLiabilityCents", "thirdPartyLiability");

      const selectedFacts = {
        identity,
        currentPolicy: {
          insurerName: policy.insurerName || "",
          policyNumber: policy.policyNumber || "",
          annualPremiumCents: policy.annualPremiumDollars
            ? Math.round(Number(policy.annualPremiumDollars) * 100)
            : null,
          effectiveDate: policy.effectiveDate || "",
          expiryDate: policy.expiryDate || "",
        },
        currentCoverage: Object.fromEntries(
          Object.entries(coverage).map(([k, v]) => [k, v ? Math.round(Number(v) * 100) : null]),
        ),
        mandateSuggestions,
      };

      if (!saveRequestIdRef.current) {
        saveRequestIdRef.current =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `admin-save-${batch.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const requestId = saveRequestIdRef.current;

      const { data, error } = await supabase.rpc("save_staff_manual_policy_candidate_v1", {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: caseRow.id,
        p_household_id: caseRow.household_id,
        p_client_request_id: requestId,
        p_asset_type: assetType,
        p_identity_fingerprint: fingerprint || `${assetType}-manual`,
        p_display_label: displayLabel,
        p_source_document_ids: [selectedDoc],
        p_match_classification: "new",
        p_selected_facts_json: selectedFacts,
      });
      if (error) throw error;
      return data as { candidate_id?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["manual-candidates", batch?.session_id ?? caseRow.household_id],
      });
      saveRequestIdRef.current = null;
      setMessage("Manual candidate saved.");
      setDisplayLabel("");
      setIdentity({});
      setPolicy({});
      setCoverage({});
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      if (!batch) throw new Error("No manual review batch found for this case");
      const ids = Array.from(selectedCandidateIds);
      if (ids.length === 0) throw new Error("Select at least one candidate to complete the review");

      const { data, error } = await supabase.rpc("complete_manual_review_v1", {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: caseRow.id,
        p_household_id: caseRow.household_id,
        p_actor_profile_id: user.id,
        p_candidate_ids: ids,
        p_client_request_id: `admin-complete-${batch.id}-${ids.join(":")}`,
      });
      if (error) throw error;
      return data as { success?: boolean; linked_candidates?: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["manual-review-batch", caseRow.id] });
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      queryClient.invalidateQueries({
        queryKey: ["manual-candidates", batch?.session_id ?? caseRow.household_id],
      });
      setMessage(`Manual review completed. ${result?.linked_candidates ?? 0} candidate(s) linked.`);
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const toggleCandidate = (id: string, checked: boolean) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (docsLoading || batchLoading || candidatesLoading) return <Skeleton className="h-48" />;

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
          { key: "personalLiabilityLimitCents", label: "Personal liability ($)" },
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
              {(batchDocuments ?? []).map((d) => (
                <option key={d.id} value={d.policy_document_id}>
                  {d.selected_file_name} {d.review_status === "reviewed" ? "(reviewed)" : ""}
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

          <Button onClick={() => save.mutate()} disabled={save.isPending || !batch}>
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
                  <Th />
                  <Th>Type</Th>
                  <Th>Label</Th>
                  <Th>Status</Th>
                  <Th>Decision</Th>
                </tr>
              </thead>
              <tbody>
                {candidates!.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Input
                        type="checkbox"
                        checked={selectedCandidateIds.has(c.id)}
                        onChange={(e) => toggleCandidate(c.id, e.target.checked)}
                      />
                    </Td>
                    <Td>{c.asset_type}</Td>
                    <Td>{c.display_label}</Td>
                    <Td>{c.review_status}</Td>
                    <Td>{c.decision}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {batch && (candidates ?? []).length > 0 && (
            <div className="mt-3">
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                Complete manual review
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
