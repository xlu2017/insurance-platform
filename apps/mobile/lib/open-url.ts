import { Alert, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

export async function openDocumentUrl(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // Fallback to the system browser if the in-app browser is unavailable.
    const { Linking } = await import("react-native");
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert("Open document", "No application can open this document.");
    }
  }
}
