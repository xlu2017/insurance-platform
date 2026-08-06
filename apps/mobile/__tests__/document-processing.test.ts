jest.mock("../lib/supabase", () => ({
  supabase: {},
}));

const mockInvokeEdgeFunction = jest.fn();
jest.mock("../lib/edge-functions", () => ({
  invokeEdgeFunction: (...args: unknown[]) => mockInvokeEdgeFunction(...args),
}));

import { createDocumentBatchFromStaged } from "../lib/document-processing";

describe("document-processing helpers", () => {
  beforeEach(() => {
    mockInvokeEdgeFunction.mockReset();
    mockInvokeEdgeFunction.mockResolvedValue({
      data: {
        id: "batch-1",
        status: "queued",
        automatic_processing: true,
      },
      error: null,
    });
  });

  it("createDocumentBatchFromStaged serializes policyDocumentIds as new_policy_document_ids", async () => {
    const result = await createDocumentBatchFromStaged({
      householdId: "household-1",
      caseId: "case-1",
      clientRequestId: "client-req-1",
      policyDocumentIds: ["doc-a", "doc-b"],
    });

    expect(result.id).toBe("batch-1");
    expect(mockInvokeEdgeFunction).toHaveBeenCalledTimes(1);
    expect(mockInvokeEdgeFunction).toHaveBeenCalledWith(
      "document-processing-batch",
      expect.objectContaining({
        action: "create-from-staged",
        household_id: "household-1",
        case_id: "case-1",
        client_request_id: "client-req-1",
        new_policy_document_ids: ["doc-a", "doc-b"],
      }),
    );
  });
});
