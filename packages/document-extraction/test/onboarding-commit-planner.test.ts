import { describe, expect, it } from "vitest";
import {
  planOnboardingCommit,
  type OnboardingCandidateDecision,
} from "../src/onboarding-commit-planner";

function candidate(
  overrides: Partial<OnboardingCandidateDecision> = {},
): OnboardingCandidateDecision {
  return {
    candidateId: "0:0",
    assetType: "property",
    identityFingerprint: "property:123-main-st-calgary-ab",
    decision: "approve_new",
    specifications: [
      {
        fieldPath: "coverage.liability.limitCents",
        confirmed: true,
        currentValue: 2_000_000_00,
        mandatedValue: 2_000_000_00,
      },
    ],
    ...overrides,
  };
}

describe("planOnboardingCommit", () => {
  it("creates deterministic entity and mandate commands for approved assets", () => {
    const plan = planOnboardingCommit([
      candidate(),
      candidate({
        candidateId: "3:0",
        assetType: "vehicle",
        identityFingerprint: "vehicle:vin:jm1cw2cl6d0150001",
        specifications: [
          {
            fieldPath: "coverage.collision.deductibleCents",
            confirmed: true,
            currentValue: 1_000_00,
            mandatedValue: 500_00,
          },
          {
            fieldPath: "coverage.liability.limitCents",
            confirmed: true,
            currentValue: 2_000_000_00,
            mandatedValue: 2_000_000_00,
          },
        ],
      }),
    ]);

    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.commands.map((command) => command.kind)).toEqual([
      "create_entity",
      "upsert_mandate_specification",
      "create_entity",
      "upsert_mandate_specification",
      "upsert_mandate_specification",
    ]);
    expect(plan.commands.map((command) => command.idempotencyKey)).toEqual([
      "onboarding:0%3a0:entity:create",
      "onboarding:0%3a0:specification:coverage.liability.limitcents",
      "onboarding:3%3a0:entity:create",
      "onboarding:3%3a0:specification:coverage.collision.deductiblecents",
      "onboarding:3%3a0:specification:coverage.liability.limitcents",
    ]);
  });

  it("links an approved extraction candidate to an existing entity", () => {
    const plan = planOnboardingCommit([
      candidate({
        decision: "link_existing",
        existingEntityId: "property-123",
      }),
    ]);

    expect(plan.ready).toBe(true);
    expect(plan.commands[0]).toMatchObject({
      kind: "link_existing_entity",
      candidateId: "0:0",
      existingEntityId: "property-123",
    });
    expect(plan.commands[1]).toMatchObject({
      kind: "upsert_mandate_specification",
      entityReference: { mode: "existing_entity", entityId: "property-123" },
    });
  });

  it("records skipped candidates without generating persistence commands", () => {
    const plan = planOnboardingCommit([
      candidate({ decision: "skip", specifications: [] }),
    ]);

    expect(plan).toEqual({
      ready: true,
      commands: [],
      blockers: [],
      skippedCandidateIds: ["0:0"],
    });
  });

  it("blocks unresolved identity, incomplete specifications, and invalid linking", () => {
    const plan = planOnboardingCommit([
      candidate({
        identityFingerprint: "",
        decision: "link_existing",
        existingEntityId: undefined,
        hasUnresolvedIdentityConflict: true,
        specifications: [
          {
            fieldPath: "coverage.liability.limitCents",
            confirmed: false,
            currentValue: undefined,
            mandatedValue: undefined,
          },
        ],
      }),
    ]);

    expect(plan.ready).toBe(false);
    expect(plan.commands).toEqual([]);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual([
      "missing_identity_fingerprint",
      "unresolved_identity_conflict",
      "missing_existing_entity_id",
      "unconfirmed_specification",
      "missing_current_value",
      "missing_mandated_value",
    ]);
  });

  it("blocks multiple active candidates in a potential duplicate group", () => {
    const plan = planOnboardingCommit([
      candidate({ candidateId: "0:0", duplicateGroupId: "duplicate-1" }),
      candidate({ candidateId: "1:0", duplicateGroupId: "duplicate-1" }),
    ]);

    expect(plan.ready).toBe(false);
    expect(plan.commands).toEqual([]);
    expect(
      plan.blockers.filter((blocker) => blocker.code === "duplicate_group_not_resolved"),
    ).toHaveLength(2);
  });

  it("allows a duplicate group after the customer keeps one candidate and skips the other", () => {
    const plan = planOnboardingCommit([
      candidate({ candidateId: "0:0", duplicateGroupId: "duplicate-1" }),
      candidate({
        candidateId: "1:0",
        duplicateGroupId: "duplicate-1",
        decision: "skip",
        specifications: [],
      }),
    ]);

    expect(plan.ready).toBe(true);
    expect(plan.skippedCandidateIds).toEqual(["1:0"]);
    expect(plan.commands).toHaveLength(2);
  });

  it("blocks duplicate candidate IDs and repeated specification fields", () => {
    const duplicated = candidate({
      specifications: [
        {
          fieldPath: "coverage.liability.limitCents",
          confirmed: true,
          currentValue: 2_000_000_00,
          mandatedValue: 2_000_000_00,
        },
        {
          fieldPath: "coverage.liability.limitCents",
          confirmed: true,
          currentValue: 1_000_000_00,
          mandatedValue: 1_000_000_00,
        },
      ],
    });

    const plan = planOnboardingCommit([duplicated, candidate()]);

    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain("duplicate_candidate_id");
    expect(plan.blockers.map((blocker) => blocker.code)).toContain(
      "duplicate_specification_field",
    );
  });
});
