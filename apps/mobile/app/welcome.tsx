import { router } from "expo-router";
import { View } from "react-native";
import { MVP_DISCLAIMER } from "@autopilot/design-tokens";
import {
  Body,
  Caption,
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/ui";

export default function Welcome() {
  return (
    <Screen style={{ justifyContent: "center" }}>
      <Title>Insurance on autopilot</Title>
      <Body muted>
        Set your insurance requirements once. We monitor the renewal process, compare eligible
        household configurations and present a clear recommendation without requiring sales calls.
      </Body>
      <View style={{ height: 24 }} />
      <PrimaryButton
        label="Get started"
        onPress={() => router.push("/register")}
        testID="get-started"
      />
      <View style={{ height: 12 }} />
      <SecondaryButton
        label="Sign in"
        onPress={() => router.push("/sign-in")}
        testID="go-sign-in"
      />
      <View style={{ height: 24 }} />
      <Card>
        <Caption>{MVP_DISCLAIMER}</Caption>
      </Card>
    </Screen>
  );
}
