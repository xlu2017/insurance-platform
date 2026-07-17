export type CandidateDecision = "approve_new" | "link_existing" | "skip";

export interface SpecificationDecision {
  fieldPath: string;
  confirmed: boolean;
  currentValue?: unknown;
  mandatedValue?: unknown;
}

export interface OnboardingCandidateDecision {
  candidateId: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  decision: CandidateDecision;
  existingEntityId?: string;
  specifications: SpecificationDecision[];
  hasUnresolvedIdentityConflict?: boolean;
  duplicateGroupId?: string;
}

export interface CreateEntityCommand {
  kind: "create_entity";
  idempotencyKey: string;
  candidateId: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
}

export interface LinkExistingEntityCommand {
  kind: "link_existing_entity";
  idempotencyKey: string;
  candidateId: string;
  existingEntityId: string;
}

export interface UpsertMandateSpecificationCommand {
  kind: "upsert_mandate_specification";
  idempotencyKey: string;
  candidateId: string;
  entityReference:
    | { mode: "created_from_candidate"; candidateId: string }
    | { mode: "existing_entity"; entityId: string };
  fieldPath: string;
  currentValue: unknown;
  mandatedValue: unknown;
}

export type OnboardingCommitCommand =
  | CreateEntityCommand
  | LinkExistingEntityCommand
  | UpsertMandateSpecificationCommand;

export interface OnboardingCommitBlocker {
  candidateId: string;
  code:
    | "duplicate_candidate_id"
    | "missing_identity_fingerprint"
    | "unresolved_identity_conflict"
    | "duplicate_group_not_resolved"
    | "missing_existing_entity_id"
    | "existing_entity_id_not_allowed"
    | "unconfirmed_specification"
    | "missing_current_value"
    | "missing_mandated_value"
    | "duplicate_specification_field";
  fieldPath?: string;
  message: string;
}

export interface OnboardingCommitPlan {
  ready: boolean;
  commands: OnboardingCommitCommand[];
  blockers: OnboardingCommitBlocker[];
  skippedCandidateIds: string[];
}

function keyPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase()).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Converts explicit customer onboarding decisions into a persistence command plan.
 *
 * The planner is deliberately persistence-free. Callers must execute the returned
 * commands transactionally and enforce their own authorization and database
 * constraints. Commands receive deterministic idempotency keys so retries do not
 * create duplicate entities or mandate rows.
 */
export function planOnboardingCommit(
  decisions: readonly OnboardingCandidateDecision[],
): OnboardingCommitPlan {
  const commands: OnboardingCommitCommand[] = [];
  const blockers: OnboardingCommitBlocker[] = [];
  const skippedCandidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  const duplicateGroups = new Map<string, OnboardingCandidateDecision[]>();

  for (const candidate of decisions) {
    if (seenCandidateIds.has(candidate.candidateId)) {
      blockers.push({
        candidateId: candidate.candidateId,
        code: "duplicate_candidate_id",
        message: "Candidate IDs must be unique within an onboarding commit.",
      });
    }
    seenCandidateIds.add(candidate.candidateId);

    if (candidate.duplicateGroupId) {
      const group = duplicateGroups.get(candidate.duplicateGroupId) ?? [];
      group.push(candidate);
      duplicateGroups.set(candidate.duplicateGroupId, group);
    }
  }

  for (const [groupId, group] of duplicateGroups) {
    const active = group.filter((candidate) => candidate.decision !== "skip");
    if (active.length > 1) {
      for (const candidate of active) {
        blockers.push({
          candidateId: candidate.candidateId,
          code: "duplicate_group_not_resolved",
          message: `Potential duplicate group ${groupId} has multiple approved candidates. Skip or reconcile all but one before committing.`,
        });
      }
    }
  }

  for (const candidate of decisions) {
    if (candidate.decision === "skip") {
      skippedCandidateIds.push(candidate.candidateId);
      continue;
    }

    if (!candidate.identityFingerprint.trim()) {
      blockers.push({
        candidateId: candidate.candidateId,
        code: "missing_identity_fingerprint",
        message: "An approved candidate requires a non-empty identity fingerprint.",
      });
    }

    if (candidate.hasUnresolvedIdentityConflict) {
      blockers.push({
        candidateId: candidate.candidateId,
        code: "unresolved_identity_conflict",
        message: "Resolve the candidate identity conflict before committing onboarding.",
      });
    }

    if (candidate.decision === "link_existing" && !candidate.existingEntityId?.trim()) {
      blockers.push({
        candidateId: candidate.candidateId,
        code: "missing_existing_entity_id",
        message: "Linking a candidate requires an existing entity ID.",
      });
    }

    if (candidate.decision === "approve_new" && candidate.existingEntityId?.trim()) {
      blockers.push({
        candidateId: candidate.candidateId,
        code: "existing_entity_id_not_allowed",
        message: "A newly created entity cannot also reference an existing entity ID.",
      });
    }

    const seenFieldPaths = new Set<string>();
    for (const specification of candidate.specifications) {
      if (seenFieldPaths.has(specification.fieldPath)) {
        blockers.push({
          candidateId: candidate.candidateId,
          code: "duplicate_specification_field",
          fieldPath: specification.fieldPath,
          message: "Each specification field may appear only once per candidate.",
        });
      }
      seenFieldPaths.add(specification.fieldPath);

      if (!specification.confirmed) {
        blockers.push({
          candidateId: candidate.candidateId,
          code: "unconfirmed_specification",
          fieldPath: specification.fieldPath,
          message: "Every specification must be explicitly confirmed before commit.",
        });
      }
      if (!hasValue(specification.currentValue)) {
        blockers.push({
          candidateId: candidate.candidateId,
          code: "missing_current_value",
          fieldPath: specification.fieldPath,
          message: "Confirmed specifications require a current value.",
        });
      }
      if (!hasValue(specification.mandatedValue)) {
        blockers.push({
          candidateId: candidate.candidateId,
          code: "missing_mandated_value",
          fieldPath: specification.fieldPath,
          message: "Confirmed specifications require a mandated value.",
        });
      }
    }
  }

  if (blockers.length > 0) {
    return {
      ready: false,
      commands: [],
      blockers,
      skippedCandidateIds,
    };
  }

  for (const candidate of decisions) {
    if (candidate.decision === "skip") continue;

    const candidateKey = keyPart(candidate.candidateId);
    const entityReference =
      candidate.decision === "approve_new"
        ? ({ mode: "created_from_candidate", candidateId: candidate.candidateId } as const)
        : ({ mode: "existing_entity", entityId: candidate.existingEntityId! } as const);

    if (candidate.decision === "approve_new") {
      commands.push({
        kind: "create_entity",
        idempotencyKey: `onboarding:${candidateKey}:entity:create`,
        candidateId: candidate.candidateId,
        assetType: candidate.assetType,
        identityFingerprint: candidate.identityFingerprint,
      });
    } else {
      commands.push({
        kind: "link_existing_entity",
        idempotencyKey: `onboarding:${candidateKey}:entity:link:${keyPart(candidate.existingEntityId!)}`,
        candidateId: candidate.candidateId,
        existingEntityId: candidate.existingEntityId!,
      });
    }

    for (const specification of [...candidate.specifications].sort((a, b) =>
      a.fieldPath.localeCompare(b.fieldPath),
    )) {
      commands.push({
        kind: "upsert_mandate_specification",
        idempotencyKey: `onboarding:${candidateKey}:specification:${keyPart(specification.fieldPath)}`,
        candidateId: candidate.candidateId,
        entityReference,
        fieldPath: specification.fieldPath,
        currentValue: specification.currentValue,
        mandatedValue: specification.mandatedValue,
      });
    }
  }

  return {
    ready: true,
    commands,
    blockers: [],
    skippedCandidateIds,
  };
}
