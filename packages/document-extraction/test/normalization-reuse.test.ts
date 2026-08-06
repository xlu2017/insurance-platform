import { describe, expect, it } from "vitest";
import {
  partitionDocumentsByNormalization,
  selectCompatibleNormalization,
  type ReusableNormalization,
  type StoredNormalization,
} from "../src/normalization-reuse.ts";

function digest(character: string): string {
  return character.repeat(64);
}

const target = {
  contentSha256: digest("a"),
  normalizationSchemaVersion: "1.0.0",
  analyzerVersion: "gemini-2.5-flash-lite:1.0.0",
};

function makeNormalization(
  overrides: Partial<StoredNormalization> & { contentSha256: string },
): StoredNormalization {
  const { contentSha256, ...rest } = overrides;
  return {
    id: "normalization-1",
    policyDocumentId: "policy-document-1",
    contentSha256,
    normalizationSchemaVersion: target.normalizationSchemaVersion,
    analyzerVersion: target.analyzerVersion,
    status: "complete",
    normalizedOutput: {},
    normalizedEntities: [],
    conflicts: [],
    evidence: [],
    ...rest,
  };
}

describe("selectCompatibleNormalization", () => {
  it("returns an exact compatible normalization", () => {
    const normalization = makeNormalization({ contentSha256: digest("a"), id: "norm-1" });
    const result = selectCompatibleNormalization({
      document: { documentId: "doc-1", contentSha256: digest("a") },
      normalizations: [normalization],
      targetCompatibility: target,
    });
    expect(result).toBe(normalization);
  });

  it("returns null when the schema version mismatches", () => {
    const result = selectCompatibleNormalization({
      document: { documentId: "doc-1", contentSha256: digest("a") },
      normalizations: [
        makeNormalization({ contentSha256: digest("a"), normalizationSchemaVersion: "2.0.0" }),
      ],
      targetCompatibility: target,
    });
    expect(result).toBeNull();
  });

  it("returns null when the analyzer version mismatches", () => {
    const result = selectCompatibleNormalization({
      document: { documentId: "doc-1", contentSha256: digest("a") },
      normalizations: [makeNormalization({ contentSha256: digest("a"), analyzerVersion: "other" })],
      targetCompatibility: target,
    });
    expect(result).toBeNull();
  });

  it("returns null for failed or incomplete normalizations", () => {
    const failed = makeNormalization({ contentSha256: digest("a"), status: "failed" });
    const incomplete = makeNormalization({ contentSha256: digest("a"), status: "incomplete" });
    expect(
      selectCompatibleNormalization({
        document: { documentId: "doc-1", contentSha256: digest("a") },
        normalizations: [failed],
        targetCompatibility: target,
      }),
    ).toBeNull();
    expect(
      selectCompatibleNormalization({
        document: { documentId: "doc-1", contentSha256: digest("a") },
        normalizations: [incomplete],
        targetCompatibility: target,
      }),
    ).toBeNull();
  });

  it("matches content digest case-insensitively", () => {
    const upper = makeNormalization({ contentSha256: digest("A"), id: "norm-upper" });
    const result = selectCompatibleNormalization({
      document: { documentId: "doc-1", contentSha256: digest("a") },
      normalizations: [upper],
      targetCompatibility: target,
    });
    expect(result).toBe(upper);
  });
});

describe("partitionDocumentsByNormalization", () => {
  it("partitions a mixed reusable and new batch", () => {
    const complete = makeNormalization({ contentSha256: digest("a"), id: "norm-a" });
    const result = partitionDocumentsByNormalization({
      documents: [
        { documentId: "doc-1", contentSha256: digest("a") },
        { documentId: "doc-2", contentSha256: digest("b") },
      ],
      normalizations: [complete],
      targetCompatibility: target,
    });

    expect(result.reusable).toEqual([
      { documentId: "doc-1", contentSha256: digest("a"), normalizationId: "norm-a" },
    ]);
    expect(result.requiresProvider).toEqual([
      {
        documentId: "doc-2",
        contentSha256: digest("b"),
        reason: "no_compatible_normalization",
      },
    ]);
    expect(result.unavailable).toEqual([]);
  });

  it("classifies schema mismatches as provider processing", () => {
    const mismatch = makeNormalization({
      contentSha256: digest("a"),
      id: "norm-a",
      normalizationSchemaVersion: "2.0.0",
    });
    const result = partitionDocumentsByNormalization({
      documents: [{ documentId: "doc-1", contentSha256: digest("a") }],
      normalizations: [mismatch],
      targetCompatibility: target,
    });
    expect(result.reusable).toEqual([]);
    expect(result.requiresProvider).toEqual([
      { documentId: "doc-1", contentSha256: digest("a"), reason: "schema_mismatch" },
    ]);
  });

  it("classifies analyzer mismatches as provider processing", () => {
    const mismatch = makeNormalization({
      contentSha256: digest("a"),
      id: "norm-a",
      analyzerVersion: "other-analyzer",
    });
    const result = partitionDocumentsByNormalization({
      documents: [{ documentId: "doc-1", contentSha256: digest("a") }],
      normalizations: [mismatch],
      targetCompatibility: target,
    });
    expect(result.reusable).toEqual([]);
    expect(result.requiresProvider).toEqual([
      { documentId: "doc-1", contentSha256: digest("a"), reason: "analyzer_mismatch" },
    ]);
  });

  it("classifies failed or incomplete normalizations as provider processing", () => {
    const failed = makeNormalization({ contentSha256: digest("a"), status: "failed" });
    const result = partitionDocumentsByNormalization({
      documents: [{ documentId: "doc-1", contentSha256: digest("a") }],
      normalizations: [failed],
      targetCompatibility: target,
    });
    expect(result.reusable).toEqual([]);
    expect(result.requiresProvider).toEqual([
      { documentId: "doc-1", contentSha256: digest("a"), reason: "incomplete_or_failed" },
    ]);
  });

  it("reuses a single normalization for two physical uploads with the same digest", () => {
    const complete = makeNormalization({ contentSha256: digest("a"), id: "norm-a" });
    const result = partitionDocumentsByNormalization({
      documents: [
        { documentId: "upload-1", contentSha256: digest("a") },
        { documentId: "upload-2", contentSha256: digest("a") },
      ],
      normalizations: [complete],
      targetCompatibility: target,
    });
    expect(result.reusable).toEqual([
      { documentId: "upload-1", contentSha256: digest("a"), normalizationId: "norm-a" },
      { documentId: "upload-2", contentSha256: digest("a"), normalizationId: "norm-a" },
    ]);
    expect(result.requiresProvider).toEqual([]);
  });

  it("preserves deterministic document order within each bucket", () => {
    const normA = makeNormalization({ contentSha256: digest("a"), id: "norm-a" });
    const normC = makeNormalization({ contentSha256: digest("c"), id: "norm-c" });
    const result = partitionDocumentsByNormalization({
      documents: [
        { documentId: "first", contentSha256: digest("a") },
        { documentId: "second", contentSha256: digest("b") },
        { documentId: "third", contentSha256: digest("c") },
        { documentId: "fourth", contentSha256: digest("d") },
      ],
      normalizations: [normA, normC],
      targetCompatibility: target,
    });
    expect(result.reusable.map((entry) => entry.documentId)).toEqual(["first", "third"]);
    expect(result.requiresProvider.map((entry) => entry.documentId)).toEqual(["second", "fourth"]);
  });

  it("places documents with missing or invalid digests in unavailable", () => {
    const complete = makeNormalization({ contentSha256: digest("a"), id: "norm-a" });
    const result = partitionDocumentsByNormalization({
      documents: [
        { documentId: "missing", contentSha256: "" },
        { documentId: "short", contentSha256: "abc123" },
        { documentId: "good", contentSha256: digest("a") },
      ],
      normalizations: [complete],
      targetCompatibility: target,
    });
    expect(result.reusable.map((entry) => entry.documentId)).toEqual(["good"]);
    expect(result.unavailable).toEqual([
      { documentId: "missing", reason: "missing_content_digest" },
      { documentId: "short", reason: "invalid_content_digest" },
    ]);
  });

  it("does not mutate input documents or normalizations", () => {
    const documents = [
      { documentId: "doc-1", contentSha256: digest("a") },
      { documentId: "doc-2", contentSha256: digest("b") },
    ];
    const normalizations: StoredNormalization[] = [
      makeNormalization({ contentSha256: digest("a"), id: "norm-a" }),
    ];
    const documentsBefore = JSON.stringify(documents);
    const normalizationsBefore = JSON.stringify(normalizations);

    partitionDocumentsByNormalization({
      documents,
      normalizations,
      targetCompatibility: target,
    });

    expect(JSON.stringify(documents)).toBe(documentsBefore);
    expect(JSON.stringify(normalizations)).toBe(normalizationsBefore);
  });
});
