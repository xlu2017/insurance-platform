import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Screen, Title, Body, Caption, PrimaryButton } from "@/components/ui";
import { colors, spacing } from "@autopilot/design-tokens";
import { AddressVerification } from "./review-entities";
import type { ExtractionCandidate } from "@/lib/extraction";

const PREVIEW_CANDIDATE: ExtractionCandidate = {
  id: "preview-candidate",
  session_id: "preview-session",
  household_id: "preview-household",
  asset_type: "property",
  identity_fingerprint: "preview-fingerprint",
  display_label: "Preview property",
  occupancy: "principal_residence",
  match_classification: "new",
  decision: "needs_review",
  review_status: "in_review",
  selected_facts_json: {
    identity: {
      fullAddress: "128 Larchwood Crescent NW, Calgary, AB",
    },
  },
  conflicts_json: [],
};

export default function AddressPreviewScreen() {
  const [verifiedAddress, setVerifiedAddress] = useState<string | null>(null);

  return (
    <Screen style={styles.container}>
      <Title>Address verification preview</Title>
      <Body style={{ color: colors.inkMuted, marginBottom: spacing.md }}>
        Type below to test the multi-source address suggestions dropdown.
      </Body>
      <View style={styles.card}>
        <AddressVerification candidate={PREVIEW_CANDIDATE} onVerified={setVerifiedAddress} />
      </View>
      {verifiedAddress ? (
        <View style={styles.result}>
          <Caption style={{ color: colors.inkMuted }}>Verified / selected address</Caption>
          <Body>{verifiedAddress}</Body>
          <PrimaryButton
            label="Clear"
            onPress={() => setVerifiedAddress(null)}
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.surfaceSubtle,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  result: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
});
