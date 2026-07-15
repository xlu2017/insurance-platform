import { describe, expect, it } from "vitest";
import { manualExtractionProvider, mockExtractionProvider } from "../src/providers/extraction";

describe("extraction providers", () => {
  it("manual provider returns null so operations enter values by hand", async () => {
    expect(manualExtractionProvider.name).toBe("manual");
    await expect(manualExtractionProvider.extract("doc-1")).resolves.toBeNull();
  });

  it("mock provider is deterministic for the same document id", async () => {
    const a = await mockExtractionProvider.extract("doc-1");
    const b = await mockExtractionProvider.extract("doc-1");
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });
});
