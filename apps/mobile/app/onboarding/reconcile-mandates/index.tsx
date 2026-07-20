import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Body, Loading, Screen, Title } from "@/components/ui";
import { useHousehold } from "@/lib/household";
import { useMandateReviewItems } from "@/lib/extraction";
import { visibleMandateItems } from "@/lib/mandate-reconciliation";

export default function ReconcileMandatesIndex() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { data: household, isLoading: householdLoading } = useHousehold();
  const { data: allItems, isLoading: itemsLoading } = useMandateReviewItems(
    household?.id,
    sessionId,
  );
  const items = visibleMandateItems(allItems ?? []);
  const firstIncomplete = items.find((item) => !item.is_complete);

  useEffect(() => {
    if (householdLoading || itemsLoading || !household) return;
    if (firstIncomplete) {
      router.replace({
        pathname: "/onboarding/reconcile-mandates/[reviewItemId]",
        params: { reviewItemId: firstIncomplete.id, sessionId },
      });
    } else {
      router.replace({ pathname: "/onboarding/reconcile-mandates/review", params: { sessionId } });
    }
  }, [firstIncomplete, household, householdLoading, itemsLoading, sessionId]);

  if (householdLoading || itemsLoading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Review coverage rules" }} />
      <Title>Preparing coverage review</Title>
      <Body muted>
        {items.length === 0
          ? "No policy details need review. Your current coverage rules will remain unchanged."
          : "Resuming at the first item that needs a decision."}
      </Body>
    </Screen>
  );
}
