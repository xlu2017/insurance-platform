import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { CandidateSummary } from "@/app/onboarding/review-entities";
import type { ExtractionCandidate } from "@/lib/extraction";
import type { CandidateDecision } from "@/lib/review-entities-helpers";

function baseCandidate(
  overrides: Partial<ExtractionCandidate> & { id: string },
): ExtractionCandidate {
  return {
    session_id: "s1",
    household_id: "h1",
    asset_type: "vehicle",
    identity_fingerprint: `fp-${overrides.id}`,
    display_label: overrides.display_label ?? `Candidate ${overrides.id}`,
    occupancy: null,
    match_classification: "new",
    decision: "pending",
    review_status: "pending",
    selected_facts_json: {},
    conflicts_json: [],
    ...overrides,
  } as ExtractionCandidate;
}

function candidateWithExisting(
  id: string,
  classification: "exact_existing_match" | "possible_existing_match",
  persistedDecision: CandidateDecision | null = null,
): ExtractionCandidate {
  return baseCandidate({
    id,
    display_label: `${classification} ${id}`,
    match_classification: classification,
    draft_decision: persistedDecision,
    draft_existing_asset_id: "existing-1",
    draft_existing_asset_type: "vehicle",
    selected_facts_json: {
      existingAsset: {
        id: "existing-1",
        asset_type: "vehicle",
        display_label: "2019 Honda Civic",
      },
    },
  });
}

function renderCandidate(candidate: ExtractionCandidate, onDecision = jest.fn()) {
  return render(
    <CandidateSummary
      candidate={candidate}
      drafts={{}}
      addressVerified={{}}
      onEdit={jest.fn()}
      onDecision={onDecision}
      onAddressVerified={jest.fn()}
      onEditDisplayName={async () => {}}
      busy={false}
    />,
  );
}

describe("CandidateSummary decision handling", () => {
  it("advancing from an approve_new candidate to a possible_match resets selection and disables Continue", async () => {
    const onDecisionA = jest.fn();
    const candidateA = baseCandidate({
      id: "candidate-a",
      display_label: "New vehicle",
      match_classification: "new",
      draft_decision: "approve_new",
    });
    const { getByRole, rerender } = renderCandidate(candidateA, onDecisionA);

    fireEvent.press(getByRole("button", { name: "Add as new asset" }));
    const continueA = getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueA.props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(continueA);
    await waitFor(() => expect(onDecisionA).toHaveBeenCalledWith("approve_new"));

    const onDecisionB = jest.fn();
    const candidateB = candidateWithExisting("candidate-b", "possible_existing_match");
    rerender(
      <CandidateSummary
        candidate={candidateB}
        drafts={{}}
        addressVerified={{}}
        onEdit={jest.fn()}
        onDecision={onDecisionB}
        onAddressVerified={jest.fn()}
        onEditDisplayName={async () => {}}
        busy={false}
      />,
    );

    const continueB = getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueB.props.accessibilityState?.disabled).toBe(true));

    fireEvent.press(getByRole("button", { name: "Link to existing asset" }));
    await waitFor(() =>
      expect(getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled).toBe(
        false,
      ),
    );

    fireEvent.press(getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDecisionB).toHaveBeenCalledWith("link_existing"));
    expect(onDecisionA).toHaveBeenCalledTimes(1);
    expect(onDecisionB).toHaveBeenCalledTimes(1);
    expect(onDecisionB).not.toHaveBeenCalledWith("approve_new");
  });

  it("advancing from an approve_new candidate to a persisted needs_correction candidate preserves the correction", async () => {
    const onDecisionA = jest.fn();
    const candidateA = baseCandidate({
      id: "candidate-a",
      match_classification: "new",
      draft_decision: "approve_new",
    });
    const { getByRole, rerender } = renderCandidate(candidateA, onDecisionA);

    fireEvent.press(getByRole("button", { name: "Add as new asset" }));
    fireEvent.press(getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDecisionA).toHaveBeenCalledWith("approve_new"));

    const onDecisionB = jest.fn();
    const candidateB = baseCandidate({
      id: "candidate-b",
      match_classification: "new_identity_confirmation_required",
      draft_decision: "needs_correction",
    });
    rerender(
      <CandidateSummary
        candidate={candidateB}
        drafts={{}}
        addressVerified={{}}
        onEdit={jest.fn()}
        onDecision={onDecisionB}
        onAddressVerified={jest.fn()}
        onEditDisplayName={async () => {}}
        busy={false}
      />,
    );

    const continueB = getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueB.props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(continueB);

    await waitFor(() => expect(onDecisionB).toHaveBeenCalledWith("needs_correction"));
  });

  it("starts a possible match undecided and allows explicit add-new selection", async () => {
    const onDecision = jest.fn();
    const candidate = candidateWithExisting("possible-1", "possible_existing_match");
    const { getByRole } = renderCandidate(candidate, onDecision);

    const continueButton = getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton.props.accessibilityState?.disabled).toBe(true));

    fireEvent.press(getByRole("button", { name: "Add as new asset" }));
    await waitFor(() =>
      expect(getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled).toBe(
        false,
      ),
    );

    fireEvent.press(getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve_new"));
  });

  it("clears the existing asset selection when add-new is chosen for a possible match", async () => {
    const onDecision = jest.fn();
    const candidate = candidateWithExisting("possible-2", "possible_existing_match");
    const { getByRole } = renderCandidate(candidate, onDecision);

    fireEvent.press(getByRole("button", { name: "Link to existing asset" }));
    fireEvent.press(getByRole("button", { name: "Add as new asset" }));
    fireEvent.press(getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve_new"));
  });
});
