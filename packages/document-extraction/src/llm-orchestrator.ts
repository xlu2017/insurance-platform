import {
  type InsuranceLlmProvider,
  type LlmAssetCandidate,
  type LlmExtractionRequest,
  type LlmExtractionResult,
  type LlmPageInputSchema,
  buildInsuranceExtractionSystemPrompt,
  parseLlmExtractionResult,
} from "./llm-contract.ts";
import {
  type LlmSemanticIssue,
  type LlmSemanticValidationResult,
  validateLlmExtractionSemantics,
} from "./llm-semantic-validation.ts";
import type { ExtractedPdf, ExtractedPdfPage } from "./types.ts";

export const LLM_ORCHESTRATION_VERSION = 1 as const;

export type LlmPassStatus = "completed" | "invalid_output" | "provider_error";

export type LlmPipelineEvent =
  | {
      type: "pass_started";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
    }
  | {
      type: "pass_completed";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
      warningCount: number;
    }
  | {
      type: "pass_retrying";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
      reason: "schema_or_semantic_validation" | "provider_error" | "model_identity_mismatch";
    };

export interface LlmPassRequestSummary {
  pass: "discovery" | "asset_coverage";
  targetAssetLocalId?: string;
  pageNumbers: number[];
}

export interface LlmPassFailure {
  code:
    | "PROVIDER_ERROR"
    | "INVALID_MODEL_OUTPUT"
    | "MODEL_IDENTITY_MISMATCH"
    | "ASSET_TYPE_CHANGED";
  message: string;
}

export interface LlmPassExecution {
  status: LlmPassStatus;
  attempts: number;
  request: LlmPassRequestSummary;
  result?: LlmExtractionResult;
  validation?: LlmSemanticValidationResult;
  failure?: LlmPassFailure;
}

export interface LlmAssetCoverageExecution {
  asset: LlmAssetCandidate;
  execution: LlmPassExecution;
}

export interface LlmDocumentExtractionBundle {
  orchestrationVersion: typeof LLM_ORCHESTRATION_VERSION;
  documentId: string;
  fileDigest: string;
  providerId: string;
  modelId: string;
  discovery: LlmPassExecution;
  assetCoverage: LlmAssetCoverageExecution[];
  complete: boolean;
  requiresManualReview: boolean;
  warnings: string[];
}

export interface LlmExtractionOrchestratorOptions {
  requestedModel?: string;
  maxAttempts?: number;
  maxConcurrentAssetPasses?: number;
  enforceProviderIdentity?: boolean;
  /**
   * Returns a provider-readable reference for a rendered page image. This
   * function must not return image bytes or log customer data.
   */
  resolvePageImageRef?: (
    documentId: string,
    pageNumber: number,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * Defaults to every document page for correctness. A caller may later supply
   * a deterministic page selector to reduce model cost after discovery.
   */
  selectCoveragePageNumbers?: (args: {
    document: ExtractedPdf;
    discovery: LlmExtractionResult;
    asset: LlmAssetCandidate;
  }) => number[] | Promise<number[]>;
  onEvent?: (event: LlmPipelineEvent) => void | Promise<void>;
}

interface ExecutePassOptions {
  provider: InsuranceLlmProvider;
  request: LlmExtractionRequest;
  maxAttempts: number;
  enforceProviderIdentity: boolean;
  onEvent?: LlmExtractionOrchestratorOptions["onEvent"];
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_MAX_CONCURRENT_ASSET_PASSES = 2;

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function assertDocumentShape(document: ExtractedPdf): void {
  if (!/^[a-f0-9]{64}$/i.test(document.fileDigest)) {
    throw new Error("Extracted PDF fileDigest must be a SHA-256 hex digest");
  }
  if (document.pages.length === 0) {
    throw new Error("Extracted PDF must contain at least one page");
  }
  if (document.pageCount !== document.pages.length) {
    throw new Error("Extracted PDF pageCount does not match the supplied pages");
  }

  const pageNumbers = new Set<number>();
  for (const page of document.pages) {
    if (pageNumbers.has(page.pageNumber)) {
      throw new Error(`Extracted PDF contains duplicate page number ${page.pageNumber}`);
    }
    pageNumbers.add(page.pageNumber);
  }
}

async function emit(
  handler: LlmExtractionOrchestratorOptions["onEvent"],
  event: LlmPipelineEvent,
): Promise<void> {
  if (!handler) return;
  await handler(event);
}

function summarizeRequest(request: LlmExtractionRequest): LlmPassRequestSummary {
  return {
    pass: request.pass.kind,
    targetAssetLocalId:
      request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
    pageNumbers: request.pages.map((page) => page.pageNumber),
  };
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function buildRepairPrompt(
  basePrompt: string,
  reason: "schema_or_semantic_validation" | "provider_error" | "model_identity_mismatch",
  issues: LlmSemanticIssue[],
): string {
  const issueSummary = issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 20)
    .map((issue) => `${issue.code}@${issue.path.join(".")}`)
    .join(", ");

  return `${basePrompt}\n\nThe previous response was rejected by deterministic validation. Return a complete replacement JSON object, not a patch. Failure category: ${reason}.${
    issueSummary ? ` Correct these issue codes and paths: ${issueSummary}.` : ""
  } Do not repeat private values in explanations or warnings.`;
}

function modelIdentityMatches(
  result: LlmExtractionResult,
  provider: InsuranceLlmProvider,
): boolean {
  return result.model.provider === provider.providerId && result.model.model === provider.modelId;
}

async function executePass(options: ExecutePassOptions): Promise<LlmPassExecution> {
  const { provider, request, maxAttempts, enforceProviderIdentity, onEvent } = options;
  const basePrompt = buildInsuranceExtractionSystemPrompt(request.pass.kind);
  let prompt = basePrompt;
  let lastValidation: LlmSemanticValidationResult | undefined;
  let lastFailure: LlmPassFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await emit(onEvent, {
      type: "pass_started",
      documentId: request.documentId,
      pass: request.pass.kind,
      assetLocalId:
        request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
      attempt,
    });

    let raw: unknown;
    try {
      raw = await provider.extract(request, prompt);
    } catch (error) {
      lastFailure = {
        code: "PROVIDER_ERROR",
        message: `LLM provider call failed (${safeErrorName(error)})`,
      };
      if (attempt < maxAttempts) {
        await emit(onEvent, {
          type: "pass_retrying",
          documentId: request.documentId,
          pass: request.pass.kind,
          assetLocalId:
            request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
          attempt,
          reason: "provider_error",
        });
        prompt = buildRepairPrompt(basePrompt, "provider_error", []);
        continue;
      }
      break;
    }

    try {
      const validation = validateLlmExtractionSemantics(raw, request);
      lastValidation = validation;
      if (!validation.valid) {
        lastFailure = {
          code: "INVALID_MODEL_OUTPUT",
          message: "LLM response failed deterministic semantic validation",
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId:
              request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
            attempt,
            reason: "schema_or_semantic_validation",
          });
          prompt = buildRepairPrompt(
            basePrompt,
            "schema_or_semantic_validation",
            validation.issues,
          );
          continue;
        }
        break;
      }

      const result = parseLlmExtractionResult(raw, request);
      if (enforceProviderIdentity && !modelIdentityMatches(result, provider)) {
        lastFailure = {
          code: "MODEL_IDENTITY_MISMATCH",
          message: "LLM response model identity does not match the configured provider",
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId:
              request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
            attempt,
            reason: "model_identity_mismatch",
          });
          prompt = buildRepairPrompt(basePrompt, "model_identity_mismatch", []);
          continue;
        }
        break;
      }

      await emit(onEvent, {
        type: "pass_completed",
        documentId: request.documentId,
        pass: request.pass.kind,
        assetLocalId:
          request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
        attempt,
        warningCount: validation.issues.filter((issue) => issue.severity === "warning").length,
      });

      return {
        status: "completed",
        attempts: attempt,
        request: summarizeRequest(request),
        result,
        validation,
      };
    } catch (error) {
      lastFailure = {
        code: "INVALID_MODEL_OUTPUT",
        message: `LLM response did not match the extraction contract (${safeErrorName(error)})`,
      };
      if (attempt < maxAttempts) {
        await emit(onEvent, {
          type: "pass_retrying",
          documentId: request.documentId,
          pass: request.pass.kind,
          assetLocalId:
            request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined,
          attempt,
          reason: "schema_or_semantic_validation",
        });
        prompt = buildRepairPrompt(basePrompt, "schema_or_semantic_validation", []);
        continue;
      }
    }
  }

  return {
    status: lastFailure?.code === "PROVIDER_ERROR" ? "provider_error" : "invalid_output",
    attempts: maxAttempts,
    request: summarizeRequest(request),
    validation: lastValidation,
    failure:
      lastFailure ?? {
        code: "INVALID_MODEL_OUTPUT",
        message: "LLM extraction pass failed without a valid result",
      },
  };
}

async function buildPageInputs(
  document: ExtractedPdf,
  pages: ExtractedPdfPage[],
  resolvePageImageRef: LlmExtractionOrchestratorOptions["resolvePageImageRef"],
): Promise<Array<import("./llm-contract.ts").LlmExtractionRequest["pages"][number]>> {
  return Promise.all(
    pages.map(async (page) => {
      const imageRef = resolvePageImageRef
        ? await resolvePageImageRef(document.documentId, page.pageNumber)
        : undefined;
      return {
        pageNumber: page.pageNumber,
        text: page.text,
        imageRef,
      };
    }),
  );
}

function normalizeSelectedPages(document: ExtractedPdf, selected: number[]): ExtractedPdfPage[] {
  const unique = [...new Set(selected)];
  if (unique.length === 0) throw new Error("Coverage page selector returned no pages");

  const byNumber = new Map(document.pages.map((page) => [page.pageNumber, page]));
  const pages = unique.map((pageNumber) => {
    const page = byNumber.get(pageNumber);
    if (!page) throw new Error(`Coverage page selector returned unknown page ${pageNumber}`);
    return page;
  });
  return pages.sort((left, right) => left.pageNumber - right.pageNumber);
}

async function mapInBatches<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency);
    output.push(...(await Promise.all(batch.map(mapper))));
  }
  return output;
}

function coverageAssetTypeMatches(
  expected: LlmAssetCandidate,
  execution: LlmPassExecution,
): boolean {
  if (!execution.result) return true;
  const returned = execution.result.assets.find((asset) => asset.localId === expected.localId);
  return !returned || returned.assetType === expected.assetType;
}

/**
 * Runs a fail-closed, provider-neutral two-pass insurance extraction. It makes
 * no database writes, performs no entity merge, and derives no mandate.
 */
export async function runTwoPassInsuranceExtraction(
  document: ExtractedPdf,
  provider: InsuranceLlmProvider,
  options: LlmExtractionOrchestratorOptions = {},
): Promise<LlmDocumentExtractionBundle> {
  assertDocumentShape(document);

  const maxAttempts = clampInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 3);
  const maxConcurrentAssetPasses = clampInteger(
    options.maxConcurrentAssetPasses,
    DEFAULT_MAX_CONCURRENT_ASSET_PASSES,
    1,
    4,
  );
  const enforceProviderIdentity = options.enforceProviderIdentity ?? true;

  const allPageInputs = await buildPageInputs(
    document,
    [...document.pages].sort((left, right) => left.pageNumber - right.pageNumber),
    options.resolvePageImageRef,
  );
  const discoveryRequest: LlmExtractionRequest = {
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    pages: allPageInputs,
    pass: { kind: "discovery" },
    requestedModel: options.requestedModel,
  };

  const discovery = await executePass({
    provider,
    request: discoveryRequest,
    maxAttempts,
    enforceProviderIdentity,
    onEvent: options.onEvent,
  });

  if (discovery.status !== "completed" || !discovery.result) {
    return {
      orchestrationVersion: LLM_ORCHESTRATION_VERSION,
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      providerId: provider.providerId,
      modelId: provider.modelId,
      discovery,
      assetCoverage: [],
      complete: false,
      requiresManualReview: true,
      warnings: ["Document discovery failed; no asset-specific extraction was attempted"],
    };
  }

  if (["unsupported", "unknown"].includes(discovery.result.classification)) {
    return {
      orchestrationVersion: LLM_ORCHESTRATION_VERSION,
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      providerId: provider.providerId,
      modelId: provider.modelId,
      discovery,
      assetCoverage: [],
      complete: false,
      requiresManualReview: true,
      warnings: ["Document classification requires manual review"],
    };
  }

  const assetCoverage = await mapInBatches(
    discovery.result.assets,
    maxConcurrentAssetPasses,
    async (asset): Promise<LlmAssetCoverageExecution> => {
      const selectedNumbers = options.selectCoveragePageNumbers
        ? await options.selectCoveragePageNumbers({ document, discovery: discovery.result!, asset })
        : document.pages.map((page) => page.pageNumber);
      const selectedPages = normalizeSelectedPages(document, selectedNumbers);
      const pageInputs = await buildPageInputs(document, selectedPages, options.resolvePageImageRef);
      const request: LlmExtractionRequest = {
        documentId: document.documentId,
        fileDigest: document.fileDigest,
        pages: pageInputs,
        pass: {
          kind: "asset_coverage",
          targetAssetLocalId: asset.localId,
          relevantPageNumbers: selectedPages.map((page) => page.pageNumber),
        },
        requestedModel: options.requestedModel,
      };
      const execution = await executePass({
        provider,
        request,
        maxAttempts,
        enforceProviderIdentity,
        onEvent: options.onEvent,
      });

      if (!coverageAssetTypeMatches(asset, execution)) {
        return {
          asset,
          execution: {
            ...execution,
            status: "invalid_output",
            failure: {
              code: "ASSET_TYPE_CHANGED",
              message: "Asset-specific extraction changed the discovered asset type",
            },
          },
        };
      }

      return { asset, execution };
    },
  );

  const complete = assetCoverage.every((entry) => entry.execution.status === "completed");
  const warningCount = [discovery, ...assetCoverage.map((entry) => entry.execution)].reduce(
    (total, execution) =>
      total +
      (execution.validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0),
    0,
  );
  const uncertainIdentity = discovery.result.assets.some(
    (asset) =>
      asset.proposedMatchClassification !== "new" ||
      (asset.assetType === "property" && asset.insuredLocationStatus !== "complete") ||
      (asset.assetType === "vehicle" && asset.vinStatus !== "valid_appearing"),
  );

  return {
    orchestrationVersion: LLM_ORCHESTRATION_VERSION,
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    providerId: provider.providerId,
    modelId: provider.modelId,
    discovery,
    assetCoverage,
    complete,
    requiresManualReview: !complete || warningCount > 0 || uncertainIdentity,
    warnings: [
      ...(complete ? [] : ["One or more asset-specific extraction passes failed"]),
      ...(warningCount > 0 ? [`Deterministic validation produced ${warningCount} warning(s)`] : []),
      ...(uncertainIdentity ? ["At least one asset identity requires deterministic or customer review"] : []),
    ],
  };
}
