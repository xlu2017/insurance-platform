import { describe, expect, it } from "vitest";
import { partitionDocumentDigests } from "../src/document-batch.ts";

describe("document batch digest partition", () => {
  it("does not retransmit a document already processed for the household", () => {
    const result = partitionDocumentDigests(
      ["prior-document", "new-document"],
      { "prior-document": "digest-a", "new-document": "digest-b" },
      new Set(["digest-a"]),
    );
    expect(result).toEqual({
      duplicateDocumentIds: ["prior-document"],
      newDocumentIds: ["new-document"],
    });
  });
});
