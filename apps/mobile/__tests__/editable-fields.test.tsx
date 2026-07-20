import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
} from "@autopilot/schemas";
import { AssetEditModal } from "../components/asset-edit-modal";
import { AssetListScreen } from "../components/asset-list-screen";
import EditMandate from "../app/edit-mandate";
import { autoEndorsementLabels, propertyOptionalCoverageLabels } from "../lib/mandate";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({
  router: mockRouter,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));

jest.mock("@/lib/household", () => ({
  useHousehold: jest.fn().mockReturnValue({ data: { id: "household-1" }, isLoading: false }),
}));

let edgeResult: { success: boolean; message?: string } = { success: true };
const mockInvokeEdgeFunction = jest.fn().mockImplementation(async () => ({
  data: edgeResult,
  error: null,
}));
jest.mock("@/lib/edge-functions", () => ({
  invokeEdgeFunction: (...args: unknown[]) => mockInvokeEdgeFunction(...args),
}));

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn().mockReturnValue({ data: null, isLoading: true }),
  useQueryClient: jest.fn().mockReturnValue({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock("@autopilot/database", () => ({
  loadHouseholdMandateV2: jest.fn(),
  MandateValidationError: class extends Error {},
  resolveEffectiveVehicleMandateV2: jest.fn((mandate: any, id: string) => {
    const override = mandate.vehicleOverrides?.find((o: any) => o.vehicleId === id)?.values || {};
    return { ...mandate.householdAutoDefaults, ...override };
  }),
  resolveEffectivePropertyMandateV2: jest.fn((mandate: any, id: string) => {
    const override = mandate.propertyOverrides?.find((o: any) => o.propertyId === id)?.values || {};
    return { ...mandate.householdPropertyDefaults, ...override };
  }),
  updateVehicleOverrideV2: jest.fn((mandate: any, id: string, values: any) => ({
    ...mandate,
    vehicleOverrides: [{ vehicleId: id, values }],
  })),
  updatePropertyOverrideV2: jest.fn((mandate: any, id: string, values: any) => ({
    ...mandate,
    propertyOverrides: [{ propertyId: id, values }],
  })),
  clearVehicleOverrideV2: jest.fn((mandate: any, id: string) => ({
    ...mandate,
    vehicleOverrides: mandate.vehicleOverrides?.filter((o: any) => o.vehicleId !== id) || [],
  })),
  clearPropertyOverrideV2: jest.fn((mandate: any, id: string) => ({
    ...mandate,
    propertyOverrides: mandate.propertyOverrides?.filter((o: any) => o.propertyId !== id) || [],
  })),
}));

const eqResult = { error: null };
const fromImpls: Record<string, jest.Mock> = {};
let mockSupabaseFrom = jest.fn((table: string) => {
  if (!fromImpls[table]) {
    fromImpls[table] = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue(eqResult) });
  }
  return { update: fromImpls[table] };
});
jest.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => mockSupabaseFrom(table) },
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import * as ReactQuery from "@tanstack/react-query";

function setQueryResult(result: { data: any; isLoading: boolean }) {
  (ReactQuery.useQuery as jest.Mock).mockReturnValue(result);
}

function buildEditMandateData() {
  const mandate = createDefaultHouseholdCoverageMandateV2();
  const switching = createDefaultSwitchingPreferencesV2();
  return {
    loadResult: {
      mandate,
      switching,
      versions: { mandateVersion: 1, switchingVersion: 1 },
    },
    vehicles: [
      {
        id: "v1",
        year: 2020,
        make: "Toyota",
        model: "RAV4",
        financing_status: "owned",
        vehicle_use_class: "personal",
        is_classic: false,
        is_modified: false,
      },
    ],
    properties: [
      {
        id: "p1",
        address_line1: "123 Main St",
        city: "Calgary",
        property_type: "homeowner",
      },
    ],
    insurers: [
      { id: "i1", name: "Intact" },
      { id: "i2", name: "TD" },
    ],
  };
}

function selectOption(getByLabelText: any, getByTestId: any, label: string, option: string) {
  fireEvent.press(getByLabelText(label));
  fireEvent.press(getByTestId(`select-option-${option}`));
}

function setSwitch(getByLabelText: any, label: string, value: boolean) {
  fireEvent(getByLabelText(label), "valueChange", value);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(fromImpls).forEach((key) => delete fromImpls[key]);
  edgeResult = { success: true };
  setQueryResult({ data: buildEditMandateData(), isLoading: false });
});

describe("AssetEditModal", () => {
  it("edits every vehicle field", async () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    const asset = {
      id: "v1",
      year: 2020,
      make: "Toyota",
      model: "RAV4",
      vin: "VIN123",
      financing_status: "owned",
      vehicle_use_class: "personal",
      is_classic: false,
      is_modified: false,
    };
    const { getByLabelText, getByText, getByTestId } = render(
      <AssetEditModal
        visible
        onClose={onClose}
        onSaved={onSaved}
        payload={{ type: "vehicle", asset }}
        candidate={{ id: "c1", display_label: "My car" }}
      />,
    );

    fireEvent.changeText(getByLabelText("Display name"), "My RAV4");
    fireEvent.changeText(getByLabelText("Year"), "2022");
    fireEvent.changeText(getByLabelText("Make"), "Honda");
    fireEvent.changeText(getByLabelText("Model"), "Civic");
    fireEvent.changeText(getByLabelText("VIN"), "NEWVIN");
    fireEvent.changeText(getByLabelText("Financing"), "financed");
    fireEvent.changeText(getByLabelText("Use class"), "commercial");
    fireEvent.press(getByLabelText("Classic"));
    fireEvent.press(getByLabelText("Modified"));

    fireEvent.press(getByText("Save"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    expect(mockSupabaseFrom).toHaveBeenCalledWith("vehicles");
    expect(fromImpls["vehicles"]).toHaveBeenCalledWith({
      year: 2022,
      make: "Honda",
      model: "Civic",
      vin: "NEWVIN",
      financing_status: "financed",
      vehicle_use_class: "commercial",
      is_classic: true,
      is_modified: true,
    });

    expect(mockSupabaseFrom).toHaveBeenCalledWith("asset_candidates");
    expect(fromImpls["asset_candidates"]).toHaveBeenCalledWith({ display_label: "My RAV4" });
  });

  it("edits every property field", async () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    const asset = {
      id: "p1",
      address_line1: "123 Main St",
      city: "Calgary",
      province: "AB",
      postal_code: "T3A 0C2",
      property_type: "homeowner",
      owner_occupied: true,
      year_built: 2005,
    };
    const { getByLabelText, getByText, getByTestId } = render(
      <AssetEditModal
        visible
        onClose={onClose}
        onSaved={onSaved}
        payload={{ type: "property", asset }}
        candidate={{ id: "c1", display_label: "Home" }}
      />,
    );

    fireEvent.changeText(getByLabelText("Display name"), "My home");
    fireEvent.changeText(getByLabelText("Address line 1"), "456 Oak Ave");
    fireEvent.changeText(getByLabelText("City"), "Edmonton");
    fireEvent.changeText(getByLabelText("Province"), "BC");
    fireEvent.changeText(getByLabelText("Postal code"), "V6B 1A1");
    fireEvent.changeText(getByLabelText("Property type"), "landlord");
    fireEvent.press(getByLabelText("Owner occupied"));
    fireEvent.changeText(getByLabelText("Year built"), "2010");

    fireEvent.press(getByText("Save"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(fromImpls["properties"]).toHaveBeenCalledWith({
      address_line1: "456 Oak Ave",
      city: "Edmonton",
      province: "BC",
      postal_code: "V6B 1A1",
      property_type: "landlord",
      owner_occupied: false,
      year_built: 2010,
    });
    expect(fromImpls["asset_candidates"]).toHaveBeenCalledWith({ display_label: "My home" });
  });

  it("shows an error when the save fails", async () => {
    fromImpls["vehicles"] = jest.fn().mockReturnValue({
      eq: jest
        .fn()
        .mockResolvedValue({ error: { message: "permission denied for table vehicles" } }),
    });

    const onSaved = jest.fn();
    const asset = {
      id: "v1",
      year: 2020,
      make: "Toyota",
      model: "RAV4",
      vin: null,
      financing_status: "owned",
      vehicle_use_class: "personal",
      is_classic: false,
      is_modified: false,
    };
    const { getByText, getByLabelText } = render(
      <AssetEditModal
        visible
        onClose={jest.fn()}
        onSaved={onSaved}
        payload={{ type: "vehicle", asset }}
        candidate={null}
      />,
    );

    fireEvent.changeText(getByLabelText("Make"), "Honda");
    fireEvent.press(getByText("Save"));

    await waitFor(() => expect(getByText("permission denied for table vehicles")).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("EditMandate", () => {
  it("edits every auto household default field", async () => {
    const { getByLabelText, getByText, getByTestId } = render(<EditMandate />);

    fireEvent.press(getByLabelText("Auto household defaults"));

    selectOption(getByLabelText, getByTestId, "Coverage form", "All perils");
    selectOption(getByLabelText, getByTestId, "Coverage form preference", "Preferred");

    selectOption(getByLabelText, getByTestId, "Liability rule", "Exactly");
    fireEvent.changeText(getByLabelText("Liability amount (C$)"), "3000000");

    selectOption(getByLabelText, getByTestId, "Collision deductible rule", "Exactly");
    fireEvent.changeText(getByLabelText("Collision deductible amount (C$)"), "1000");

    selectOption(getByLabelText, getByTestId, "Comprehensive deductible rule", "Exactly");
    fireEvent.changeText(getByLabelText("Comprehensive deductible amount (C$)"), "1000");

    selectOption(getByLabelText, getByTestId, "Glass deductible rule", "At most");
    fireEvent.changeText(getByLabelText("Glass deductible amount (C$)"), "500");

    Object.values(autoEndorsementLabels).forEach((label) => {
      selectOption(getByLabelText, getByTestId, label, "Required");
    });

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(mockInvokeEdgeFunction).toHaveBeenCalled());
    const payload = mockInvokeEdgeFunction.mock.calls[0][1];
    const auto = payload.mandate.householdAutoDefaults;

    expect(auto.coverageForm.value).toBe("all_perils");
    expect(auto.coverageForm.preference).toBe("preferred");
    expect(auto.liability).toEqual({ rule: "exact", amountCents: 300_000_000 });
    expect(auto.collisionDeductible).toEqual({ rule: "exact", amountCents: 100_000 });
    expect(auto.comprehensiveDeductible).toEqual({ rule: "exact", amountCents: 100_000 });
    expect(auto.glassDeductible).toEqual({ rule: "maximum", amountCents: 50_000 });
    Object.keys(autoEndorsementLabels).forEach((key) => {
      expect(auto.endorsements[key]).toBe("required");
    });
  });

  it("edits every property household default field", async () => {
    const { getByLabelText, getByText, getByTestId } = render(<EditMandate />);

    fireEvent.press(getByLabelText("Property household defaults"));

    selectOption(getByLabelText, getByTestId, "Coverage form", "Broad");
    selectOption(getByLabelText, getByTestId, "Coverage form preference", "Preferred");
    selectOption(getByLabelText, getByTestId, "Settlement basis", "Guaranteed replacement cost");
    selectOption(getByLabelText, getByTestId, "Settlement preference", "Preferred");

    [
      "Dwelling limit",
      "Contents limit",
      "Detached structures limit",
      "Personal liability limit",
      "Additional living expense limit",
    ].forEach((label) => {
      selectOption(getByLabelText, getByTestId, `${label} rule`, "Exactly");
      fireEvent.changeText(getByLabelText(`${label} amount (C$)`), "1000000");
    });

    [
      "Base deductible",
      "Water deductible",
      "Wind/hail deductible",
      "Earthquake deductible",
    ].forEach((label) => {
      selectOption(getByLabelText, getByTestId, `${label} rule`, "Exactly");
      fireEvent.changeText(getByLabelText(`${label} amount (C$)`), "2000");
    });

    ["Sewer backup", "Overland water"].forEach((name) => {
      selectOption(getByLabelText, getByTestId, `${name} preference`, "Required");
      selectOption(getByLabelText, getByTestId, `${name} limit rule`, "Exactly");
      fireEvent.changeText(getByLabelText(`${name} limit amount (C$)`), "500000");
      selectOption(getByLabelText, getByTestId, `${name} deductible rule`, "Exactly");
      fireEvent.changeText(getByLabelText(`${name} deductible amount (C$)`), "1000");
    });

    Object.values(propertyOptionalCoverageLabels).forEach((label) => {
      selectOption(getByLabelText, getByTestId, label, "Required");
    });

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(mockInvokeEdgeFunction).toHaveBeenCalled());
    const payload = mockInvokeEdgeFunction.mock.calls[0][1];
    const property = payload.mandate.householdPropertyDefaults;

    expect(property.coverageForm.value).toBe("broad");
    expect(property.settlementBasis.value).toBe("guaranteed_replacement_cost");
    expect(property.dwellingLimit).toEqual({ rule: "exact", amountCents: 100_000_000 });
    expect(property.baseDeductible).toEqual({ rule: "exact", amountCents: 200_000 });
    expect(property.sewerBackup.preference).toBe("required");
    expect(property.sewerBackup.limit).toEqual({ rule: "exact", amountCents: 50_000_000 });
    expect(property.sewerBackup.deductible).toEqual({ rule: "exact", amountCents: 100_000 });
    Object.keys(propertyOptionalCoverageLabels).forEach((key) => {
      expect(property.optionalCoverages[key]).toBe("required");
    });
  });

  it("edits every switching rules field", async () => {
    const { getByLabelText, getByText, getByTestId } = render(<EditMandate />);

    fireEvent.press(getByLabelText("Switching rules"));

    fireEvent.changeText(getByLabelText("Minimum net annual savings before switching (C$)"), "500");
    fireEvent.changeText(getByLabelText("Maximum acceptable deductible increase (C$)"), "1000");

    setSwitch(getByLabelText, "Only switch at renewal", false);
    setSwitch(getByLabelText, "Optimize home and auto together", false);
    setSwitch(getByLabelText, "Allow different insurers per policy", false);
    setSwitch(getByLabelText, "Allow bundle breakup", true);
    setSwitch(getByLabelText, "Allow deductible increases", true);

    selectOption(getByLabelText, getByTestId, "Preferred payment frequency", "Monthly");
    selectOption(getByLabelText, getByTestId, "Preferred billing method", "Credit card");
    selectOption(getByLabelText, getByTestId, "Broker/direct preference", "Direct");
    selectOption(getByLabelText, getByTestId, "Minimum insurer financial rating", "A+ or higher");

    setSwitch(getByLabelText, "Exclude Intact", true);
    setSwitch(getByLabelText, "Exclude TD", true);

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(mockInvokeEdgeFunction).toHaveBeenCalled());
    const payload = mockInvokeEdgeFunction.mock.calls[0][1];
    const switching = payload.switching;

    expect(switching.minNetAnnualSavingsCents).toBe(50_000);
    expect(switching.maxDeductibleIncreaseCents).toBe(100_000);
    expect(switching.renewalOnlySwitching).toBe(false);
    expect(switching.householdOptimizationEnabled).toBe(false);
    expect(switching.splitInsurersAllowed).toBe(false);
    expect(switching.allowBundleBreakup).toBe(true);
    expect(switching.deductibleIncreasesAllowed).toBe(true);
    expect(switching.preferredPaymentFrequency).toBe("monthly");
    expect(switching.preferredBillingMethod).toBe("credit_card");
    expect(switching.brokerDirectPreference).toBe("direct");
    expect(switching.minimumInsurerFinancialRating).toBe("A_plus");
    expect(switching.excludedInsurerIds).toEqual(["i1", "i2"]);
  });

  it("edits a vehicle override", async () => {
    const { getByLabelText, getByText, getByTestId, getAllByLabelText } = render(<EditMandate />);

    const vehicleDefaults = getAllByLabelText("Use household defaults");
    fireEvent.press(vehicleDefaults[0]);

    selectOption(getByLabelText, getByTestId, "Liability rule", "Exactly");
    fireEvent.changeText(getByLabelText("Liability amount (C$)"), "5000000");

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(mockInvokeEdgeFunction).toHaveBeenCalled());
    const payload = mockInvokeEdgeFunction.mock.calls[0][1];
    expect(payload.mandate.vehicleOverrides).toHaveLength(1);
    expect(payload.mandate.vehicleOverrides[0].values.liability).toEqual({
      rule: "exact",
      amountCents: 500_000_000,
    });
  });

  it("edits a property override", async () => {
    const { getByLabelText, getByText, getByTestId, getAllByLabelText } = render(<EditMandate />);

    const propertyDefaults = getAllByLabelText("Use household defaults");
    fireEvent.press(propertyDefaults[1]);

    selectOption(getByLabelText, getByTestId, "Dwelling limit rule", "Exactly");
    fireEvent.changeText(getByLabelText("Dwelling limit amount (C$)"), "1200000");

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(mockInvokeEdgeFunction).toHaveBeenCalled());
    const payload = mockInvokeEdgeFunction.mock.calls[0][1];
    expect(payload.mandate.propertyOverrides).toHaveLength(1);
    expect(payload.mandate.propertyOverrides[0].values.dwellingLimit).toEqual({
      rule: "exact",
      amountCents: 120_000_000,
    });
  });

  it("shows an error when saving fails", async () => {
    edgeResult = { success: false, message: "Mandate stale" };

    const { getByText, getByLabelText } = render(<EditMandate />);

    fireEvent.press(getByLabelText("Switching rules"));
    setSwitch(getByLabelText, "Only switch at renewal", false);

    fireEvent.press(getByText("Save changes"));

    await waitFor(() => expect(getByText("Mandate stale")).toBeTruthy());
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe("AssetListScreen", () => {
  it("renames an asset from edit mode", async () => {
    const onRename = jest.fn().mockResolvedValue(undefined);
    const asset = {
      id: "p1",
      displayName: "Home",
      subtitle: "123 Main St",
      searchText: "home 123 main st",
      data: { candidate: { id: "c1" } },
    };
    const { getByLabelText, getByText, getByDisplayValue } = render(
      <AssetListScreen
        title="Properties"
        searchPlaceholder="Search properties"
        emptyTitle="No properties"
        emptyBody="Upload a document to add properties."
        noResultsTitle="No matching properties"
        noResultsBody="Try another search."
        assets={[asset]}
        isLoading={false}
        error={null}
        refetch={jest.fn()}
        onOpen={jest.fn()}
        onRemove={jest.fn()}
        onRename={onRename}
      />,
    );

    fireEvent.press(getByLabelText("Edit"));
    fireEvent.press(getByLabelText("Rename Home"));
    fireEvent.changeText(getByDisplayValue("Home"), "Primary Home");
    fireEvent.press(getByText("Save"));

    await waitFor(() => expect(onRename).toHaveBeenCalled());
    expect(onRename).toHaveBeenCalledWith(asset, "Primary Home");
  });
});
