import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import DocumentProcessingConsent from "../app/onboarding/document-processing-consent";
import { updateDangerousModeSetting } from "../lib/document-processing";
import { useHousehold } from "../lib/household";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("expo-linking", () => ({
  openURL: jest.fn(),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("../lib/household");
jest.mock("../lib/document-processing");
jest.mock("../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: jest.fn(() => ({
    invalidateQueries: jest.fn(() => Promise.resolve()),
  })),
}));

jest.mock("../lib/document-processing-config", () => ({
  DANGEROUS_MODE_DISCLOSURE_VERSION: "dangerous-mode-v1",
  getPrivacyNoticeUrl: jest.fn(),
  getProcessorContractVersion: jest.fn(),
  getPrivacyNoticeVersion: jest.fn(() => "dangerous-mode-v1"),
}));

const mockedUseHousehold = useHousehold as jest.MockedFunction<typeof useHousehold>;
const mockedUpdate = updateDangerousModeSetting as jest.MockedFunction<
  typeof updateDangerousModeSetting
>;
const mockedOpenURL = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeUrl,
  getProcessorContractVersion,
} from "../lib/document-processing-config";

const mockHousehold = { id: "10000000-0000-0000-0000-00000000h001" };

describe("DocumentProcessingConsent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseHousehold.mockReturnValue({ data: mockHousehold, isLoading: false } as any);
    (getPrivacyNoticeUrl as jest.MockedFunction<typeof getPrivacyNoticeUrl>).mockReturnValue(
      "https://autopilot.example.com/privacy",
    );
    (getProcessorContractVersion as jest.MockedFunction<typeof getProcessorContractVersion>).mockReturnValue(
      "processor-contract-v1",
    );
    mockedUpdate.mockResolvedValue({
      enabled: true,
      disclosure_version: "dangerous-mode-v1",
      enabled_at: new Date().toISOString(),
    });
  });

  it("opens the configured privacy notice", () => {
    const { getByText } = render(<DocumentProcessingConsent />);
    fireEvent.press(getByText("Read privacy notice"));
    expect(mockedOpenURL).toHaveBeenCalledWith("https://autopilot.example.com/privacy");
  });

  it("disables Allow processing but keeps Upload without AI processing enabled when AI config is missing", () => {
    (getPrivacyNoticeUrl as jest.MockedFunction<typeof getPrivacyNoticeUrl>).mockReturnValue(
      undefined,
    );
    const { getByText, getAllByText } = render(<DocumentProcessingConsent />);
    expect(
      getByText(
        "Automatic document processing is not configured. You can still upload documents for manual review.",
      ),
    ).toBeTruthy();

    const allowButton = getByText("Allow processing");
    fireEvent.press(allowButton);
    expect(mockedUpdate).not.toHaveBeenCalled();

    const uploadButton = getByText("Upload without AI processing");
    fireEvent.press(uploadButton);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: mockHousehold.id,
        enabled: false,
      }),
    );

    expect(
      getAllByText(
        "Automatic document processing is not configured. You can still upload documents for manual review.",
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("enables dangerous mode, persists onboarding step, and advances when Allow processing is pressed", async () => {
    const { getByText } = render(<DocumentProcessingConsent />);
    fireEvent.press(getByText("Allow processing"));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: mockHousehold.id,
          enabled: true,
          explicitConfirmation: true,
          foreignProcessingAcknowledged: true,
          automatedProcessingAcknowledged: true,
          rawProcessingApproved: true,
          disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
        }),
      ),
    );
    expect(router.push).toHaveBeenCalledWith("/onboarding/documents");
  });

  it("disables dangerous mode, persists onboarding step, and advances when Upload without AI processing is pressed", async () => {
    const { getByText } = render(<DocumentProcessingConsent />);
    fireEvent.press(getByText("Upload without AI processing"));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: mockHousehold.id,
          enabled: false,
        }),
      ),
    );
    expect(router.push).toHaveBeenCalledWith("/onboarding/documents");
  });
});
