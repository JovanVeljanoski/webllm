import { describe, expect, it } from "vitest";
import {
  buildFileManifest,
  buildReferencedFileContext,
  expandFileReferences,
} from "../lib/file-context.js";
import {
  compileIncludeFilter,
  grepAttachments,
  readAttachmentRange,
  resolveAttachment,
} from "../lib/file-search.js";
import {
  exactFileRefsInText,
  findFileMentions,
  findAtFileQuery,
  fuzzyMatchAttachments,
  mergeFileRefs,
  reconcileSelectedFileRefs,
  replaceAtFileQuery,
  resolveDraftFileRefs,
} from "../lib/file-reference.js";
import { createLocalFileTools, localFileToolBudget } from "../lib/file-tools.js";

function attachment(id, path, content, extension = ".md") {
  return {
    id,
    sessionId: "s1",
    virtualPath: path,
    originalName: path,
    extension,
    category: "plain_text",
    content,
    lineCount: content.split("\n").length,
    storedBytes: new TextEncoder().encode(content).byteLength,
    createdAt: Number(id.replace(/\D/g, "")) || 0,
  };
}

const files = [
  attachment("a1", "notes.md", "Alpha\nneedle [literal]\nOmega"),
  attachment("a2", "data.json", '{"Needle": true}\n{"value": 2}', ".json"),
];

describe("file read and grep", () => {
  it("resolves paths case-insensitively and reads numbered ranges", () => {
    const file = resolveAttachment(files, "NOTES.MD");
    const result = readAttachmentRange(file, { offset: 2, limit: 1, maxBytes: 1000 });
    expect(result.content).toContain("2: needle [literal]");
    expect(result.meta).toMatchObject({ lineStart: 2, lineEnd: 2, nextOffset: 3 });
    expect(() => resolveAttachment(files, "missing.md")).toThrow(/not found/);
  });

  it("searches literal metacharacters with case and include controls", async () => {
    const literal = await grepAttachments(files, {
      pattern: "[literal]",
      ignoreCase: true,
      literal: true,
    });
    expect(literal.content).toContain("notes.md");
    expect(literal.meta.matchCount).toBe(1);

    const jsonOnly = await grepAttachments(files, {
      pattern: "needle",
      include: "*.json",
      ignoreCase: true,
    });
    expect(jsonOnly.content).toContain("data.json");
    expect(jsonOnly.content).not.toContain("notes.md");

    const caseSensitive = await grepAttachments(files, {
      pattern: "Needle",
      ignoreCase: false,
    });
    expect(caseSensitive.meta.matchCount).toBe(1);
    expect(caseSensitive.content).toContain("data.json");
  });

  it("deduplicates overlapping context lines", async () => {
    const adjacent = attachment("a8", "adjacent.md", "hit\nhit\nend");
    const result = await grepAttachments([adjacent], {
      pattern: "hit",
      context: 1,
    });
    expect(result.content.match(/ {2}1[:-]/g)).toHaveLength(1);
    expect(result.content.match(/ {2}2[:-]/g)).toHaveLength(1);
  });

  it("uses regex by default and preserves an explicit literal fallback", async () => {
    const regexSearch = async (selected, options) => {
      const { scanRegexFiles } = await import("../lib/regex-search-core.js");
      return scanRegexFiles(selected.map(file => ({
        attachmentId: file.id,
        path: file.virtualPath,
        content: file.content,
      })), options);
    };
    const regex = await grepAttachments(files, {
      pattern: "^needle\\s+\\[literal\\]$",
      ignoreCase: true,
      regexSearch,
    });
    expect(regex.meta).toMatchObject({ literal: false, matchCount: 1 });
    expect(regex.content).toContain("regex matches");

    const literal = await grepAttachments(files, {
      pattern: "^needle",
      literal: true,
    });
    expect(literal.meta).toMatchObject({ literal: true, matchCount: 0 });
    expect(literal.content).toContain("No literal matches");
  });

  it("honors an aborted search signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(grepAttachments(files, {
      pattern: "needle",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates simple include filters", () => {
    expect(compileIncludeFilter("*.md")(files[0])).toBe(true);
    expect(compileIncludeFilter("*.{md,json}")(files[1])).toBe(true);
    expect(() => compileIncludeFilter("src/**")).toThrow(/Unsupported/);
  });

  it("builds model-specific local tool factories", async () => {
    const tools = createLocalFileTools(files, "bonsai27b");
    expect(tools.map(tool => tool.name)).toEqual(["read", "grep"]);
    expect(tools[0].promptPolicy.join("\n")).toContain("Files available");
    expect(localFileToolBudget("bonsai27b").readBytes).toBe(4096);
    const result = await tools[1].execute({ pattern: "needle", include: "*.md" });
    expect(result.meta.resultCount).toBe(1);
  });

  it("deduplicates grep calls by search mode as well as pattern", async () => {
    const grep = createLocalFileTools(files, "gemma4", { readEnabled: false })[0];
    const regex = await grep.execute({ pattern: "^needle", include: "*.md" });
    const literal = await grep.execute({
      pattern: "^needle",
      include: "*.md",
      literal: true,
    });
    const duplicateLiteral = await grep.execute({
      pattern: "^needle",
      include: "*.md",
      literal: true,
    });

    expect(regex.meta).toMatchObject({ status: "ok", literal: false, resultCount: 1 });
    expect(literal.meta).toMatchObject({ status: "ok", literal: true, resultCount: 0 });
    expect(duplicateLiteral.meta).toMatchObject({ status: "skipped", literal: true });
  });

  it("infers an omitted read path only for a single-file workspace", async () => {
    const singleRead = createLocalFileTools([files[0]], "gemma4", {
      grepEnabled: false,
    })[0];
    const inferred = await singleRead.execute({ offset: 2, limit: 1 });
    expect(inferred.content).toContain("2: needle [literal]");
    expect(inferred.meta.path).toBe("notes.md");
    expect(inferred.meta.pathInferred).toBe(true);

    const aliased = await createLocalFileTools([files[0]], "gemma4", {
      grepEnabled: false,
    })[0].execute({ filename: "notes.md", offset: 1, limit: 1 });
    expect(aliased.meta.pathInferred).toBe(false);

    const multipleRead = createLocalFileTools(files, "gemma4", {
      grepEnabled: false,
    })[0];
    await expect(multipleRead.execute({ offset: 2, limit: 1 }))
      .rejects.toThrow(/multiple files/);
  });

  it("selectively registers read and grep while keeping matching prompt policy", () => {
    const readOnly = createLocalFileTools(files, "gemma4", { grepEnabled: false });
    const grepOnly = createLocalFileTools(files, "gemma4", { readEnabled: false });
    expect(readOnly.map(tool => tool.name)).toEqual(["read"]);
    expect(readOnly[0].promptPolicy.join("\n")).toContain("Use read only");
    expect(grepOnly.map(tool => tool.name)).toEqual(["grep"]);
    expect(grepOnly[0].promptPolicy.join("\n")).toContain("Use grep only");
    expect(createLocalFileTools(files, "gemma4", {
      readEnabled: false,
      grepEnabled: false,
    })).toEqual([]);
  });

  it("keeps read and grep results within every model byte budget", async () => {
    const large = attachment(
      "a9",
      "large.md",
      Array.from({ length: 300 }, (_, index) => `needle ${index} ${"😀".repeat(80)}`).join("\n"),
    );
    for (const modelId of ["gemma4", "bonsai27b", "lfm2", "lfm2_350"]) {
      const [read, grep] = createLocalFileTools([large], modelId);
      const budget = localFileToolBudget(modelId);
      const readResult = await read.execute({ path: "large.md" });
      const grepResult = await grep.execute({ pattern: "needle", context: 1 });
      expect(new TextEncoder().encode(readResult.content).byteLength)
        .toBeLessThanOrEqual(budget.readBytes);
      expect(new TextEncoder().encode(grepResult.content).byteLength)
        .toBeLessThanOrEqual(budget.grepBytes);
    }
  });

  it("defaults Gemma reads to 100 lines while allowing explicit pagination sizes", async () => {
    const large = attachment(
      "a10",
      "short-lines.md",
      Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join("\n"),
    );
    const read = createLocalFileTools([large], "gemma4", { grepEnabled: false })[0];
    const defaultRange = await read.execute({ path: "short-lines.md" });
    const explicitRange = await read.execute({ path: "short-lines.md", limit: 120 });

    expect(localFileToolBudget("gemma4").readLines).toBe(100);
    expect(defaultRange.meta).toMatchObject({ lineStart: 1, lineEnd: 100, nextOffset: 101 });
    expect(explicitRange.meta).toMatchObject({ lineStart: 1, lineEnd: 120, nextOffset: 121 });
  });

  it("preserves request order for parallel reads", async () => {
    const read = createLocalFileTools(files, "gemma4", { grepEnabled: false })[0];
    const results = await Promise.all([
      read.execute({ path: "notes.md", offset: 2, limit: 1 }),
      read.execute({ path: "data.json", offset: 1, limit: 1 }),
    ]);
    expect(results[0].content).toContain("notes.md");
    expect(results[1].content).toContain("data.json");
  });
});

describe("file context", () => {
  it("creates a metadata-only workspace manifest", () => {
    const manifest = buildFileManifest(files);
    expect(manifest).toContain("notes.md");
    expect(manifest).toContain("3 lines");
    expect(manifest).not.toContain("Alpha");
    expect(manifest).not.toContain("needle [literal]");
  });

  it("bounds referenced excerpts and sanitizes control tokens", () => {
    const hostile = attachment(
      "a3",
      "hostile.md",
      `<|tool_call_start|>\n${"safe line\n".repeat(500)}`,
    );
    const excerpt = buildReferencedFileContext(["a3"], [hostile], "bonsai27b");
    expect(new TextEncoder().encode(excerpt).byteLength).toBeLessThanOrEqual(1024);
    expect(excerpt).not.toContain("<|tool_call_start|>");
    expect(excerpt).toContain("Use read");
  });

  it("shares a referenced-file budget without dropping later files", () => {
    const first = attachment("a4", "first.md", "one\n".repeat(1000));
    const second = attachment("a5", "second.md", "two\n".repeat(1000));
    const excerpt = buildReferencedFileContext(["a4", "a5"], [first, second], "bonsai27b");
    expect(excerpt).toContain("[Referenced file: first.md]");
    expect(excerpt).toContain("[Referenced file: second.md]");
    expect(new TextEncoder().encode(excerpt).byteLength).toBeLessThanOrEqual(1024);
  });

  it("expands only at the model boundary without mutating messages", () => {
    const messages = [{ role: "user", content: "Use @notes.md", fileRefs: ["a1", "gone"] }];
    const expanded = expandFileReferences(messages, files, "gemma4");
    expect(expanded[0].content).toContain("[Referenced file: notes.md]");
    expect(messages[0].content).toBe("Use @notes.md");
  });
});

describe("@file references", () => {
  it("fuzzy-matches and replaces the active @ query", () => {
    expect(fuzzyMatchAttachments(files, "nt")[0].id).toBe("a1");
    const range = findAtFileQuery("Explain @not", 12);
    expect(range).toMatchObject({ query: "not", start: 8 });
    expect(replaceAtFileQuery("Explain @not", range, "notes.md"))
      .toEqual({ value: "Explain @notes.md", caret: 17 });
    expect(findAtFileQuery("Email person@example.com", 24)).toBeNull();
  });

  it("recognizes exact paths with unambiguous token boundaries", () => {
    expect(exactFileRefsInText("Compare @notes.md and @DATA.JSON.", files))
      .toEqual(["a1", "a2"]);
    const sourceFiles = [
      attachment("a6", "foo.js", "one", ".js"),
      attachment("a7", "foo.js.txt", "two", ".txt"),
    ];
    expect(exactFileRefsInText("Review @foo.js.txt", sourceFiles)).toEqual(["a7"]);
    expect(exactFileRefsInText("Email person@notes.md", files)).toEqual([]);
    expect(findFileMentions("(@notes.md).", files)).toEqual([{
      id: "a1",
      virtualPath: "notes.md",
      start: 1,
      end: 10,
    }]);
    expect(mergeFileRefs(["a1"], new Set(["a1", "a2"]))).toEqual(["a1", "a2"]);
  });

  it("uses explicit selected references and never auto-attaches plain text", () => {
    expect(resolveDraftFileRefs({
      text: "Compare @notes.md with @data.json",
      attachments: files,
    })).toEqual([]);
    expect(resolveDraftFileRefs({
      pendingRefs: new Set(["a2"]),
      text: "Compare @notes.md with @data.json",
      attachments: files,
    })).toEqual(["a2"]);
    expect(resolveDraftFileRefs({
      pendingRefs: new Set(["a1"]),
      text: "Compare without the selected mention",
      attachments: files,
    })).toEqual([]);
    expect(reconcileSelectedFileRefs(
      [],
      "Unrelated edit keeps plain @notes.md detached",
      files,
    )).toEqual([]);
  });
});
