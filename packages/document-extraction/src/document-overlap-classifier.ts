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

export interface OverlapCandidate {
  contentDigest: string;
  assetType?: "property" | "vehicle" | null;
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
  assetType: "property" | "vehicle";
  canonicalFingerprint: string | null;
  provisionalFingerprint: string | null;
}

export interface ExistingPolicy {
  id: string;
  assetId: string;
  assetType?: "property" | "vehicle";
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  annualPremiumCents?: number | null;
  coverageFacts?: Record<string, unknown>;
}

export interface CompletedNormalization {
  contentDigest: string;
  normalizedEntityKey: string;
  assetId?: string;
  assetType?: "property" | "vehicle";
}

export interface ClassifyDocumentOverlapInput {
  candidate: OverlapCandidate;
  existingAssets?: ExistingAsset[];
  existingPolicies?: ExistingPolicy[];
  priorCompletedNormalizations?: CompletedNormalization[];
}

export interface OverlapResult {
  classification: OverlapClassification;
  confidence: number;
  assetId?: string;
  assetType?: "property" | "vehicle";
  existingPolicyId?: string;
  normalizedEntityKey: string;
  reasons: string[];
  comparedFields: Record<string, unknown>;
  requiresCustomerReview: boolean;
}

const SUPPORTING_DOCUMENT_TYPES = new Set([
  "active_endorsement",
  "endorsement",
  "invoice",
  "renewal_overview",
  "notice",
  "informational_notice",
]);

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

function parseIsoDate(input: string | null | undefined): string | null {
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

function valuesConflict(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return false;
  if (typeof left === "number" && typeof right === "number") return left !== right;
  if (typeof left === "number" && typeof right === "string") {
    const parsed = Number(right);
    if (!Number.isNaN(parsed)) return left !== parsed;
  }
  if (typeof left === "string" && typeof right === "number") {
    const parsed = Number(left);
    if (!Number.isNaN(parsed)) return parsed !== right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return normalizeText(left) !== normalizeText(right);
  }
  return false;
}

function materialConflict(
  candidateFacts: Record<string, unknown>,
  existingFacts: Record<string, unknown> | undefined,
  existingAnnualPremium: number | null | undefined,
): { conflict: boolean; details: Record<string, unknown> } {
  const details: Record<string, unknown> = {};
  for (const key of Object.keys(candidateFacts)) {
    let existingValue: unknown = existingFacts?.[key];
    if (key === "annual_premium_cents" && existingValue === undefined) {
      existingValue = existingAnnualPremium;
    }
    if (existingValue === undefined || existingValue === null) continue;
    const candidateValue = candidateFacts[key];
    if (candidateValue === undefined || candidateValue === null) continue;
    if (valuesConflict(candidateValue, existingValue)) {
      details[key] = { candidate: candidateValue, existing: existingValue };
    }
  }
  return { conflict: Object.keys(details).length > 0, details };
}

function findAssetByKey(
  assets: ExistingAsset[],
  key: string,
): ExistingAsset | undefined {
  if (!key) return undefined;
  for (const asset of assets) {
    if (asset.canonicalFingerprint && key === `${asset.assetType}:${asset.canonicalFingerprint}`) {
      return asset;
    }
    if (
      asset.provisionalFingerprint &&
      key === `${asset.assetType}:provisional:${asset.provisionalFingerprint}`
    ) {
      return asset;
    }
  }
  return undefined;
}

function buildEntityKey(candidate: OverlapCandidate): string {
  if (candidate.assetType && candidate.canonicalFingerprint) {
    return `${candidate.assetType}:${candidate.canonicalFingerprint}`;
  }
  if (candidate.assetType && candidate.provisionalFingerprint) {
    return `${candidate.assetType}:provisional:${candidate.provisionalFingerprint}`;
  }
  return `unknown:${candidate.contentDigest}`;
}

function policyIdentityComparedFields(
  candidateInsurer: string | null,
  candidatePolicyNumber: string | null,
  candidateEffective: string | null,
  candidateExpiry: string | null,
  policy: ExistingPolicy,
): Record<string, unknown> {
  return {
    candidateInsurer,
    candidatePolicyNumber,
    candidateEffectiveDate: candidateEffective,
    candidateExpiryDate: candidateExpiry,
    existingInsurer: normalizeText(policy.insurerName),
    existingPolicyNumber: normalizePolicyNumber(policy.policyNumber),
    existingEffectiveDate: parseIsoDate(policy.effectiveDate),
    existingExpiryDate: parseIsoDate(policy.expiryDate),
  };
}

export function classifyDocumentOverlap(input: ClassifyDocumentOverlapInput): OverlapResult {
  const candidate = input.candidate;
  const existingAssets = input.existingAssets ?? [];
  const existingPolicies = input.existingPolicies ?? [];
  const priorNormalizations = input.priorCompletedNormalizations ?? [];

  const prior = priorNormalizations.find((n) => n.contentDigest === candidate.contentDigest);
  if (prior) {
    const matchedAsset = findAssetByKey(existingAssets, prior.normalizedEntityKey);
    return {
      classification: "exact_file_duplicate",
      confidence: 1,
      assetId: prior.assetId ?? matchedAsset?.id,
      assetType: prior.assetType ?? matchedAsset?.assetType,
      normalizedEntityKey: prior.normalizedEntityKey,
      reasons: ["content_digest matches prior normalization"],
      comparedFields: { contentDigest: candidate.contentDigest },
      requiresCustomerReview: false,
    };
  }

  const candidateInsurer = normalizeText(candidate.insurer);
  const candidatePolicyNumber = normalizePolicyNumber(candidate.policyNumber);
  const candidateEffective = parseIsoDate(candidate.effectiveDate);
  const candidateExpiry = parseIsoDate(candidate.expiryDate);

  let exactAsset: ExistingAsset | undefined;
  let provisionalAsset: ExistingAsset | undefined;

  for (const asset of existingAssets) {
    if (
      asset.canonicalFingerprint &&
      candidate.canonicalFingerprint &&
      asset.canonicalFingerprint === candidate.canonicalFingerprint &&
      (!candidate.assetType || candidate.assetType === asset.assetType)
    ) {
      exactAsset = asset;
      break;
    }
  }

  if (!exactAsset) {
    for (const asset of existingAssets) {
      if (
        asset.provisionalFingerprint &&
        candidate.provisionalFingerprint &&
        asset.provisionalFingerprint === candidate.provisionalFingerprint &&
        (!candidate.assetType || candidate.assetType === asset.assetType)
      ) {
        provisionalAsset = asset;
        break;
      }
    }
  }

  const baseKey = exactAsset
    ? `${exactAsset.assetType}:${exactAsset.canonicalFingerprint}`
    : buildEntityKey(candidate);

  if (exactAsset) {
    const assetPolicies = existingPolicies.filter((p) => p.assetId === exactAsset.id);

    for (const policy of assetPolicies) {
      const policyInsurer = normalizeText(policy.insurerName);
      const policyNumber = normalizePolicyNumber(policy.policyNumber);
      const policyEffective = parseIsoDate(policy.effectiveDate);
      const policyExpiry = parseIsoDate(policy.expiryDate);

      const insurerMatch = Boolean(
        candidateInsurer && policyInsurer && candidateInsurer === policyInsurer,
      );
      const policyNumberMatch = Boolean(
        candidatePolicyNumber && policyNumber && candidatePolicyNumber === policyNumber,
      );
      const effectiveMatch = Boolean(
        candidateEffective && policyEffective && candidateEffective === policyEffective,
      );
      const expiryMatch = Boolean(
        candidateExpiry && policyExpiry && candidateExpiry === policyExpiry,
      );
      const termMatch = insurerMatch && policyNumberMatch && effectiveMatch && expiryMatch;
      const identityMatch = insurerMatch && policyNumberMatch;
      const datesPresent = candidateEffective && policyEffective && candidateExpiry && policyExpiry;

      const conflict = materialConflict(
        candidate.coverageFacts ?? {},
        policy.coverageFacts,
        policy.annualPremiumCents,
      );

      if (conflict.conflict && (termMatch || identityMatch)) {
        return {
          classification: "same_asset_conflicting_information",
          confidence: 0.8,
          assetId: exactAsset.id,
          assetType: exactAsset.assetType,
          existingPolicyId: policy.id,
          normalizedEntityKey: baseKey,
          reasons: ["same asset and policy identity with materially different coverage or premium facts"],
          comparedFields: {
            ...policyIdentityComparedFields(
              candidateInsurer,
              candidatePolicyNumber,
              candidateEffective,
              candidateExpiry,
              policy,
            ),
            conflicts: conflict.details,
          },
          requiresCustomerReview: true,
        };
      }

      if (termMatch) {
        if (SUPPORTING_DOCUMENT_TYPES.has(candidate.documentType)) {
          return {
            classification: "same_asset_supporting_document",
            confidence: 0.85,
            assetId: exactAsset.id,
            assetType: exactAsset.assetType,
            existingPolicyId: policy.id,
            normalizedEntityKey: baseKey,
            reasons: [
              "same asset, policy term, and distinct supporting document type adds evidence",
            ],
            comparedFields: policyIdentityComparedFields(
              candidateInsurer,
              candidatePolicyNumber,
              candidateEffective,
              candidateExpiry,
              policy,
            ),
            requiresCustomerReview: false,
          };
        }

        return {
          classification: "same_asset_same_policy_term",
          confidence: 0.95,
          assetId: exactAsset.id,
          assetType: exactAsset.assetType,
          existingPolicyId: policy.id,
          normalizedEntityKey: baseKey,
          reasons: ["same canonical asset and materially equivalent policy term"],
          comparedFields: policyIdentityComparedFields(
            candidateInsurer,
            candidatePolicyNumber,
            candidateEffective,
            candidateExpiry,
            policy,
          ),
          requiresCustomerReview: false,
        };
      }

      if (identityMatch) {
        if (datesPresent) {
          const laterEffective = candidateEffective > policyEffective;
          const laterExpiry = candidateExpiry > policyExpiry;
          if (laterEffective || laterExpiry) {
            return {
              classification: "same_asset_newer_policy_term",
              confidence: 0.9,
              assetId: exactAsset.id,
              assetType: exactAsset.assetType,
              existingPolicyId: policy.id,
              normalizedEntityKey: baseKey,
              reasons: ["same canonical asset with a later policy term or expiry date"],
              comparedFields: policyIdentityComparedFields(
                candidateInsurer,
                candidatePolicyNumber,
                candidateEffective,
                candidateExpiry,
                policy,
              ),
              requiresCustomerReview: false,
            };
          }

          return {
            classification: "same_asset_conflicting_information",
            confidence: 0.8,
            assetId: exactAsset.id,
            assetType: exactAsset.assetType,
            existingPolicyId: policy.id,
            normalizedEntityKey: baseKey,
            reasons: [
              "same asset and policy number but policy term dates differ from the existing policy",
            ],
            comparedFields: policyIdentityComparedFields(
              candidateInsurer,
              candidatePolicyNumber,
              candidateEffective,
              candidateExpiry,
              policy,
            ),
            requiresCustomerReview: true,
          };
        }

        return {
          classification: "same_asset_supporting_document",
          confidence: 0.85,
          assetId: exactAsset.id,
          assetType: exactAsset.assetType,
          existingPolicyId: policy.id,
          normalizedEntityKey: baseKey,
          reasons: [
            "same asset and policy number; term dates missing or invalid so treated as supporting evidence",
          ],
          comparedFields: policyIdentityComparedFields(
            candidateInsurer,
            candidatePolicyNumber,
            candidateEffective,
            candidateExpiry,
            policy,
          ),
          requiresCustomerReview: false,
        };
      }

      if (policyNumberMatch && !insurerMatch) {
        return {
          classification: "same_asset_conflicting_information",
          confidence: 0.8,
          assetId: exactAsset.id,
          assetType: exactAsset.assetType,
          existingPolicyId: policy.id,
          normalizedEntityKey: baseKey,
          reasons: ["same asset and policy number but insurer differs"],
          comparedFields: policyIdentityComparedFields(
            candidateInsurer,
            candidatePolicyNumber,
            candidateEffective,
            candidateExpiry,
            policy,
          ),
          requiresCustomerReview: true,
        };
      }
    }
  }

  if (provisionalAsset) {
    const assetPolicies = existingPolicies.filter((p) => p.assetId === provisionalAsset.id);
    let matchedPolicy: ExistingPolicy | undefined;
    if (candidatePolicyNumber) {
      matchedPolicy = assetPolicies.find(
        (p) => normalizePolicyNumber(p.policyNumber) === candidatePolicyNumber,
      );
    }
    const key = `${provisionalAsset.assetType}:provisional:${candidate.provisionalFingerprint}`;
    return {
      classification: "possible_asset_match",
      confidence: 0.5,
      assetId: provisionalAsset.id,
      assetType: provisionalAsset.assetType,
      existingPolicyId: matchedPolicy?.id,
      normalizedEntityKey: key,
      reasons: ["only a provisional or partial identity match is available"],
      comparedFields: {
        candidateProvisionalFingerprint: candidate.provisionalFingerprint,
        existingProvisionalFingerprint: provisionalAsset.provisionalFingerprint,
      },
      requiresCustomerReview: true,
    };
  }

  if (candidatePolicyNumber) {
    const matchedPolicy = existingPolicies.find(
      (p) => normalizePolicyNumber(p.policyNumber) === candidatePolicyNumber,
    );
    if (matchedPolicy) {
      return {
        classification: "possible_asset_match",
        confidence: 0.5,
        assetType: candidate.assetType ?? matchedPolicy.assetType,
        existingPolicyId: matchedPolicy.id,
        normalizedEntityKey: baseKey,
        reasons: ["policy number matches an existing policy on a different asset"],
        comparedFields: {
          candidatePolicyNumber,
          existingPolicyId: matchedPolicy.id,
        },
        requiresCustomerReview: true,
      };
    }
  }

  return {
    classification: "new_asset",
    confidence: 0.95,
    assetType: candidate.assetType ?? undefined,
    normalizedEntityKey: baseKey,
    reasons: ["no credible canonical or provisional asset match"],
    comparedFields: {
      candidateCanonicalFingerprint: candidate.canonicalFingerprint,
      candidateProvisionalFingerprint: candidate.provisionalFingerprint,
    },
    requiresCustomerReview: false,
  };
}
