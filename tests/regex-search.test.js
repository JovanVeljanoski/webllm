import { describe, expect, it, vi } from "vitest";
import { scanRegexFiles } from "../lib/regex-search-core.js";
import { searchRegexInWorker } from "../lib/regex-search.js";

const files = [{
  attachmentId: "a1",
  path: "notes.md",
  content: "alpha 123\nBeta 456\nliteral [value]",
}];

describe("safe regex search", () => {
  it("matches regex syntax, paths, case controls, and limits", () => {
    const insensitive = scanRegexFiles(files, {
      pattern: "^(alpha|beta)\\s+\\d+$",
      ignoreCase: true,
      limit: 10,
    });
    expect(insensitive.matches.map(match => match.line)).toEqual([1, 2]);

    const sensitive = scanRegexFiles(files, {
      pattern: "^beta",
      ignoreCase: false,
      limit: 10,
    });
    expect(sensitive.matches).toEqual([]);

    const pathAndOneLine = scanRegexFiles(files, {
      pattern: "notes|\\d+",
      limit: 2,
    });
    expect(pathAndOneLine.matches.map(match => match.line)).toEqual([0, 1]);
    expect(pathAndOneLine.hasMore).toBe(true);
  });

  it("returns actionable errors for invalid expressions", () => {
    expect(() => scanRegexFiles(files, { pattern: "(unclosed" }))
      .toThrow(/Invalid regular expression.*literal=true/);
  });

  it("terminates a worker that exceeds the regex deadline", async () => {
    const terminate = vi.fn();
    const workerFactory = () => ({
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate,
    });

    await expect(searchRegexInWorker([], {
      pattern: "(a+)+$",
      timeoutMs: 5,
      workerFactory,
    })).rejects.toThrow(/timed out.*literal=true/);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("terminates the worker when execution is aborted", async () => {
    const terminate = vi.fn();
    const controller = new AbortController();
    const workerFactory = () => ({
      onmessage: null,
      onerror: null,
      postMessage() {
        controller.abort();
      },
      terminate,
    });

    await expect(searchRegexInWorker(files, {
      pattern: "alpha",
      signal: controller.signal,
      workerFactory,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledOnce();
  });
});
