import {
  type PublicDocumentError,
  type PublicDocumentErrorCode,
} from "./native-document-analysis.ts";

const CUSTOMER_FACING_MESSAGES: Record<PublicDocumentErrorCode, string> = {
  DOCUMENT_FILE_UNSUPPORTED: "This file type is not currently supported for document analysis.",
  DOCUMENT_FILE_TOO_LARGE: "This file is too large for document analysis.",
  DOCUMENT_PROCESSING_FAILED: "Document processing failed. Please try again or contact support.",
  DOCUMENT_ANALYSIS_UNAVAILABLE:
    "Document analysis is temporarily unavailable. Please try again later.",
  DOCUMENT_ANALYSIS_FAILED: "Document analysis failed. Please try again or contact support.",
  DOCUMENT_MODEL_UNAVAILABLE:
    "Document analysis is temporarily unavailable. Please try again later.",
};

export function sanitizeProviderError(
  error: unknown,
  supportReference?: string,
): PublicDocumentError {
  const supportId = supportReference ?? generateSupportReference();
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  let code: PublicDocumentErrorCode = "DOCUMENT_ANALYSIS_FAILED";
  let retryable = false;

  if (
    lower.includes("unsupported file") ||
    lower.includes("file type") ||
    lower.includes("invalid file") ||
    lower.includes("not currently supported")
  ) {
    code = "DOCUMENT_FILE_UNSUPPORTED";
  } else if (lower.includes("too large")) {
    code = "DOCUMENT_FILE_TOO_LARGE";
  } else if (
    lower.includes("rate limit") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("503") ||
    lower.includes("timeout") ||
    lower.includes("not enabled") ||
    lower.includes("not approved") ||
    lower.includes("consent") ||
    lower.includes("privacy notice")
  ) {
    code = "DOCUMENT_ANALYSIS_UNAVAILABLE";
    retryable = !lower.includes("not enabled") && !lower.includes("not approved");
  } else if (
    lower.includes("model unavailable") ||
    lower.includes("model is not available") ||
    lower.includes("not found")
  ) {
    code = "DOCUMENT_MODEL_UNAVAILABLE";
  } else if (lower.includes("processing failed")) {
    code = "DOCUMENT_PROCESSING_FAILED";
  }

  return {
    code,
    message: CUSTOMER_FACING_MESSAGES[code],
    retryable,
    supportReference: supportId,
  };
}

export function generateSupportReference(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function publicErrorResponse(error: PublicDocumentError): { error: PublicDocumentError } {
  return { error };
}
