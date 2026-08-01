import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import * as ReactQuery from "@tanstack/react-query";
import DocumentProcessingConsent from "../app/onboarding/document-processing-consent";
import { updateDangerousModeSetting } from "../lib/document-processing";
import { useHousehold } from "../lib/household";
import { supabase } from "../lib/supabase";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("expo-linking", () => ({
  openURL: jest.fn(),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("../lib/household");
jest.mock("../lib/document-processing");
jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

jest.mock("@tanstack/react-query", () => {
  const invalidateQueries = jest.fn(() => Promise.resolve());
  const queryClient = { invalidateQueries };
  return {
    useQueryClient: jest.fn(() => queryClient),
    useQuery: jest.fn(),
  };
});

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
const mockedFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockedUseQueryClient = ReactQuery.useQueryClient as jest.MockedFunction<
  typeof ReactQuery.useQueryClient
>;

import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeUrl,
  getProcessorContractVersion,
} from "../lib/document-processing-config";

const mockHousehold = {
  id: "10000000-0000-0000-0000-00000000h001",
  onboarding_step: "document_processing_consent",
};

describe("DocumentProcessingConsent", () => {
  let eqMock: jest.Mock;
  let updateMock: jest.Mock;

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

    eqMock = jest.fn(() => Promise.resolve({ error: null }));
    updateMock = jest.fn(() => ({ eq: eqMock }));
    mockedFrom.mockReturnValue({ update: updateMock } as any);
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

    expect(mockedFrom).toHaveBeenCalledWith("households");
    expect(updateMock).toHaveBeenCalledWith({ onboarding_step: "documents" });
    expect(eqMock).toHaveBeenCalledWith("id", mockHousehold.id);

    const { invalidateQueries } = mockedUseQueryClient();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["household"] });

    expect(router.replace).toHaveBeenCalledWith("/onboarding/documents");
    expect(router.push).not.toHaveBeenCalled();
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

    expect(mockedFrom).toHaveBeenCalledWith("households");
    expect(updateMock).toHaveBeenCalledWith({ onboarding_step: "documents" });
    expect(eqMock).toHaveBeenCalledWith("id", mockHousehold.id);

    const { invalidateQueries } = mockedUseQueryClient();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["household"] });

    expect(router.replace).toHaveBeenCalledWith("/onboarding/documents");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not navigate when the onboarding-step persistence fails", async () => {
    eqMock.mockResolvedValue({ error: new Error("Database unavailable") });
    const { getByText } = render(<DocumentProcessingConsent />);
    fireEvent.press(getByText("Allow processing"));

    await waitFor(() =>
      expect(getByText("Could not save onboarding progress")).toBeTruthy(),
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
