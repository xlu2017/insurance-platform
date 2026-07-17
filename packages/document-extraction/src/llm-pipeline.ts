import {
  type InsuranceLlmProvider,
  type LlmAssetCandidate,
  type LlmExtractionRequest,
  type LlmExtractionResult,
  buildInsuranceExtractionSystemPrompt,
  parseLlmExtractionResult,
} from "./llm-contract.ts";
import {
  type LlmSemanticIssue,
  type LlmSemanticValidationResult,
  validateLlmExtractionSemantics,
} from "./llm-semantic-validation.ts";
import type { ExtractedPdf, ExtractedPdfPage } from "./types.ts";

export const LLM_PIPELINE_VERSION = 1 as const;

type LlmPageInput = LlmExtractionRequest["pages"][number];
export type LlmPipelinePassStatus = "completed" | "invalid_output" | "provider_error";

export interface LlmPipelinePassSummary {
  pass: "discovery" | "asset_coverage";
  assetLocalId?: string;
  pageNumbers: number[];
}

export interface LlmPipelineFailure {
  code:
    | "PROVIDER_ERROR"
    | "INVALID_MODEL_OUTPUT"
    | "MODEL_IDENTITY_MISMATCH"
    | "ASSET_TYPE_CHANGED";
  message: string;
}

export interface LlmPipelinePassResult {
  status: LlmPipelinePassStatus;
  attempts: number;
  request: LlmPipelinePassSummary;
  result?: LlmExtractionResult;
  validation?: LlmSemanticValidationResult;
  failure?: LlmPipelineFailure;
}

export interface LlmAssetCoverageResult {
  asset: LlmAssetCandidate;
  pass: LlmPipelinePassResult;
}

export interface InsuranceLlmPipelineResult {
  pipelineVersion: typeof LLM_PIPELINE_VERSION;
  documentId: string;
  fileDigest: string;
  providerId: string;
  modelId: string;
  discovery: LlmPipelinePassResult;
  assetCoverage: LlmAssetCoverageResult[];
  complete: boolean;
  requiresManualReview: boolean;
  warnings: string[];
}

export type LlmPipelineEvent =
  | {
      type: "pass_started";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
    }
  | {
      type: "pass_retrying";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
      reason: "provider_error" | "validation_error" | "model_identity_mismatch";
    }
  | {
      type: "pass_completed";
      documentId: string;
      pass: "discovery" | "asset_coverage";
      assetLocalId?: string;
      attempt: number;
      warningCount: number;
    };

export interface InsuranceLlmPipelineOptions {
  requestedModel?: string;
  maxAttempts?: number;
  maxConcurrentAssetPasses?: number;
  enforceProviderIdentity?: boolean;
  resolvePageImageRef?: (
    documentId: string,
    pageNumber: number,
  ) => string | undefined | Promise<string | undefined>;
  selectCoveragePageNumbers?: (args: {
    document: ExtractedPdf;
    discovery: LlmExtractionResult;
    asset: LlmAssetCandidate;
  }) => number[] | Promise<number[]>;
  onEvent?: (event: LlmPipelineEvent) => void | Promise<void>;
}

interface ExecutePassInput {
  provider: InsuranceLlmProvider;
  request: LlmExtractionRequest;
  maxAttempts: number;
  enforceProviderIdentity: boolean;
  onEvent?: InsuranceLlmPipelineOptions["onEvent"];
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_ASSET_CONCURRENCY = 2;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function assertValidDocument(document: ExtractedPdf): void {
  if (!/^[a-f0-9]{64}$/i.test(document.fileDigest)) {
    throw new Error("Extracted PDF fileDigest must be a SHA-256 hex digest");
  }
  if (document.pages.length === 0) {
    throw new Error("Extracted PDF must contain at least one page");
  }
  if (document.pageCount !== document.pages.length) {
    throw new Error("Extracted PDF pageCount does not match its pages");
  }

  const pageNumbers = new Set<number>();
  for (const page of document.pages) {
    if (pageNumbers.has(page.pageNumber)) {
      throw new Error(`Extracted PDF contains duplicate page ${page.pageNumber}`);
    }
    pageNumbers.add(page.pageNumber);
  }
}

async function emit(
  handler: InsuranceLlmPipelineOptions["onEvent"],
  event: LlmPipelineEvent,
): Promise<void> {
  if (handler) await handler(event);
}

function summarizeRequest(request: LlmExtractionRequest): LlmPipelinePassSummary {
  if (request.pass.kind === "asset_coverage") {
    return {
      pass: request.pass.kind,
      assetLocalId: request.pass.targetAssetLocalId,
      pageNumbers: request.pages.map((page) => page.pageNumber),
    };
  }
  return {
    pass: request.pass.kind,
    pageNumbers: request.pages.map((page) => page.pageNumber),
  };
}

function requestAssetLocalId(request: LlmExtractionRequest): string | undefined {
  return request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : undefined;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function repairPrompt(
  basePrompt: string,
  reason: "provider_error" | "validation_error" | "model_identity_mismatch",
  issues: LlmSemanticIssue[],
): string {
  const issueList = issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 20)
    .map((issue) => `${issue.code}@${issue.path.join(".")}`)
    .join(", ");

  return `${basePrompt}\n\nThe prior response was rejected. Return a complete replacement JSON object, not a patch. Failure category: ${reason}.${
    issueList ? ` Correct these deterministic validation failures: ${issueList}.` : ""
  } Do not repeat private values in warnings or explanations.`;
}

function providerIdentityMatches(
  result: LlmExtractionResult,
  provider: InsuranceLlmProvider,
): boolean {
  return result.model.provider === provider.providerId && result.model.model === provider.modelId;
}

async function executePass(input: ExecutePassInput): Promise<LlmPipelinePassResult> {
  const { provider, request, maxAttempts, enforceProviderIdentity, onEvent } = input;
  const basePrompt = buildInsuranceExtractionSystemPrompt(request.pass.kind);
  let prompt = basePrompt;
  let lastValidation: LlmSemanticValidationResult | undefined;
  let lastFailure: LlmPipelineFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const assetLocalId = requestAssetLocalId(request);
    await emit(onEvent, {
      type: "pass_started",
      documentId: request.documentId,
      pass: request.pass.kind,
      assetLocalId,
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
          assetLocalId,
          attempt,
          reason: "provider_error",
        });
        prompt = repairPrompt(basePrompt, "provider_error", []);
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
          message: "LLM output failed deterministic semantic validation",
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId,
            attempt,
            reason: "validation_error",
          });
          prompt = repairPrompt(basePrompt, "validation_error", validation.issues);
          continue;
        }
        break;
      }

      const result = parseLlmExtractionResult(raw, request);
      if (enforceProviderIdentity && !providerIdentityMatches(result, provider)) {
        lastFailure = {
          code: "MODEL_IDENTITY_MISMATCH",
          message: "LLM output model identity does not match the configured provider",
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId,
            attempt,
            reason: "model_identity_mismatch",
          });
          prompt = repairPrompt(basePrompt, "model_identity_mismatch", []);
          continue;
        }
        break;
      }

      await emit(onEvent, {
        type: "pass_completed",
        documentId: request.documentId,
        pass: request.pass.kind,
        assetLocalId,
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
        message: `LLM output did not match the extraction contract (${safeErrorName(error)})`,
      };
      if (attempt < maxAttempts) {
        await emit(onEvent, {
          type: "pass_retrying",
          documentId: request.documentId,
          pass: request.pass.kind,
          assetLocalId,
          attempt,
          reason: "validation_error",
        });
        prompt = repairPrompt(basePrompt, "validation_error", []);
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
        message: "LLM extraction pass did not produce a valid result",
      },
  };
}

async function toPageInputs(
  document: ExtractedPdf,
  pages: ExtractedPdfPage[],
  resolver: InsuranceLlmPipelineOptions["resolvePageImageRef"],
): Promise<LlmPageInput[]> {
  return Promise.all(
    pages.map(async (page) => {
      const imageRef = resolver ? await resolver(document.documentId, page.pageNumber) : undefined;
      return imageRef
        ? { pageNumber: page.pageNumber, text: page.text, imageRef }
        : { pageNumber: page.pageNumber, text: page.text };
    }),
  );
}

function selectPages(document: ExtractedPdf, pageNumbers: number[]): ExtractedPdfPage[] {
  const unique = [...new Set(pageNumbers)];
  if (unique.length === 0) throw new Error("Coverage page selector returned no pages");

  const pagesByNumber = new Map(document.pages.map((page) => [page.pageNumber, page]));
  return unique
    .map((pageNumber) => {
      const page = pagesByNumber.get(pageNumber);
      if (!page) throw new Error(`Coverage page selector returned unknown page ${pageNumber}`);
      return page;
    })
    .sort((left, right) => left.pageNumber - right.pageNumber);
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

function assetTypeChanged(asset: LlmAssetCandidate, pass: LlmPipelinePassResult): boolean {
  const returned = pass.result?.assets.find((candidate) => candidate.localId === asset.localId);
  return Boolean(returned && returned.assetType !== asset.assetType);
}

/**
 * Executes document discovery followed by one validated coverage pass for each
 * discovered asset. This function never writes data, merges entities, derives
 * mandates, or runs recommendations.
 */
export async function runInsuranceLlmPipeline(
  document: ExtractedPdf,
  provider: InsuranceLlmProvider,
  options: InsuranceLlmPipelineOptions = {},
): Promise<InsuranceLlmPipelineResult> {
  assertValidDocument(document);

  const maxAttempts = boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 3);
  const concurrency = boundedInteger(
    options.maxConcurrentAssetPasses,
    DEFAULT_ASSET_CONCURRENCY,
    1,
    4,
  );
  const enforceProviderIdentity = options.enforceProviderIdentity ?? true;
  const orderedPages = [...document.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const discoveryPages = await toPageInputs(document, orderedPages, options.resolvePageImageRef);
  const discoveryRequest: LlmExtractionRequest = {
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    pages: discoveryPages,
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
      pipelineVersion: LLM_PIPELINE_VERSION,
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      providerId: provider.providerId,
      modelId: provider.modelId,
      discovery,
      assetCoverage: [],
      complete: false,
      requiresManualReview: true,
      warnings: ["Document discovery failed; coverage extraction was not attempted"],
    };
  }

  const discoveryResult = discovery.result;
  if (["unsupported", "unknown"].includes(discoveryResult.classification)) {
    return {
      pipelineVersion: LLM_PIPELINE_VERSION,
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
    discoveryResult.assets,
    concurrency,
    async (asset): Promise<LlmAssetCoverageResult> => {
      const selectedNumbers = options.selectCoveragePageNumbers
        ? await options.selectCoveragePageNumbers({ document, discovery: discoveryResult, asset })
        : orderedPages.map((page) => page.pageNumber);
      const selected = selectPages(document, selectedNumbers);
      const pages = await toPageInputs(document, selected, options.resolvePageImageRef);
      const request: LlmExtractionRequest = {
        documentId: document.documentId,
        fileDigest: document.fileDigest,
        pages,
        pass: {
          kind: "asset_coverage",
          targetAssetLocalId: asset.localId,
          relevantPageNumbers: selected.map((page) => page.pageNumber),
        },
        requestedModel: options.requestedModel,
      };
      const pass = await executePass({
        provider,
        request,
        maxAttempts,
        enforceProviderIdentity,
        onEvent: options.onEvent,
      });

      if (assetTypeChanged(asset, pass)) {
        return {
          asset,
          pass: {
            ...pass,
            status: "invalid_output",
            failure: {
              code: "ASSET_TYPE_CHANGED",
              message: "Coverage extraction changed the discovered asset type",
            },
          },
        };
      }
      return { asset, pass };
    },
  );

  const hasAssets = discoveryResult.assets.length > 0;
  const complete = hasAssets && assetCoverage.every((entry) => entry.pass.status === "completed");
  const executions = [discovery, ...assetCoverage.map((entry) => entry.pass)];
  const validationWarnings = executions.reduce(
    (total, execution) =>
      total +
      (execution.validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0),
    0,
  );
  const uncertainIdentity = discoveryResult.assets.some(
    (asset) =>
      asset.proposedMatchClassification !== "new" ||
      (asset.assetType === "property" && asset.insuredLocationStatus !== "complete") ||
      (asset.assetType === "vehicle" && asset.vinStatus !== "valid_appearing"),
  );

  return {
    pipelineVersion: LLM_PIPELINE_VERSION,
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    providerId: provider.providerId,
    modelId: provider.modelId,
    discovery,
    assetCoverage,
    complete,
    requiresManualReview:
      !complete || !hasAssets || validationWarnings > 0 || uncertainIdentity,
    warnings: [
      ...(!hasAssets ? ["Discovery returned no insured assets"] : []),
      ...(!complete && hasAssets ? ["One or more asset coverage passes failed"] : []),
      ...(validationWarnings > 0
        ? [`Deterministic validation produced ${validationWarnings} warning(s)`]
        : []),
      ...(uncertainIdentity ? ["At least one asset identity requires review"] : []),
    ],
  };
}
