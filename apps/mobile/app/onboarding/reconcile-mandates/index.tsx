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
      <Stack.Screen options={{ title: "Reconcile mandate" }} />
      <Title>Preparing mandate review</Title>
      <Body muted>
        {items.length === 0
          ? "No document-informed specifications require review. Your current mandate will remain unchanged."
          : "Resuming at the first incomplete specification."}
      </Body>
    </Screen>
  );
}
