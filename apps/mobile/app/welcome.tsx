import { router } from "expo-router";
import { View } from "react-native";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

export default function Welcome() {
  return (
    <Screen style={{ justifyContent: "center" }}>
      <Title>Insurance handled for you</Title>
      <Body muted>
        Upload your current policies once. We monitor your renewals, look for eligible savings and
        show you one clear recommendation. You approve every change.
      </Body>
      <View style={{ height: 24 }} />
      <PrimaryButton
        label="Set up my insurance"
        onPress={() => router.push("/register")}
        testID="get-started"
      />
      <View style={{ height: 12 }} />
      <SecondaryButton
        label="Sign in"
        onPress={() => router.push("/sign-in")}
        testID="go-sign-in"
      />
    </Screen>
  );
}
