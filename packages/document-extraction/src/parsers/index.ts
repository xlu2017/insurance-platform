import type { ExtractedPdf, InsuranceDocumentParser, ParsedInsuranceDocument } from "../types.ts";
import { canParseHome, parseHome } from "./td-home.ts";
import { canParseAuto, parseAuto } from "./td-auto.ts";

export const parsers: InsuranceDocumentParser[] = [
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

export function parseDocument(document: ExtractedPdf): ParsedInsuranceDocument {
  for (const parser of parsers) {
    if (parser.canParse(document)) {
      return parser.parse(document);
    }
  }
  return {
    classification: "unsupported",
    policyTerms: [],
    assetAssertions: [],
    coverageAssertions: [],
    notices: [],
    conflicts: [],
    parserId: "none",
    parserVersion: "0",
  };
}
