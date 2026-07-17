import type { ExtractedPdf } from "./types.ts";
import {
  buildInsuranceExtractionSystemPrompt,
  type InsuranceLlmProvider,
  type LlmAssetCandidate,
  type LlmExtractionRequest,
  type LlmExtractionResult,
  parseLlmExtractionResult,
} from "./llm-contract.ts";

export interface LlmExtractionRunOptions {
  requestedModel?: string;
  /** Optional override used for both passes. Defaults to the contract's pass-specific prompts. */
  systemPrompt?: string;
  maxCoveragePasses?: number;
  selectCoveragePages?: (
    discovery: LlmExtractionResult,
    asset: LlmAssetCandidate,
    document: ExtractedPdf,
  ) => number[];
}

export interface LlmExtractionRun {
  discovery: LlmExtractionResult;
  coverageByAssetLocalId: ReadonlyMap<string, LlmExtractionResult>;
  skippedAssetLocalIds: readonly string[];
}

function allPageNumbers(document: ExtractedPdf): number[] {
  return document.pages.map((page) => page.pageNumber);
}

function defaultCoveragePages(
  discovery: LlmExtractionResult,
  asset: LlmAssetCandidate,
  document: ExtractedPdf,
): number[] {
  const identityAssertionIds = new Set(asset.identityAssertionIds);
  const relevant = new Set<number>();

  for (const assertion of discovery.assertions) {
    if (assertion.entityRef !== asset.localId && !identityAssertionIds.has(assertion.id)) {
      continue;
    }

    for (const evidence of assertion.evidence) {
      relevant.add(evidence.pageNumber);
    }
  }

  for (const term of discovery.policyTerms) {
    if (!term.insuredAssetRefs.includes(asset.localId)) {
      continue;
    }

    const referencedAssertionIds = new Set(
      [
        term.policyNumberAssertionId,
        term.insurerAssertionId,
        term.effectiveDateAssertionId,
        term.expiryDateAssertionId,
        term.premiumAssertionId,
      ].filter((value): value is string => value !== undefined),
    );

    for (const assertion of discovery.assertions) {
      if (!referencedAssertionIds.has(assertion.id)) {
        continue;
      }

      for (const evidence of assertion.evidence) {
        relevant.add(evidence.pageNumber);
      }
    }
  }

  return relevant.size > 0 ? [...relevant].sort((a, b) => a - b) : allPageNumbers(document);
}

function buildRequest(
  document: ExtractedPdf,
  pass: LlmExtractionRequest["pass"],
  requestedModel?: string,
): LlmExtractionRequest {
  return {
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    pages: document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
    })),
    pass,
    requestedModel,
  };
}

function assertCoverageResultMatchesAsset(
  result: LlmExtractionResult,
  assetLocalId: string,
): void {
  if (result.pass !== "asset_coverage") {
    throw new Error(`Expected asset_coverage result for ${assetLocalId}`);
  }

  const returnedAsset = result.assets.find((asset) => asset.localId === assetLocalId);
  if (!returnedAsset) {
    throw new Error(`Coverage result omitted target asset ${assetLocalId}`);
  }

  const foreignAssertions = result.assertions.filter(
    (assertion) =>
      assertion.entityRef !== assetLocalId &&
      assertion.factKind !== "policy" &&
      assertion.factKind !== "premium" &&
      assertion.factKind !== "notice",
  );

  if (foreignAssertions.length > 0) {
    throw new Error(
      `Coverage result for ${assetLocalId} contains assertions for another asset: ${foreignAssertions
        .map((assertion) => assertion.entityRef)
        .join(", ")}`,
    );
  }
}

export async function runLlmExtraction(
  document: ExtractedPdf,
  provider: InsuranceLlmProvider,
  options: LlmExtractionRunOptions = {},
): Promise<LlmExtractionRun> {
  if (document.pages.length === 0) {
    throw new Error("Cannot run LLM extraction for a document with no pages");
  }

  const discoveryRequest = buildRequest(
    document,
    { kind: "discovery" },
    options.requestedModel,
  );
  const discoveryPrompt =
    options.systemPrompt ?? buildInsuranceExtractionSystemPrompt("discovery");
  const discoveryRaw = await provider.extract(discoveryRequest, discoveryPrompt);
  const discovery = parseLlmExtractionResult(discoveryRaw, discoveryRequest);

  if (discovery.pass !== "discovery") {
    throw new Error("Expected discovery result from discovery pass");
  }

  if (discovery.classification === "unsupported" || discovery.assets.length === 0) {
    return {
      discovery,
      coverageByAssetLocalId: new Map(),
      skippedAssetLocalIds: discovery.assets.map((asset) => asset.localId),
    };
  }

  const requestedLimit = options.maxCoveragePasses ?? discovery.assets.length;
  const maxCoveragePasses = Math.max(0, Math.min(requestedLimit, discovery.assets.length));
  const selectedAssets = discovery.assets.slice(0, maxCoveragePasses);
  const skippedAssetLocalIds = discovery.assets
    .slice(maxCoveragePasses)
    .map((asset) => asset.localId);
  const coverageByAssetLocalId = new Map<string, LlmExtractionResult>();

  for (const asset of selectedAssets) {
    const selectedPageNumbers =
      options.selectCoveragePages?.(discovery, asset, document) ??
      defaultCoveragePages(discovery, asset, document);
    const availablePageNumbers = new Set(allPageNumbers(document));
    const relevantPageNumbers = [...new Set(selectedPageNumbers)]
      .filter((pageNumber) => availablePageNumbers.has(pageNumber))
      .sort((a, b) => a - b);

    if (relevantPageNumbers.length === 0) {
      throw new Error(`No valid coverage pages selected for asset ${asset.localId}`);
    }

    const coverageRequest = buildRequest(
      document,
      {
        kind: "asset_coverage",
        targetAssetLocalId: asset.localId,
        relevantPageNumbers,
      },
      options.requestedModel,
    );
    const coveragePrompt =
      options.systemPrompt ?? buildInsuranceExtractionSystemPrompt("asset_coverage");
    const coverageRaw = await provider.extract(coverageRequest, coveragePrompt);
    const coverage = parseLlmExtractionResult(coverageRaw, coverageRequest);
    assertCoverageResultMatchesAsset(coverage, asset.localId);
    coverageByAssetLocalId.set(asset.localId, coverage);
  }

  return {
    discovery,
    coverageByAssetLocalId,
    skippedAssetLocalIds,
  };
}
