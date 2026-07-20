jest.mock("../lib/supabase", () => ({
  supabase: {},
  SUPABASE_URL: "http://localhost",
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

import * as DocumentPicker from "expo-document-picker";
import { pickDocuments } from "../lib/upload";

describe("multi-file document selection", () => {
  it("returns every selected PDF or image from one picker operation", async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file://one.pdf", name: "one.pdf", mimeType: "application/pdf", size: 10 },
        { uri: "file://two.jpg", name: "two.jpg", mimeType: "image/jpeg", size: 20 },
        { uri: "file://three.png", name: "three.png", mimeType: "image/png", size: 30 },
        { uri: "file://four.pdf", name: "four.pdf", mimeType: "application/pdf", size: 40 },
      ],
    });

    const selected = await pickDocuments();

    expect(selected).toHaveLength(4);
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true }),
    );
  });
});
