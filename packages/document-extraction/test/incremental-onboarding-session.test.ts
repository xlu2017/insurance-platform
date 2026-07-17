import { describe, expect, it } from "vitest";
import {
  createEmptyIncrementalOnboardingSession,
  mergeIncrementalOnboardingUpload,
  type IncrementalOnboardingSession,
  type IncrementalOnboardingUpload,
  type IncomingOnboardingCandidate,
  type IncomingSpecificationReview,
} from "../src/incremental-onboarding-session";

function specification(
  fieldPath: string,
  currentValue: unknown,
  extractionFingerprint: string,
): IncomingSpecificationReview {
  return { fieldPath, currentValue, extractionFingerprint };
}

function candidate(
  overrides: Partial<IncomingOnboardingCandidate> = {},
): IncomingOnboardingCandidate {
  return {
    localCandidateId: "asset-0",
    assetType: "property",
    identityFingerprint: "property:123-main-st-calgary-ab",
    reviewFingerprint: "candidate-review:v1",
    specifications: [
      specification(
        "coverage.liability.limitCents",
        200_000_000,
        "liability:v1",
      ),
    ],
    ...overrides,
  };
}

function upload(
  documentFingerprint: string,
  candidates: readonly IncomingOnboardingCandidate[],
  extractionRevision = "parser:v1",
  uploadId = `upload:${documentFingerprint}:${extractionRevision}`,
): IncrementalOnboardingUpload {
  return {
    uploadId,
    documentFingerprint,
    extractionRevision,
    candidates,
  };
}

function add(
  session: IncrementalOnboardingSession,
  nextUpload: IncrementalOnboardingUpload,
): IncrementalOnboardingSession {
  const merged = mergeIncrementalOnboardingUpload(session, nextUpload);
  expect(merged.accepted).toBe(true);
  return merged.session;
}

describe("mergeIncrementalOnboardingUpload", () => {
  it("accumulates four documents uploaded separately with order-independent candidate IDs", () => {
    const uploads = [
      upload("doc-primary", [
        candidate({ identityFingerprint: "property:primary" }),
      ]),
      upload("doc-rental-1", [
        candidate({ identityFingerprint: "property:rental-1" }),
      ]),
      upload("doc-rental-2", [
        candidate({ identityFingerprint: "property:rental-2" }),
      ]),
      upload("doc-vehicle", [
        candidate({
          assetType: "vehicle",
          identityFingerprint: "vehicle:vin:jm1cw2cl6d0150001",
        }),
      ]),
    ];

    const forward = uploads.reduce(add, createEmptyIncrementalOnboardingSession());
    const reverse = [...uploads]
      .reverse()
      .reduce(add, createEmptyIncrementalOnboardingSession());

    expect(forward.documents).toHaveLength(4);
    expect(forward.candidates).toHaveLength(4);
    expect(forward.candidates.every((item) => item.decision === "pending")).toBe(
      true,
    );
    expect(forward.candidates.every((item) => !item.superseded)).toBe(true);
    expect(forward.candidates.map((item) => item.candidateId).sort()).toEqual(
      reverse.candidates.map((item) => item.candidateId).sort(),
    );
  });

  it("treats an identical document extraction as an idempotent no-op", () => {
    const firstUpload = upload("doc-primary", [candidate()]);
    const first = mergeIncrementalOnboardingUpload(
      createEmptyIncrementalOnboardingSession(),
      firstUpload,
    );
    const second = mergeIncrementalOnboardingUpload(first.session, {
      ...firstUpload,
      uploadId: "upload:retry",
    });

    expect(second.outcome).toBe("duplicate_document");
    expect(second.session).toBe(first.session);
    expect(second.addedCandidateIds).toEqual([]);
    expect(second.updatedCandidateIds).toEqual([]);
    expect(second.session.revision).toBe(1);
  });

  it("preserves reviewed work when a new parser revision produces identical semantics", () => {
    const initial = mergeIncrementalOnboardingUpload(
      createEmptyIncrementalOnboardingSession(),
      upload("doc-primary", [candidate()]),
    ).session;
    const reviewed = initial.candidates[0]!;
    reviewed.decision = "approve_new";
    reviewed.reviewFreshness = "confirmed";
    reviewed.specifications[0]!.confirmed = true;

    const reprocessed = mergeIncrementalOnboardingUpload(
      initial,
      upload("doc-primary", [candidate()], "parser:v2"),
    );

    expect(reprocessed.outcome).toBe("document_reprocessed_unchanged");
    expect(reprocessed.session.candidates[0]).toEqual(reviewed);
    expect(reprocessed.session.documents[0]?.extractionRevision).toBe("parser:v2");
    expect(reprocessed.staleCandidateIds).toEqual([]);
  });

  it("marks changed extraction stale, refreshes defaults, and preserves custom mandates", () => {
    const initialCandidate = candidate({
      specifications: [
        specification(
          "coverage.collision.deductibleCents",
          100_000,
          "collision:v1",
        ),
        specification(
          "coverage.liability.limitCents",
          200_000_000,
          "liability:v1",
        ),
      ],
    });
    const initial = mergeIncrementalOnboardingUpload(
      createEmptyIncrementalOnboardingSession(),
      upload("doc-primary", [initialCandidate]),
    ).session;
    const reviewed = initial.candidates[0]!;
    reviewed.decision = "approve_new";
    reviewed.reviewFreshness = "confirmed";
    reviewed.specifications.forEach((item) => {
      item.confirmed = true;
    });
    const collision = reviewed.specifications.find(
      (item) => item.fieldPath === "coverage.collision.deductibleCents",
    )!;
    collision.mandatedValue = 50_000;
    collision.mandatedValueOrigin = "customer_customized";

    const changed = mergeIncrementalOnboardingUpload(
      initial,
      upload(
        "doc-primary",
        [
          candidate({
            reviewFingerprint: "candidate-review:v2",
            specifications: [
              specification(
                "coverage.collision.deductibleCents",
                150_000,
                "collision:v2",
              ),
              specification(
                "coverage.liability.limitCents",
                300_000_000,
                "liability:v2",
              ),
            ],
          }),
        ],
        "parser:v2",
      ),
    );

    const updated = changed.session.candidates[0]!;
    const updatedCollision = updated.specifications.find(
      (item) => item.fieldPath === "coverage.collision.deductibleCents",
    )!;
    const updatedLiability = updated.specifications.find(
      (item) => item.fieldPath === "coverage.liability.limitCents",
    )!;

    expect(changed.outcome).toBe("document_reprocessed_changed");
    expect(updated.decision).toBe("approve_new");
    expect(updated.reviewFreshness).toBe("stale");
    expect(updated.specifications.every((item) => !item.confirmed)).toBe(true);
    expect(updatedCollision.currentValue).toBe(150_000);
    expect(updatedCollision.mandatedValue).toBe(50_000);
    expect(updatedCollision.mandatedValueOrigin).toBe("customer_customized");
    expect(updatedLiability.currentValue).toBe(300_000_000);
    expect(updatedLiability.mandatedValue).toBe(300_000_000);
    expect(changed.warnings).toContain("customer_review_became_stale");
  });

  it("resets entity decisions and links when reprocessing changes identity", () => {
    const initial = mergeIncrementalOnboardingUpload(
      createEmptyIncrementalOnboardingSession(),
      upload("doc-primary", [candidate()]),
    ).session;
    const reviewed = initial.candidates[0]!;
    reviewed.decision = "link_existing";
    reviewed.existingEntityId = "property-existing-1";
    reviewed.reviewFreshness = "confirmed";
    reviewed.specifications[0]!.confirmed = true;

    const changed = mergeIncrementalOnboardingUpload(
      initial,
      upload("doc-primary", [
        candidate({
          identityFingerprint: "property:456-new-address-calgary-ab",
          reviewFingerprint: "candidate-review:v2",
        }),
      ]),
    );
    const updated = changed.session.candidates[0]!;

    expect(updated.decision).toBe("pending");
    expect(updated.existingEntityId).toBeUndefined();
    expect(updated.reviewFreshness).toBe("stale");
    expect(updated.specifications.every((item) => !item.confirmed)).toBe(true);
  });

  it("supersedes removed candidates while retaining an auditable draft", () => {
    const initial = mergeIncrementalOnboardingUpload(
      createEmptyIncrementalOnboardingSession(),
      upload("doc-multi", [
        candidate({
          localCandidateId: "asset-a",
          identityFingerprint: "property:a",
        }),
        candidate({
          localCandidateId: "asset-b",
          identityFingerprint: "property:b",
        }),
      ]),
    ).session;

    const changed = mergeIncrementalOnboardingUpload(
      initial,
      upload(
        "doc-multi",
        [
          candidate({
            localCandidateId: "asset-a",
            identityFingerprint: "property:a",
          }),
          candidate({
            localCandidateId: "asset-c",
            identityFingerprint: "property:c",
          }),
        ],
        "parser:v2",
      ),
    );

    const removed = changed.session.candidates.find(
      (item) => item.localCandidateId === "asset-b",
    )!;
    const added = changed.session.candidates.find(
      (item) => item.localCandidateId === "asset-c",
    )!;

    expect(removed.superseded).toBe(true);
    expect(removed.reviewFreshness).toBe("stale");
    expect(removed.specifications.every((item) => item.superseded)).toBe(true);
    expect(added.superseded).toBe(false);
    expect(added.reviewFreshness).toBe("unreviewed");
    expect(changed.supersededCandidateIds).toEqual([removed.candidateId]);
    expect(changed.session.documents[0]?.candidateIds).not.toContain(
      removed.candidateId,
    );
    expect(changed.warnings).toContain("candidates_removed_by_reprocessing");
  });

  it("flags equal identities across separate uploads without merging candidates", () => {
    let session = createEmptyIncrementalOnboardingSession();
    session = add(
      session,
      upload("doc-one", [
        candidate({ identityFingerprint: "property:same-address" }),
      ]),
    );
    const second = mergeIncrementalOnboardingUpload(
      session,
      upload("doc-two", [
        candidate({ identityFingerprint: "property:same-address" }),
      ]),
    );

    expect(second.session.candidates).toHaveLength(2);
    expect(second.duplicateGroups).toHaveLength(1);
    expect(second.duplicateGroups[0]?.candidateIds).toHaveLength(2);
    expect(
      new Set(second.session.candidates.map((item) => item.duplicateGroupId)).size,
    ).toBe(1);
    expect(second.warnings).toContain("potential_duplicate_assets_present");
  });

  it("rejects malformed uploads atomically", () => {
    const session = add(
      createEmptyIncrementalOnboardingSession(),
      upload("doc-existing", [candidate()]),
    );
    const invalidCandidate = candidate({
      localCandidateId: "duplicate",
      specifications: [
        specification("coverage.limit", 1, "limit:v1"),
        specification("coverage.limit", 2, "limit:v2"),
      ],
    });

    const blocked = mergeIncrementalOnboardingUpload(
      session,
      upload("doc-invalid", [invalidCandidate, invalidCandidate]),
    );

    expect(blocked.accepted).toBe(false);
    expect(blocked.outcome).toBe("blocked");
    expect(blocked.session).toBe(session);
    expect(blocked.blockers.map((item) => item.code)).toContain(
      "duplicate_local_candidate_id",
    );
    expect(blocked.blockers.map((item) => item.code)).toContain(
      "duplicate_specification_field_path",
    );
    expect(blocked.session.revision).toBe(1);
  });
});
