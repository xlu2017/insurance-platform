import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import {
  Body,
  Card,
  Field,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/ui";

interface QuestionRow {
  id: string;
  case_id: string;
  question_type: string;
  prompt: string;
  options: string[] | null;
  status: string;
}

export default function AnswerQuestion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: question, isLoading } = useQuery({
    queryKey: ["question", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_questions")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as QuestionRow;
    },
  });

  if (isLoading || !question) return <Loading />;

  const isChoice =
    question.question_type === "single_choice" || question.question_type === "multiple_choice";
  const isYesNo = question.question_type === "yes_no";

  const finalAnswer = isChoice || isYesNo ? selected.join(", ") : answer;

  const submit = async () => {
    if (!finalAnswer.trim()) {
      setError("Provide an answer first");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("answer_customer_question", {
      p_question_id: question.id,
      p_answer: finalAnswer.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["pending-question"] });
    router.back();
  };

  const choose = (option: string) => {
    if (question.question_type === "multiple_choice") {
      setSelected((s) => (s.includes(option) ? s.filter((o) => o !== option) : [...s, option]));
    } else {
      setSelected([option]);
    }
  };

  const options = isYesNo ? ["Yes", "No"] : (question.options ?? []);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: true, headerBackTitle: "Back", title: "Question" }} />
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Question from your insurer</Title>
          <Card>
            <Body>{question.prompt}</Body>
          </Card>
          {isChoice || isYesNo ? (
            <View style={{ gap: 8 }}>
              {options.map((option) => (
                <View key={option} style={{ opacity: selected.includes(option) ? 1 : 0.6 }}>
                  <SecondaryButton
                    label={selected.includes(option) ? `✓ ${option}` : option}
                    onPress={() => choose(option)}
                    testID={`option-${option.toLowerCase().replace(/\s+/g, "-")}`}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Field
              label="Your answer"
              value={answer}
              onChangeText={setAnswer}
              keyboardType={question.question_type === "number" ? "numeric" : "default"}
              testID="answer-input"
            />
          )}
          {error ? <Body muted>{error}</Body> : null}
          <View style={{ height: 16 }} />
          <PrimaryButton
            label="Submit answer"
            onPress={submit}
            loading={busy}
            testID="submit-answer"
          />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
