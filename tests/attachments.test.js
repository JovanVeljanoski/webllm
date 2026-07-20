import { describe, expect, it } from "vitest";
import {
  AttachmentValidationError,
  MAX_FILE_BYTES,
  MAX_WORKSPACE_BYTES,
  SUPPORTED_FILE_EXTENSIONS,
  createVirtualPath,
  decodeAttachmentBytes,
  ingestAttachmentFile,
  validateAttachmentCandidate,
  workspaceUsage,
} from "../lib/attachments.js";

function mockFile(name, content, overrides = {}) {
  const bytes = typeof content === "string"
    ? new TextEncoder().encode(content)
    : new Uint8Array(content);
  return {
    name,
    size: bytes.byteLength,
    type: "text/plain",
    lastModified: 10,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    ...overrides,
  };
}

describe("attachment validation", () => {
  it("accepts supported text extensions and rejects excluded formats", () => {
    expect(validateAttachmentCandidate(mockFile("notes.md", "hello"))).toMatchObject({
      extension: ".md",
      category: "plain_text",
    });
    expect(() => validateAttachmentCandidate(mockFile("report.pdf", "%PDF")))
      .toThrow(AttachmentValidationError);
    expect(() => validateAttachmentCandidate(mockFile("image.svg", "<svg/>")))
      .toThrow(/not supported/);
  });

  it("accepts every approved extension regardless of empty or misleading MIME", () => {
    for (const extension of SUPPORTED_FILE_EXTENSIONS) {
      expect(() => validateAttachmentCandidate(
        mockFile(`file${extension}`, "plain text", {
          type: extension === ".md" ? "" : "application/octet-stream",
        }),
      )).not.toThrow();
    }
  });

  it("rejects representative rich documents, images, archives, and unknown files", () => {
    for (const name of [
      "report.pdf",
      "document.docx",
      "sheet.xlsx",
      "slides.pptx",
      "image.png",
      "vector.svg",
      "archive.zip",
      "archive.tar",
      "unknown.bin",
      "README",
    ]) {
      expect(() => validateAttachmentCandidate(mockFile(name, "renamed data")))
        .toThrow(AttachmentValidationError);
    }
  });

  it("enforces per-file, count, and total limits", () => {
    expect(() => validateAttachmentCandidate(
      mockFile("big.txt", "", { size: MAX_FILE_BYTES + 1 }),
    )).toThrow(/1 MB/);
    const ten = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      originalBytes: 1,
    }));
    expect(() => validateAttachmentCandidate(mockFile("tenth.txt", "x"), ten.slice(0, 9)))
      .not.toThrow();
    expect(() => validateAttachmentCandidate(mockFile("extra.txt", "x"), ten))
      .toThrow(/at most 10/);
    expect(workspaceUsage(ten)).toEqual({ count: 10, bytes: 10 });
  });

  it("measures aggregate limits from normalized stored bytes", async () => {
    const fourMegabytes = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      originalBytes: MAX_FILE_BYTES,
      storedBytes: MAX_FILE_BYTES,
    }));
    expect(() => validateAttachmentCandidate(
      mockFile("exact.txt", "", { size: MAX_FILE_BYTES }),
      fourMegabytes,
    )).not.toThrow();
    const fiveMegabytes = [...fourMegabytes, {
      id: "fifth",
      originalBytes: MAX_FILE_BYTES,
      storedBytes: MAX_FILE_BYTES,
    }];
    expect(workspaceUsage(fiveMegabytes).bytes).toBe(MAX_WORKSPACE_BYTES);
    await expect(ingestAttachmentFile(
      mockFile("overflow.txt", "x"),
      { sessionId: "s1", attachments: fiveMegabytes },
    )).rejects.toThrow(/stored text can total at most 5 MB/);
    expect(workspaceUsage([{
      originalBytes: 100,
      storedBytes: 40,
    }]).bytes).toBe(40);
  });

  it("creates collision-safe virtual paths case-insensitively", () => {
    expect(createVirtualPath("notes.md", [{ virtualPath: "Notes.md" }]))
      .toBe("notes (2).md");
    expect(createVirtualPath("../folder\\data.json", []))
      .toBe(".._folder_data.json");
  });
});

describe("attachment decoding", () => {
  it("normalizes UTF-8 line endings and strips a BOM", () => {
    const text = decodeAttachmentBytes(
      new TextEncoder().encode("\uFEFFone\r\ntwo\rthree"),
    );
    expect(text).toBe("one\ntwo\nthree");
  });

  it("decodes BOM-tagged UTF-16LE", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    expect(decodeAttachmentBytes(bytes)).toBe("hi");
  });

  it("rejects binary signatures and NUL bytes", () => {
    expect(() => decodeAttachmentBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46])))
      .toThrow(/binary/);
    expect(() => decodeAttachmentBytes(new Uint8Array([65, 0, 66])))
      .toThrow(/NUL/);
  });

  it("rejects invalid UTF-8 and excessive decoded control characters", () => {
    expect(() => decodeAttachmentBytes(new Uint8Array([0xc3, 0x28])))
      .toThrow(/not valid UTF-8/);
    expect(() => decodeAttachmentBytes(new Uint8Array([1, 2, 3, 4, 65])))
      .toThrow(/control characters/);
  });

  it("does not add a synthetic trailing newline", async () => {
    const attachment = await ingestAttachmentFile(mockFile("single.txt", "one"), {
      sessionId: "s1",
      id: "single",
    });
    expect(attachment.content).toBe("one");
    expect(attachment.lineCount).toBe(1);
  });

  it("ingests normalized metadata without retaining a File handle", async () => {
    const attachment = await ingestAttachmentFile(mockFile("notes.md", "one\r\ntwo"), {
      sessionId: "s1",
      attachments: [],
      id: "a1",
      now: 100,
    });
    expect(attachment).toMatchObject({
      id: "a1",
      sessionId: "s1",
      virtualPath: "notes.md",
      content: "one\ntwo",
      lineCount: 2,
      createdAt: 100,
    });
    expect(attachment).not.toHaveProperty("file");
  });
});
