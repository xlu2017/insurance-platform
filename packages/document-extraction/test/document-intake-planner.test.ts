import { describe, expect, it } from "vitest";
import {
  planDocumentIntake,
  type ExistingHouseholdDocument,
  type ExistingReviewSession,
  type IncomingPolicyDocument,
} from "../src/document-intake-planner";

function digest(character: string): string {
  return character.repeat(64);
}

function upload(uploadId: string, fileDigest: string): IncomingPolicyDocument {
  return { uploadId, fileDigest, fileName: `${uploadId}.pdf` };
}

const activeSession: ExistingReviewSession = {
  sessionId: "session-active",
  status: "collecting",
  documentIds: ["document-existing"],
};

const existingDocument: ExistingHouseholdDocument = {
  documentId: "document-existing",
  fileDigest: digest("a"),
  reviewSessionIds: ["session-active"],
};

describe("planDocumentIntake", () => {
  it("accepts four distinct policies into one deterministic new session", () => {
    const plan = planDocumentIntake({
      incoming: [
        upload("rental-2", digest("c")),
        upload("vehicle", digest("d")),
        upload("primary-home", digest("a")),
        upload("rental-1", digest("b")),
      ],
    });

    expect(plan.ready).toBe(true);
    expect(plan.session).toMatchObject({ mode: "create" });
    expect(plan.acceptedUploads.map((document) => document.uploadId)).toEqual([
      "primary-home",
      "rental-1",
      "rental-2",
      "vehicle",
    ]);
    expect(plan.acceptedUploads.every((document) => document.session === plan.session)).toBe(true);
    expect(plan.duplicateUploads).toEqual([]);
  });

  it("reuses the active review session when policies arrive separately", () => {
    const plan = planDocumentIntake({
      incoming: [upload("second-upload", digest("b"))],
      existingDocuments: [existingDocument],
      existingSessions: [activeSession],
    });

    expect(plan.ready).toBe(true);
    expect(plan.session).toEqual({
      mode: "reuse",
      sessionId: "session-active",
    });
    expect(plan.acceptedUploads).toEqual([
      {
        uploadId: "second-upload",
        fileDigest: digest("b"),
        session: { mode: "reuse", sessionId: "session-active" },
      },
    ]);
  });

  it("accepts one canonical upload for repeated digests in the same batch", () => {
    const plan = planDocumentIntake({
      incoming: [upload("upload-z", digest("a")), upload("upload-a", digest("a"))],
    });

    expect(plan.ready).toBe(true);
    expect(plan.acceptedUploads).toHaveLength(1);
    expect(plan.acceptedUploads[0].uploadId).toBe("upload-a");
    expect(plan.duplicateUploads).toEqual([
      {
        uploadId: "upload-z",
        fileDigest: digest("a"),
        reason: "duplicate_in_batch",
        canonicalUploadId: "upload-a",
      },
    ]);
  });

  it("ignores a digest already stored for the household", () => {
    const plan = planDocumentIntake({
      incoming: [upload("repeat", digest("a"))],
      existingDocuments: [existingDocument],
      existingSessions: [activeSession],
    });

    expect(plan.ready).toBe(true);
    expect(plan.session).toEqual({ mode: "none" });
    expect(plan.acceptedUploads).toEqual([]);
    expect(plan.duplicateUploads).toEqual([
      {
        uploadId: "repeat",
        fileDigest: digest("a"),
        reason: "already_exists_in_household",
        existingDocumentId: "document-existing",
        existingReviewSessionId: "session-active",
      },
    ]);
  });

  it("is independent of upload order and filenames", () => {
    const first = planDocumentIntake({
      incoming: [
        { uploadId: "2", fileDigest: digest("b"), fileName: "vehicle.pdf" },
        { uploadId: "1", fileDigest: digest("a"), fileName: "home.pdf" },
      ],
    });
    const second = planDocumentIntake({
      incoming: [
        { uploadId: "1", fileDigest: digest("a"), fileName: "renamed-x.pdf" },
        { uploadId: "2", fileDigest: digest("b"), fileName: "renamed-y.pdf" },
      ],
    });

    expect(second).toEqual(first);
  });

  it("blocks ambiguous households with multiple active review sessions", () => {
    const plan = planDocumentIntake({
      incoming: [upload("new", digest("b"))],
      existingSessions: [
        activeSession,
        {
          sessionId: "session-second",
          status: "reviewing",
          documentIds: [],
        },
      ],
    });

    expect(plan.ready).toBe(false);
    expect(plan.acceptedUploads).toEqual([]);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "multiple_active_review_sessions" }),
    );
  });

  it("blocks stored digest collisions rather than choosing a document", () => {
    const plan = planDocumentIntake({
      incoming: [upload("repeat", digest("a"))],
      existingDocuments: [
        existingDocument,
        {
          documentId: "document-conflict",
          fileDigest: digest("a"),
        },
      ],
    });

    expect(plan.ready).toBe(false);
    expect(plan.duplicateUploads).toEqual([]);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({
        code: "existing_digest_collision",
        fileDigest: digest("a"),
      }),
    );
  });

  it("blocks missing digests and duplicate upload IDs atomically", () => {
    const plan = planDocumentIntake({
      incoming: [upload("same", ""), upload("same", digest("b"))],
    });

    expect(plan.ready).toBe(false);
    expect(plan.session).toEqual({ mode: "none" });
    expect(plan.acceptedUploads).toEqual([]);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["missing_file_digest", "duplicate_upload_id"]),
    );
  });
});
