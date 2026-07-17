import type {
  EntityResolutionResult,
  ExistingAssetIdentity,
  ParsedAssetAssertion,
  ParsedConflict,
  ParsedInsuranceDocument,
} from "./types.ts";

function candidatePostalCode(candidate: ParsedAssetAssertion): string | undefined {
  return candidate.assertions.find(
    (a) => a.fieldPath === "property.postalCode" && a.addressRole === "insured_location",
  )?.normalizedValue as string | undefined;
}

function candidateCityProvincePostal(candidate: ParsedAssetAssertion): string | undefined {
  const city = candidate.assertions.find(
    (a) => a.fieldPath === "property.city" && a.addressRole === "insured_location",
  )?.normalizedValue as string | undefined;
  const province = candidate.assertions.find(
    (a) => a.fieldPath === "property.province" && a.addressRole === "insured_location",
  )?.normalizedValue as string | undefined;
  const postal = candidatePostalCode(candidate);
  if (!city || !province || !postal) return undefined;
  return [city, province, postal].join(" ").toUpperCase().replace(/\s+/g, " ");
}

function isPostalOnlyFingerprint(candidate: ParsedAssetAssertion): boolean {
  const cpp = candidateCityProvincePostal(candidate);
  if (!cpp) return true;
  return candidate.identityFingerprint.toUpperCase().replace(/\s+/g, " ") === cpp;
}

function classifyPropertyCandidate(
  candidate: ParsedAssetAssertion,
  householdAssets: ExistingAssetIdentity[],
): ParsedAssetAssertion["matchClassification"] {
  if (candidate.matchClassification === "new_identity_confirmation_required") {
    return "new_identity_confirmation_required";
  }

  const postal = candidatePostalCode(candidate);
  const postalOnly = isPostalOnlyFingerprint(candidate);

  const exactHousehold = householdAssets.some(
    (a) => a.assetType === "property" && a.identityFingerprint === candidate.identityFingerprint,
  );
  if (!postalOnly && exactHousehold) return "exact_existing_match";

  if (postal) {
    const samePostal = householdAssets.some(
      (a) =>
        a.assetType === "property" &&
        a.identityFingerprint !== candidate.identityFingerprint &&
        a.identityFingerprint.toUpperCase().includes(postal.toUpperCase()),
    );
    if (samePostal) return "possible_existing_match";
  }

  return candidate.matchClassification ?? "new";
}

function classifyVehicleCandidate(
  candidate: ParsedAssetAssertion,
  householdAssets: ExistingAssetIdentity[],
): ParsedAssetAssertion["matchClassification"] {
  if (
    householdAssets.some(
      (a) => a.assetType === "vehicle" && a.identityFingerprint === candidate.identityFingerprint,
    )
  ) {
    return "exact_existing_match";
  }
  return candidate.matchClassification ?? "new";
}

export function resolveParsedDocuments({
  householdAssets = [],
  existingCandidates = [],
  parsedDocuments,
}: {
  householdAssets?: ExistingAssetIdentity[];
  existingCandidates?: ExistingAssetIdentity[];
  parsedDocuments: ParsedInsuranceDocument[];
}): EntityResolutionResult {
  const seenDigests = new Set<string>();
  const documents: ParsedInsuranceDocument[] = [];
  for (const d of parsedDocuments) {
    if (!d.fileDigest || seenDigests.has(d.fileDigest)) continue;
    seenDigests.add(d.fileDigest);
    documents.push(d);
  }

  const allExisting: ExistingAssetIdentity[] = [
    ...householdAssets,
    ...existingCandidates.map((c) => ({
      assetType: c.assetType,
      identityFingerprint: c.identityFingerprint,
    })),
  ];

  const conflicts: ParsedConflict[] = [];
  const candidatesByKey = new Map<string, ParsedAssetAssertion>();

  for (const doc of documents) {
    for (const asset of doc.assetAssertions) {
      const key = `${asset.assetType}:${asset.identityFingerprint}`;
      if (candidatesByKey.has(key)) continue;

      let matchClassification: ParsedAssetAssertion["matchClassification"] =
        asset.matchClassification === "new_identity_confirmation_required"
          ? "new_identity_confirmation_required"
          : undefined;

      if (asset.assetType === "property") {
        matchClassification = matchClassification ?? classifyPropertyCandidate(asset, allExisting);
      } else if (asset.assetType === "vehicle") {
        matchClassification = classifyVehicleCandidate(asset, allExisting);
      } else {
        matchClassification = matchClassification ?? asset.matchClassification ?? "new";
      }

      const resolved: ParsedAssetAssertion = { ...asset, matchClassification };
      candidatesByKey.set(key, resolved);
    }
    conflicts.push(...doc.conflicts);
  }

  const candidates = [...candidatesByKey.values()];
  return { candidates, documents, conflicts };
}
