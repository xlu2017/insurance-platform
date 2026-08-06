export const OVERLAP_CLASSIFICATIONS = [
  "exact_file_duplicate",
  "same_asset_same_policy_term",
  "same_asset_newer_policy_term",
  "same_asset_supporting_document",
  "same_asset_conflicting_information",
  "possible_asset_match",
  "new_asset",
] as const;
export type OverlapClassification = (typeof OVERLAP_CLASSIFICATIONS)[number];

export const OVERLAP_DISPOSITIONS = [
  "reuse_existing_normalization",
  "attach_supporting_evidence",
  "create_renewal_candidate",
  "create_conflict_review",
  "require_asset_match_confirmation",
  "create_new_asset_candidate",
] as const;
export type OverlapDisposition = (typeof OVERLAP_DISPOSITIONS)[number];

export type AssetType = "property" | "vehicle";

export type NormalizedFact =
  | { status: "known"; value: string | number | boolean }
  | { status: "unknown"; value: null }
  | { status: "not_included"; value: null }
  | { status: "not_applicable"; value: null }
  | { status: "conflicting"; value: unknown };

export interface CompatibleNormalization {
  normalizationId: string;
  contentDigest: string;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
  status: "complete" | string;
}

export interface OverlapCandidate {
  contentDigest: string;
  normalizationSchemaVersion?: string | null;
  analyzerVersion?: string | null;
  assetType?: AssetType | null;
  canonicalFingerprint?: string | null;
  provisionalFingerprint?: string | null;
  insurer?: string | null;
  policyNumber?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  documentType: string;
  coverageFacts?: Record<string, unknown>;
}

export interface ExistingAsset {
  id: string;
  assetType: AssetType;
  canonicalFingerprint: string | null;
  provisionalFingerprint: string | null;
}

export interface ExistingPolicy {
  id: string;
  assetId: string;
  assetType?: AssetType;
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  isCurrent?: boolean;
  annualPremiumCents?: number | null;
  coverageFacts?: Record<string, unknown>;
}

export interface ClassifyDocumentOverlapInput {
  candidate: OverlapCandidate;
  existingAssets?: ExistingAsset[];
  existingPolicies?: ExistingPolicy[];
  /** The reuse engine has already selected a compatible prior normalization. */
  compatibleNormalizationAlreadySelected?: boolean;
  /** Optional reference to the selected compatible normalization for the classifier to verify. */
  compatibleNormalization?: CompatibleNormalization;
}

export interface OverlapResult {
  classification: OverlapClassification;
  disposition: OverlapDisposition;
  confidence: number;
  assetId?: string;
  assetType?: AssetType;
  existingPolicyId?: string;
  normalizedEntityKey: string;
  reasons: string[];
  comparedFields: Record<string, unknown>;
  requiresCustomerDecision: boolean;
}

// Canonical document authority / classification values that are explicitly
// supporting evidence and do not replace authoritative policy facts.
const SUPPORTING_DOCUMENT_TYPES = new Set([
  "active_endorsement",
  "endorsement",
  "invoice",
  "notice",
  "informational_notice",
  "proof_of_insurance",
  "signed_authorization",
  "cancellation_confirmation",
]);

export function isSupportingDocumentType(documentType: string | null | undefined): boolean {
  return Boolean(documentType && SUPPORTING_DOCUMENT_TYPES.has(documentType));
}

function normalizeText(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function normalizePolicyNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

export function parseIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return input;
}

export function toNormalizedFact(value: unknown): NormalizedFact {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const status = obj.status;
    if (
      status === "known" ||
      status === "unknown" ||
      status === "not_included" ||
      status === "not_applicable" ||
      status === "conflicting"
    ) {
      const rawValue = obj.value;
      if (status === "known") {
        if (
          typeof rawValue === "string" ||
          typeof rawValue === "number" ||
          typeof rawValue === "boolean"
        ) {
          return { status: "known", value: rawValue };
        }
        return { status: "known", value: String(rawValue) };
      }
      return { status, value: null } as NormalizedFact;
    }
    if (obj.value !== undefined) {
      return toNormalizedFact(obj.value);
    }
  }
  if (value === null || value === undefined) {
    return { status: "unknown", value: null };
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return { status: "known", value };
  }
  return { status: "conflicting", value };
}

function factValueForCompare(fact: NormalizedFact): unknown {
  if (fact.status !== "known") return null;
  const value = fact.value;
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return value;
}

function factValuesAreEqual(left: NormalizedFact, right: NormalizedFact): boolean {
  if (left.status !== "known" || right.status !== "known") return false;
  const l = factValueForCompare(left);
  const r = factValueForCompare(right);
  if (typeof l === "number" && typeof r === "string") {
    const parsed = Number(r);
    if (!Number.isNaN(parsed)) return l === parsed;
  }
  if (typeof l === "string" && typeof r === "number") {
    const parsed = Number(l);
    if (!Number.isNaN(parsed)) return parsed === r;
  }
  return l === r;
}

function factsConflict(
  candidate: NormalizedFact,
  existing: NormalizedFact,
): { conflict: boolean; reason?: string } {
  if (candidate.status === "conflicting" || existing.status === "conflicting") {
    return { conflict: true, reason: "conflicting state requires review" };
  }
  if (candidate.status === "known" && existing.status === "known") {
    return factValuesAreEqual(candidate, existing)
      ? { conflict: false }
      : { conflict: true, reason: "known values differ" };
  }
  if (
    (candidate.status === "known" && existing.status === "not_included") ||
    (candidate.status === "not_included" && existing.status === "known")
  ) {
    return { conflict: true, reason: "known versus not_included" };
  }
  // known versus unknown/not_applicable is unresolved, not a material conflict.
  return { conflict: false };
}

function canonicalCoverageKey(key: string): string {
  if (key.includes(".")) return key;
  // Support the single legacy snake-case key used for premium without requiring
  // callers to hand-rewrite all historical facts.
  if (key === "annual_premium_cents") return "policy.annualPremiumCents";
  return key;
}

function buildExistingFacts(policy: ExistingPolicy): Map<string, NormalizedFact> {
  const facts = new Map<string, NormalizedFact>();
  for (const [key, value] of Object.entries(policy.coverageFacts ?? {})) {
    facts.set(canonicalCoverageKey(key), toNormalizedFact(value));
  }
  if (policy.annualPremiumCents != null) {
    facts.set("policy.annualPremiumCents", {
      status: "known",
      value: policy.annualPremiumCents,
    });
  }
  return facts;
}

function buildCandidateFacts(candidate: OverlapCandidate): Map<string, NormalizedFact> {
  const facts = new Map<string, NormalizedFact>();
  for (const [key, value] of Object.entries(candidate.coverageFacts ?? {})) {
    facts.set(canonicalCoverageKey(key), toNormalizedFact(value));
  }
  return facts;
}

interface MaterialConflictResult {
  conflict: boolean;
  details: Record<string, unknown>;
  facts: Record<string, { candidate: NormalizedFact; existing: NormalizedFact }>;
}

function materialConflict(
  candidate: OverlapCandidate,
  policy: ExistingPolicy,
): MaterialConflictResult {
  const candidateFacts = buildCandidateFacts(candidate);
  const existingFacts = buildExistingFacts(policy);
  const details: Record<string, unknown> = {};
  const facts: Record<string, { candidate: NormalizedFact; existing: NormalizedFact }> = {};

  for (const key of new Set([...candidateFacts.keys(), ...existingFacts.keys()])) {
    const candidateFact = candidateFacts.get(key) ?? { status: "unknown", value: null };
    const existingFact = existingFacts.get(key) ?? { status: "unknown", value: null };
    const result = factsConflict(candidateFact, existingFact);
    facts[key] = { candidate: candidateFact, existing: existingFact };
    if (result.conflict) {
      details[key] = {
        candidate: candidateFact,
        existing: existingFact,
        reason: result.reason,
      };
    }
  }

  return { conflict: Object.keys(details).length > 0, details, facts };
}

function findAssetByKey(
  assets: ExistingAsset[],
  candidate: OverlapCandidate,
): ExistingAsset | undefined {
  for (const asset of assets) {
    if (candidate.assetType && candidate.assetType !== asset.assetType) continue;
    if (
      candidate.canonicalFingerprint &&
      asset.canonicalFingerprint &&
      candidate.canonicalFingerprint === asset.canonicalFingerprint
    ) {
      return asset;
    }
  }
  for (const asset of assets) {
    if (candidate.assetType && candidate.assetType !== asset.assetType) continue;
    if (
      candidate.provisionalFingerprint &&
      asset.provisionalFingerprint &&
      candidate.provisionalFingerprint === asset.provisionalFingerprint
    ) {
      return asset;
    }
  }
  return undefined;
}

function buildEntityKey(candidate: OverlapCandidate): string {
  if (candidate.canonicalFingerprint) return candidate.canonicalFingerprint;
  if (candidate.provisionalFingerprint) return candidate.provisionalFingerprint;
  return `unknown:${candidate.contentDigest}`;
}

function isValidTerm(candidate: OverlapCandidate): boolean {
  const effective = parseIsoDate(candidate.effectiveDate);
  const expiry = parseIsoDate(candidate.expiryDate);
  return Boolean(effective && expiry && expiry > effective);
}

function policyIdentityMatch(
  candidate: OverlapCandidate,
  policy: ExistingPolicy,
): { insurerMatch: boolean; policyNumberMatch: boolean; identityMatch: boolean } {
  const candidateInsurer = normalizeText(candidate.insurer);
  const policyInsurer = normalizeText(policy.insurerName);
  const candidateNumber = normalizePolicyNumber(candidate.policyNumber);
  const policyNumber = normalizePolicyNumber(policy.policyNumber);
  const insurerMatch = Boolean(
    candidateInsurer && policyInsurer && candidateInsurer === policyInsurer,
  );
  const policyNumberMatch = Boolean(
    candidateNumber && policyNumber && candidateNumber === policyNumber,
  );
  return {
    insurerMatch,
    policyNumberMatch,
    identityMatch: insurerMatch && policyNumberMatch,
  };
}

function policyTermMatch(
  candidate: OverlapCandidate,
  policy: ExistingPolicy,
): { termMatch: boolean; effectiveMatch: boolean; expiryMatch: boolean } {
  const { identityMatch } = policyIdentityMatch(candidate, policy);
  const candidateEffective = parseIsoDate(candidate.effectiveDate);
  const candidateExpiry = parseIsoDate(candidate.expiryDate);
  const policyEffective = parseIsoDate(policy.effectiveDate);
  const policyExpiry = parseIsoDate(policy.expiryDate);
  const effectiveMatch = Boolean(
    candidateEffective && policyEffective && candidateEffective === policyEffective,
  );
  const expiryMatch = Boolean(candidateExpiry && policyExpiry && candidateExpiry === policyExpiry);
  return {
    termMatch: identityMatch && effectiveMatch && expiryMatch,
    effectiveMatch,
    expiryMatch,
  };
}

function isLaterValidTerm(candidate: OverlapCandidate, policy: ExistingPolicy): boolean {
  if (!isValidTerm(candidate)) return false;
  const candidateEffective = parseIsoDate(candidate.effectiveDate)!;
  const candidateExpiry = parseIsoDate(candidate.expiryDate)!;
  const policyEffective = parseIsoDate(policy.effectiveDate);
  const policyExpiry = parseIsoDate(policy.expiryDate);
  if (!policyEffective || !policyExpiry) return true;
  return candidateExpiry > policyExpiry || candidateEffective > policyEffective;
}

function selectBestPolicy(
  candidate: OverlapCandidate,
  policies: ExistingPolicy[],
): ExistingPolicy | undefined {
  return policies
    .slice()
    .sort((a, b) => {
      const aTerm = policyTermMatch(candidate, a).termMatch;
      const bTerm = policyTermMatch(candidate, b).termMatch;
      const aCurrent = a.isCurrent === true;
      const bCurrent = b.isCurrent === true;

      // 1. exact current policy term; 2. other exact term; 3. current policy; 4. latest historical policy.
      if (aTerm && aCurrent && !(bTerm && bCurrent)) return -1;
      if (bTerm && bCurrent && !(aTerm && aCurrent)) return 1;
      if (aTerm && !bTerm) return -1;
      if (bTerm && !aTerm) return 1;
      if (aCurrent && !bCurrent) return -1;
      if (bCurrent && !aCurrent) return 1;

      const aExpiry = parseIsoDate(a.expiryDate) ?? "0000-01-01";
      const bExpiry = parseIsoDate(b.expiryDate) ?? "0000-01-01";
      if (aExpiry > bExpiry) return -1;
      if (aExpiry < bExpiry) return 1;

      const aEffective = parseIsoDate(a.effectiveDate) ?? "0000-01-01";
      const bEffective = parseIsoDate(b.effectiveDate) ?? "0000-01-01";
      if (aEffective > bEffective) return -1;
      if (aEffective < bEffective) return 1;

      return a.id.localeCompare(b.id);
    })
    .shift();
}

function policyIdentityComparedFields(
  candidate: OverlapCandidate,
  policy: ExistingPolicy,
): Record<string, unknown> {
  return {
    candidateInsurer: normalizeText(candidate.insurer),
    candidatePolicyNumber: normalizePolicyNumber(candidate.policyNumber),
    candidateEffectiveDate: parseIsoDate(candidate.effectiveDate),
    candidateExpiryDate: parseIsoDate(candidate.expiryDate),
    existingInsurer: normalizeText(policy.insurerName),
    existingPolicyNumber: normalizePolicyNumber(policy.policyNumber),
    existingEffectiveDate: parseIsoDate(policy.effectiveDate),
    existingExpiryDate: parseIsoDate(policy.expiryDate),
    existingIsCurrent: policy.isCurrent,
  };
}

function classificationDisposition(classification: OverlapClassification): OverlapDisposition {
  switch (classification) {
    case "exact_file_duplicate":
      return "reuse_existing_normalization";
    case "same_asset_same_policy_term":
    case "same_asset_supporting_document":
      return "attach_supporting_evidence";
    case "same_asset_newer_policy_term":
      return "create_renewal_candidate";
    case "same_asset_conflicting_information":
      return "create_conflict_review";
    case "possible_asset_match":
      return "require_asset_match_confirmation";
    case "new_asset":
      return "create_new_asset_candidate";
  }
}

function resultFor(
  classification: OverlapClassification,
  confidence: number,
  opts: {
    assetId?: string;
    assetType?: AssetType;
    existingPolicyId?: string;
    normalizedEntityKey: string;
    reasons: string[];
    comparedFields: Record<string, unknown>;
    requiresCustomerDecision?: boolean;
  },
): OverlapResult {
  return {
    classification,
    disposition: classificationDisposition(classification),
    confidence,
    assetId: opts.assetId,
    assetType: opts.assetType,
    existingPolicyId: opts.existingPolicyId,
    normalizedEntityKey: opts.normalizedEntityKey,
    reasons: opts.reasons,
    comparedFields: opts.comparedFields,
    requiresCustomerDecision: opts.requiresCustomerDecision ?? false,
  };
}

function exactFileDuplicateResult(
  input: ClassifyDocumentOverlapInput,
  normalizedEntityKey: string,
): OverlapResult {
  const { candidate, existingAssets, compatibleNormalization } = input;
  const matchedAsset = findAssetByKey(existingAssets ?? [], candidate);
  const normalizationId = compatibleNormalization?.normalizationId;
  return resultFor("exact_file_duplicate", 1, {
    assetId: matchedAsset?.id,
    assetType: matchedAsset?.assetType ?? candidate.assetType ?? undefined,
    normalizedEntityKey,
    reasons: [
      "content digest, normalization schema version, and analyzer version match a complete prior normalization",
    ],
    comparedFields: {
      contentDigest: candidate.contentDigest,
      normalizationId,
      normalizationSchemaVersion: compatibleNormalization?.normalizationSchemaVersion,
      analyzerVersion: compatibleNormalization?.analyzerVersion,
      status: compatibleNormalization?.status,
    },
  });
}

function compatibleNormalizationSelected(input: ClassifyDocumentOverlapInput): boolean {
  if (input.compatibleNormalizationAlreadySelected) return true;
  const cn = input.compatibleNormalization;
  if (!cn) return false;
  if (cn.status !== "complete") return false;
  if (cn.contentDigest !== input.candidate.contentDigest) return false;
  if (
    input.candidate.normalizationSchemaVersion != null &&
    cn.normalizationSchemaVersion !== input.candidate.normalizationSchemaVersion
  ) {
    return false;
  }
  if (
    input.candidate.analyzerVersion != null &&
    cn.analyzerVersion !== input.candidate.analyzerVersion
  ) {
    return false;
  }
  return true;
}

function classifyExactAsset(
  input: ClassifyDocumentOverlapInput,
  asset: ExistingAsset,
): OverlapResult {
  const { candidate } = input;
  const normalizedEntityKey = asset.canonicalFingerprint ?? buildEntityKey(candidate);
  const assetPolicies = (input.existingPolicies ?? []).filter((p) => p.assetId === asset.id);

  if (assetPolicies.length === 0) {
    if (isSupportingDocumentType(candidate.documentType)) {
      return resultFor("same_asset_supporting_document", 0.85, {
        assetId: asset.id,
        assetType: asset.assetType,
        normalizedEntityKey,
        reasons: ["exact canonical asset match with supporting document type and no prior policy"],
        comparedFields: { assetId: asset.id, documentType: candidate.documentType },
      });
    }
    if (isValidTerm(candidate)) {
      return resultFor("same_asset_newer_policy_term", 0.9, {
        assetId: asset.id,
        assetType: asset.assetType,
        normalizedEntityKey,
        reasons: ["exact canonical asset match with a valid later policy term and no prior policy"],
        comparedFields: {
          candidateEffectiveDate: parseIsoDate(candidate.effectiveDate),
          candidateExpiryDate: parseIsoDate(candidate.expiryDate),
        },
      });
    }
    return resultFor("same_asset_conflicting_information", 0.8, {
      assetId: asset.id,
      assetType: asset.assetType,
      normalizedEntityKey,
      reasons: [
        "exact canonical asset match but principal policy document has missing or invalid term dates",
      ],
      comparedFields: {
        candidateEffectiveDate: parseIsoDate(candidate.effectiveDate),
        candidateExpiryDate: parseIsoDate(candidate.expiryDate),
      },
      requiresCustomerDecision: true,
    });
  }

  const bestPolicy = selectBestPolicy(candidate, assetPolicies);
  if (!bestPolicy) {
    return resultFor("same_asset_conflicting_information", 0.8, {
      assetId: asset.id,
      assetType: asset.assetType,
      normalizedEntityKey,
      reasons: ["exact canonical asset match but no usable existing policy could be selected"],
      comparedFields: {},
      requiresCustomerDecision: true,
    });
  }

  const { termMatch, effectiveMatch, expiryMatch } = policyTermMatch(candidate, bestPolicy);
  const { identityMatch, insurerMatch, policyNumberMatch } = policyIdentityMatch(
    candidate,
    bestPolicy,
  );
  const conflict = materialConflict(candidate, bestPolicy);

  if (termMatch) {
    if (conflict.conflict) {
      return resultFor("same_asset_conflicting_information", 0.8, {
        assetId: asset.id,
        assetType: asset.assetType,
        existingPolicyId: bestPolicy.id,
        normalizedEntityKey,
        reasons: ["same asset and policy term with materially different coverage or premium facts"],
        comparedFields: {
          ...policyIdentityComparedFields(candidate, bestPolicy),
          conflicts: conflict.details,
          facts: conflict.facts,
        },
        requiresCustomerDecision: true,
      });
    }

    if (isSupportingDocumentType(candidate.documentType)) {
      return resultFor("same_asset_supporting_document", 0.85, {
        assetId: asset.id,
        assetType: asset.assetType,
        existingPolicyId: bestPolicy.id,
        normalizedEntityKey,
        reasons: ["same asset, policy term, and distinct supporting document type adds evidence"],
        comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
      });
    }

    return resultFor("same_asset_same_policy_term", 0.95, {
      assetId: asset.id,
      assetType: asset.assetType,
      existingPolicyId: bestPolicy.id,
      normalizedEntityKey,
      reasons: ["same canonical asset and materially equivalent policy term"],
      comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
    });
  }

  if (identityMatch) {
    if (isLaterValidTerm(candidate, bestPolicy)) {
      return resultFor("same_asset_newer_policy_term", 0.9, {
        assetId: asset.id,
        assetType: asset.assetType,
        existingPolicyId: bestPolicy.id,
        normalizedEntityKey,
        reasons: ["same canonical asset with a later policy term or expiry date"],
        comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
      });
    }

    if (isSupportingDocumentType(candidate.documentType)) {
      return resultFor("same_asset_supporting_document", 0.85, {
        assetId: asset.id,
        assetType: asset.assetType,
        existingPolicyId: bestPolicy.id,
        normalizedEntityKey,
        reasons: ["same asset and policy identity with supporting document type"],
        comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
      });
    }

    if (effectiveMatch || expiryMatch) {
      return resultFor("same_asset_conflicting_information", 0.8, {
        assetId: asset.id,
        assetType: asset.assetType,
        existingPolicyId: bestPolicy.id,
        normalizedEntityKey,
        reasons: ["same asset and policy identity but term dates differ from the existing policy"],
        comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
        requiresCustomerDecision: true,
      });
    }

    return resultFor("same_asset_conflicting_information", 0.8, {
      assetId: asset.id,
      assetType: asset.assetType,
      existingPolicyId: bestPolicy.id,
      normalizedEntityKey,
      reasons: ["same asset and policy identity but term dates are missing or invalid"],
      comparedFields: policyIdentityComparedFields(candidate, bestPolicy),
      requiresCustomerDecision: true,
    });
  }

  // Exact asset, but no matching policy identity.
  if (isSupportingDocumentType(candidate.documentType)) {
    return resultFor("same_asset_supporting_document", 0.85, {
      assetId: asset.id,
      assetType: asset.assetType,
      normalizedEntityKey,
      reasons: ["same canonical asset with supporting document type; no matching policy term"],
      comparedFields: {
        ...policyIdentityComparedFields(candidate, bestPolicy),
        insurerMatch,
        policyNumberMatch,
      },
    });
  }

  return resultFor("same_asset_conflicting_information", 0.8, {
    assetId: asset.id,
    assetType: asset.assetType,
    existingPolicyId: bestPolicy.id,
    normalizedEntityKey,
    reasons: ["same canonical asset but policy identity is inconsistent with the existing policy"],
    comparedFields: {
      ...policyIdentityComparedFields(candidate, bestPolicy),
      insurerMatch,
      policyNumberMatch,
    },
    requiresCustomerDecision: true,
  });
}

export function classifyDocumentOverlap(input: ClassifyDocumentOverlapInput): OverlapResult {
  const { candidate, existingAssets, existingPolicies } = input;

  if (compatibleNormalizationSelected(input)) {
    return exactFileDuplicateResult(input, buildEntityKey(candidate));
  }

  const exactAsset = findAssetByKey(existingAssets ?? [], candidate);
  if (exactAsset?.canonicalFingerprint) {
    return classifyExactAsset(input, exactAsset);
  }

  const provisionalAsset = findAssetByKey(
    (existingAssets ?? []).filter((a) => a.provisionalFingerprint),
    candidate,
  );
  if (provisionalAsset?.provisionalFingerprint && candidate.provisionalFingerprint) {
    const normalizedEntityKey = candidate.provisionalFingerprint;
    const assetPolicies = (existingPolicies ?? []).filter((p) => p.assetId === provisionalAsset.id);
    const matchedPolicy = candidate.policyNumber
      ? selectBestPolicy(candidate, assetPolicies)
      : undefined;
    return resultFor("possible_asset_match", 0.5, {
      assetId: provisionalAsset.id,
      assetType: provisionalAsset.assetType,
      existingPolicyId: matchedPolicy?.id,
      normalizedEntityKey,
      reasons: ["only a provisional or partial identity match is available"],
      comparedFields: {
        candidateProvisionalFingerprint: candidate.provisionalFingerprint,
        existingProvisionalFingerprint: provisionalAsset.provisionalFingerprint,
      },
      requiresCustomerDecision: true,
    });
  }

  if (candidate.policyNumber) {
    const candidateNumber = normalizePolicyNumber(candidate.policyNumber);
    const matchedPolicy = (existingPolicies ?? []).find((p) => {
      const policyNumber = normalizePolicyNumber(p.policyNumber);
      return Boolean(policyNumber && policyNumber === candidateNumber);
    });
    if (matchedPolicy) {
      return resultFor("possible_asset_match", 0.5, {
        assetType: candidate.assetType ?? matchedPolicy.assetType,
        existingPolicyId: matchedPolicy.id,
        normalizedEntityKey: buildEntityKey(candidate),
        reasons: ["policy number matches an existing policy on a different asset"],
        comparedFields: {
          candidatePolicyNumber: candidateNumber,
          existingPolicyId: matchedPolicy.id,
        },
        requiresCustomerDecision: true,
      });
    }
  }

  return resultFor("new_asset", 0.95, {
    assetType: candidate.assetType ?? undefined,
    normalizedEntityKey: buildEntityKey(candidate),
    reasons: ["no credible canonical or provisional asset match"],
    comparedFields: {
      candidateCanonicalFingerprint: candidate.canonicalFingerprint,
      candidateProvisionalFingerprint: candidate.provisionalFingerprint,
    },
  });
}

// Integration adapters proving the classifier contract maps to the persistence layer.

export type NormalizedEntityPayload = {
  temporaryId?: string;
  canonicalFingerprint?: string | null;
  candidateIdentity?: Record<string, unknown>;
  identity?: {
    vin?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    vehicleUse?: string | null;
    fullAddress?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    occupancy?: string | null;
  };
  currentPolicy?: {
    insurer?: string | null;
    policyNumber?: string | null;
    effectiveDate?: string | null;
    expiryDate?: string | null;
    annualPremiumCents?: number | null;
  };
  currentCoverage?: Record<string, unknown>;
  resolution?: Record<string, unknown>;
  mandateSuggestions?: Record<string, unknown>;
  evidence?: unknown[];
  draftDecision?: string | null;
  entityType?: "property" | "vehicle";
  documentCategory?: string;
};

export function adaptNormalizedEntityToOverlapCandidate(
  contentDigest: string,
  payload: NormalizedEntityPayload,
): OverlapCandidate {
  const currentPolicy = payload.currentPolicy ?? {};
  const coverage: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.currentCoverage ?? {})) {
    coverage[key] = value;
  }
  if (currentPolicy.annualPremiumCents != null && coverage["policy.annualPremiumCents"] == null) {
    coverage["policy.annualPremiumCents"] = {
      status: "known",
      value: currentPolicy.annualPremiumCents,
    };
  }

  return {
    contentDigest,
    assetType: payload.entityType ?? null,
    canonicalFingerprint: payload.canonicalFingerprint ?? null,
    provisionalFingerprint: null,
    insurer: currentPolicy.insurer ?? null,
    policyNumber: currentPolicy.policyNumber ?? null,
    effectiveDate: currentPolicy.effectiveDate ?? null,
    expiryDate: currentPolicy.expiryDate ?? null,
    documentType: payload.documentCategory ?? "other",
    coverageFacts: coverage,
  };
}

export type PolicyRow = {
  id: string;
  asset_id: string;
  asset_type: "property" | "vehicle";
  is_current: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  insurer_name: string;
  policy_number: string | null;
  annual_premium_cents: number | null;
  coverage_details?: Record<string, unknown> | null;
};

export function adaptPolicyRowToExistingPolicy(row: PolicyRow): ExistingPolicy {
  const coverageFacts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.coverage_details ?? {})) {
    coverageFacts[key] = value;
  }
  if (row.annual_premium_cents != null && coverageFacts["policy.annualPremiumCents"] == null) {
    coverageFacts["policy.annualPremiumCents"] = {
      status: "known",
      value: row.annual_premium_cents,
    };
  }

  return {
    id: row.id,
    assetId: row.asset_id,
    assetType: row.asset_type,
    insurerName: row.insurer_name,
    policyNumber: row.policy_number,
    effectiveDate: row.effective_from ?? null,
    expiryDate: row.effective_to ?? null,
    isCurrent: row.is_current,
    annualPremiumCents: row.annual_premium_cents,
    coverageFacts,
  };
}

export interface RecordDocumentAssetOverlapV1Args {
  p_batch_id: string;
  p_normalization_id: string;
  p_normalized_entity_key: string;
  p_asset_id: string | null;
  p_asset_type: AssetType | null;
  p_existing_policy_id: string | null;
  p_classification: OverlapClassification;
  p_confidence: number;
  p_details_json: Record<string, unknown>;
}

export function toRecordDocumentAssetOverlapArgs(
  result: OverlapResult,
  context: { batchId: string; normalizationId: string },
): RecordDocumentAssetOverlapV1Args {
  return {
    p_batch_id: context.batchId,
    p_normalization_id: context.normalizationId,
    p_normalized_entity_key: result.normalizedEntityKey,
    p_asset_id: result.assetId ?? null,
    p_asset_type: result.assetType ?? null,
    p_existing_policy_id: result.existingPolicyId ?? null,
    p_classification: result.classification,
    p_confidence: result.confidence,
    p_details_json: result.comparedFields,
  };
}
