import { describe, expect, it } from "vitest";
import {
  partitionDocumentsByNormalization,
  selectCompatibleNormalization,
  type DocumentNormalization,
  type NormalizationReuseItem,
} from "../src/normalization-reuse.ts";

const SCHEMA = "1.0.0";
const ANALYZER = "default-v1";

function makeNormalization(overrides: Partial<DocumentNormalization> = {}): DocumentNormalization {
  return {
    id: "n1",
    policy_document_id: "pd-old",
    content_sha256: "aa".repeat(32),
    normalization_schema_version: SCHEMA,
    analyzer_version: ANALYZER,
    status: "complete",
    model_provider: "test",
    model_id: "test-model",
    prompt_version: "1.0.0",
    classification: "supported",
    normalized_output_json: { documentId: "pd-old" },
    normalized_entities_json: [],
    conflicts_json: [],
    evidence_json: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<NormalizationReuseItem> = {}): NormalizationReuseItem {
  return {
    policyDocumentId: "pd-new",
    contentSha256: "aa".repeat(32),
    ...overrides,
  };
}

describe("selectCompatibleNormalization", () => {
  it("matches by content digest, schema, and analyzer regardless of policy_document_id", () => {
    const normalizations = [makeNormalization({ policy_document_id: "pd-old" })];
    const item = makeItem({ policyDocumentId: "pd-new" });

    const result = selectCompatibleNormalization(item, normalizations, SCHEMA, ANALYZER);

    expect(result).toBeDefined();
    expect(result?.id).toBe("n1");
  });

  it("requires a complete status", () => {
    const normalizations = [makeNormalization({ status: "pending" })];
    const item = makeItem();

    const result = selectCompatibleNormalization(item, normalizations, SCHEMA, ANALYZER);

    expect(result).toBeUndefined();
  });

  it("rejects a schema mismatch", () => {
    const normalizations = [makeNormalization({ normalization_schema_version: "2.0.0" })];
    const item = makeItem();

    const result = selectCompatibleNormalization(item, normalizations, SCHEMA, ANALYZER);

    expect(result).toBeUndefined();
  });

  it("rejects an analyzer mismatch", () => {
    const normalizations = [makeNormalization({ analyzer_version: "other-v1" })];
    const item = makeItem();

    const result = selectCompatibleNormalization(item, normalizations, SCHEMA, ANALYZER);

    expect(result).toBeUndefined();
  });

  it("rejects a digest mismatch", () => {
    const normalizations = [makeNormalization()];
    const item = makeItem({ contentSha256: "bb".repeat(32) });

    const result = selectCompatibleNormalization(item, normalizations, SCHEMA, ANALYZER);

    expect(result).toBeUndefined();
  });
});

describe("partitionDocumentsByNormalization", () => {
  it("puts reusable documents first and provider-required documents second", () => {
    const normalizations = [makeNormalization({ content_sha256: "aa".repeat(32) })];
    const items = [
      makeItem({ policyDocumentId: "pd-1", contentSha256: "aa".repeat(32) }),
      makeItem({ policyDocumentId: "pd-2", contentSha256: "bb".repeat(32) }),
    ];

    const result = partitionDocumentsByNormalization(items, normalizations, SCHEMA, ANALYZER);

    expect(result.reusable).toHaveLength(1);
    expect(result.reusable[0].item.policyDocumentId).toBe("pd-1");
    expect(result.providerRequired).toHaveLength(1);
    expect(result.providerRequired[0].policyDocumentId).toBe("pd-2");
  });

  it("handles an empty document list", () => {
    const result = partitionDocumentsByNormalization([], [], SCHEMA, ANALYZER);
    expect(result.reusable).toHaveLength(0);
    expect(result.providerRequired).toHaveLength(0);
  });
});
