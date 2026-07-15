"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { questionTypes } from "@autopilot/schemas";
import { supabaseBrowser } from "@/lib/supabase";
import { Badge, Button, Card, CardTitle, Input, Label, Select, Skeleton } from "@/components/ui";
import { formatEdmonton, titleCase } from "@/lib/utils";
import type { CaseDetail } from "../page";

const QuestionForm = z.object({
  questionType: z.enum(questionTypes),
  prompt: z.string().min(5, "Write the question for the customer"),
  options: z.string().optional(),
});
type QuestionForm = z.infer<typeof QuestionForm>;

interface QuestionRow {
  id: string;
  question_type: string;
  status: string;
  prompt: string;
  options: string[] | null;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export function QuestionsTab({ caseRow }: { caseRow: CaseDetail }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["questions", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("customer_questions")
        .select("*")
        .eq("case_id", caseRow.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as QuestionRow[];
    },
  });

  const { register, handleSubmit, reset, watch, formState } = useForm<QuestionForm>({
    resolver: zodResolver(QuestionForm),
    defaultValues: { questionType: "yes_no" },
  });
  const questionType = watch("questionType");

  const createQuestion = useMutation({
    mutationFn: async (values: QuestionForm) => {
      const supabase = supabaseBrowser();
      const options =
        values.questionType === "single_choice" || values.questionType === "multiple_choice"
          ? (values.options ?? "")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
      const { data: question, error } = await supabase
        .from("customer_questions")
        .insert({
          case_id: caseRow.id,
          question_type: values.questionType,
          prompt: values.prompt,
          options,
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("audit_events").insert({
        action: "customer_question_created",
        entity_type: "customer_question",
        entity_id: question.id,
        household_id: caseRow.household_id,
        case_id: caseRow.id,
        after_summary: { question_type: values.questionType },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions", caseRow.id] });
      reset();
      setMessage("Question sent. The customer will be notified in the app.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {(data ?? []).map((q) => (
          <Card key={q.id}>
            <div className="mb-1 flex items-center justify-between">
              <Badge tone={q.status === "pending" ? "warning" : "accent"}>
                {titleCase(q.status)}
              </Badge>
              <span className="text-xs text-ink-muted">{formatEdmonton(q.created_at)}</span>
            </div>
            <p className="text-sm font-medium">{q.prompt}</p>
            <p className="text-xs text-ink-muted">{titleCase(q.question_type)}</p>
            {q.answer ? (
              <p className="mt-2 text-sm">
                Answer: <span className="font-medium">{q.answer}</span>{" "}
                <span className="text-xs text-ink-muted">({formatEdmonton(q.answered_at)})</span>
              </p>
            ) : null}
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>Ask the customer a question</CardTitle>
        <form className="space-y-3" onSubmit={handleSubmit((v) => createQuestion.mutate(v))}>
          <div>
            <Label>Question type</Label>
            <Select className="w-full" {...register("questionType")}>
              {questionTypes.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Question</Label>
            <Input placeholder="Is the basement fully finished?" {...register("prompt")} />
            {formState.errors.prompt ? (
              <p className="mt-1 text-xs text-danger">{formState.errors.prompt.message}</p>
            ) : null}
          </div>
          {questionType === "single_choice" || questionType === "multiple_choice" ? (
            <div>
              <Label>Options (one per line)</Label>
              <textarea
                className="w-full rounded-md border border-line bg-surface p-2 text-sm"
                rows={3}
                {...register("options")}
              />
            </div>
          ) : null}
          <Button type="submit" disabled={createQuestion.isPending}>
            Send question
          </Button>
          {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
        </form>
      </Card>
    </div>
  );
}
