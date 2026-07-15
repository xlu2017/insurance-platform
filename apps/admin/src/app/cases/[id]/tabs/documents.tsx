"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getExtractionProvider } from "@autopilot/database/providers";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Button, Card, CardTitle, EmptyState, Input, Label, Select, Skeleton } from "@/components/ui";
import { titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

interface DocumentRow {
  id: string;
  category: string;
  status: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  created_at: string;
}

const ExtractionForm = z.object({
  productLine: z.enum(["auto", "property"]),
  insurerName: z.string().min(1),
  policyNumber: z.string().optional(),
  annualPremiumDollars: z.coerce.number().nonnegative(),
  renewalDate: z.string().optional(),
});
type ExtractionForm = z.infer<typeof ExtractionForm>;

export function DocumentsTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", caseRow.household_id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("policy_documents")
        .select("*")
        .eq("household_id", caseRow.household_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
    },
  });

  const { register, handleSubmit, reset, formState } = useForm<ExtractionForm>({
    resolver: zodResolver(ExtractionForm),
    defaultValues: { productLine: "auto", insurerName: "" },
  });

  const openDocument = async (doc: DocumentRow) => {
    setOpenDoc(doc);
    setMessage(null);
    const { data: signed } = await supabaseBrowser()
      .storage.from("policy-documents")
      .createSignedUrl(doc.storage_path, 60);
    setPreviewUrl(signed?.signedUrl ?? null);
    const prefill = await getExtractionProvider(
      process.env.NEXT_PUBLIC_EXTRACTION_PROVIDER,
    ).extract(doc.id);
    if (prefill) {
      reset({
        productLine: prefill.productLine,
        insurerName: prefill.insurerName,
        policyNumber: prefill.policyNumber ?? "",
        annualPremiumDollars: prefill.annualPremiumCents / 100,
        renewalDate: prefill.renewalDate ?? "",
      });
    }
  };

  const saveExtraction = useMutation({
    mutationFn: async ({ values, complete }: { values: ExtractionForm; complete: boolean }) => {
      const supabase = supabaseBrowser();
      const { error } = await supabase.from("policies").insert({
        household_id: caseRow.household_id,
        insurer_name: values.insurerName,
        product_line: values.productLine,
        policy_number: values.policyNumber || null,
        annual_premium_cents: Math.round(values.annualPremiumDollars * 100),
        renewal_date: values.renewalDate || null,
        is_current: true,
      });
      if (error) throw error;
      if (openDoc) {
        await supabase
          .from("policy_documents")
          .update({ status: complete ? "extracted" : "in_review" })
          .eq("id", openDoc.id);
        await supabase.from("audit_events").insert({
          action: complete ? "extraction_completed" : "extraction_draft_saved",
          entity_type: "policy_document",
          entity_id: openDoc.id,
          household_id: caseRow.household_id,
          case_id: caseRow.id,
          after_summary: { product_line: values.productLine },
        });
      }
    },
    onSuccess: (_d, { complete }) => {
      queryClient.invalidateQueries({ queryKey: ["documents", caseRow.household_id] });
      queryClient.invalidateQueries({ queryKey: ["policies", caseRow.household_id] });
      setMessage(complete ? "Extraction marked complete." : "Draft saved.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const requestConfirmation = useMutation({
    mutationFn: async () => {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("optimization_cases")
        .update({ state: "awaiting_customer_confirmation" })
        .eq("id", caseRow.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case", caseRow.id] });
      setMessage("Sent to customer for confirmation.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {(data ?? []).length === 0 ? (
          <EmptyState
            title="No documents uploaded yet"
            hint="The customer uploads policies from the mobile app."
          />
        ) : (
          (data ?? []).map((doc) => (
            <Card key={doc.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{doc.file_name}</p>
                <p className="text-xs text-ink-muted">{titleCase(doc.category)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={doc.status === "extracted" ? "accent" : "neutral"}>
                  {titleCase(doc.status)}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => openDocument(doc)}>
                  Open
                </Button>
              </div>
            </Card>
          ))
        )}
        {caseRow.state === "extracting_information" ? (
          <Button variant="outline" onClick={() => requestConfirmation.mutate()}>
            Send extracted information to customer for confirmation
          </Button>
        ) : null}
      </div>
      {openDoc ? (
        <Card>
          <CardTitle>Extract values from {openDoc.file_name}</CardTitle>
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-3 block text-sm text-accent hover:underline"
            >
              Open document preview (signed link, 60 seconds)
            </a>
          ) : (
            <p className="mb-3 text-xs text-ink-muted">No preview available.</p>
          )}
          <form
            className="space-y-3"
            onSubmit={handleSubmit((values) => saveExtraction.mutate({ values, complete: true }))}
          >
            <div>
              <Label>Product line</Label>
              <Select {...register("productLine")}>
                <option value="auto">Auto</option>
                <option value="property">Property</option>
              </Select>
            </div>
            <div>
              <Label>Insurer name</Label>
              <Input {...register("insurerName")} />
            </div>
            <div>
              <Label>Policy number</Label>
              <Input {...register("policyNumber")} />
            </div>
            <div>
              <Label>Annual premium (C$)</Label>
              <Input type="number" step="0.01" {...register("annualPremiumDollars")} />
            </div>
            <div>
              <Label>Renewal date</Label>
              <Input type="date" {...register("renewalDate")} />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={formState.isSubmitting}
                onClick={handleSubmit((values) =>
                  saveExtraction.mutate({ values, complete: false }),
                )}
              >
                Save as draft
              </Button>
              <Button type="submit" disabled={formState.isSubmitting}>
                Mark extraction complete
              </Button>
            </div>
            {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
          </form>
        </Card>
      ) : (
        <EmptyState title="Select a document" hint="Open a document to view it beside the extraction form." />
      )}
    </div>
  );
}
