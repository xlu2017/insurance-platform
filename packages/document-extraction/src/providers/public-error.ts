import {
  type PublicDocumentError,
  type PublicDocumentErrorCode,
} from "./native-document-analysis.ts";

export function sanitizeProviderError(
  error: unknown,
  supportReference?: string,
): PublicDocumentError {
  const supportId = supportReference ?? generateSupportReference();
  const message = error instanceof Error ? error.message : String(error);

  let code: PublicDocumentErrorCode = "DOCUMENT_ANALYSIS_FAILED";
  let retryable = false;

  if (
    message.toLowerCase().includes("unsupported") ||
    message.toLowerCase().includes("invalid file")
  ) {
    code = "DOCUMENT_FILE_UNSUPPORTED";
  } else if (message.toLowerCase().includes("too large")) {
    code = "DOCUMENT_FILE_TOO_LARGE";
  } else if (
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("temporarily unavailable") ||
    message.toLowerCase().includes("503") ||
    message.toLowerCase().includes("timeout")
  ) {
    code = "DOCUMENT_ANALYSIS_UNAVAILABLE";
    retryable = true;
  } else if (
    message.toLowerCase().includes("model unavailable") ||
    message.toLowerCase().includes("not found")
  ) {
    code = "DOCUMENT_MODEL_UNAVAILABLE";
  } else if (message.toLowerCase().includes("processing failed")) {
    code = "DOCUMENT_PROCESSING_FAILED";
  }

  return {
    code,
    message:
      "Document analysis failed. Please try again or contact support if the problem continues.",
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
