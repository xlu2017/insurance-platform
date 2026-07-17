import type { ExtractedPdf, ParsedInsuranceDocument } from "../types.ts";
import { ParsedInsuranceDocument as ParsedInsuranceDocumentSchema } from "../types.ts";
import { canParseHome, parseHome } from "./td-home.ts";
import { canParseAuto, parseAuto } from "./td-auto.ts";

export const parsers = [
  {
    id: "TdSecurityNationalHomeRenewalParserV1",
    version: "1.0.0",
    canParse: canParseHome,
    parse: parseHome,
  },
  {
    id: "TdSecurityNationalAlbertaAutoRenewalParserV1",
    version: "1.0.0",
    canParse: canParseAuto,
    parse: parseAuto,
  },
];

export async function parseDocument(document: ExtractedPdf): Promise<ParsedInsuranceDocument> {
  for (const parser of parsers) {
    if (parser.canParse(document)) {
      const parsed = await parser.parse(document);
      return ParsedInsuranceDocumentSchema.parse({
        ...parsed,
        documentId: document.documentId,
        fileDigest: document.fileDigest,
      });
    }
  }
  return ParsedInsuranceDocumentSchema.parse({
    classification: "unsupported",
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    parserId: "none",
    parserVersion: "0",
  });
}
