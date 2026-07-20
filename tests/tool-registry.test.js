import { describe, expect, it } from "vitest";
import {
  activeToolNames,
  createActiveTools,
  localFileReferencesAvailable,
  resolveToolAvailability,
} from "../lib/tool-registry.js";

const attachments = [{
  id: "a1",
  virtualPath: "notes.md",
  extension: ".md",
  category: "plain_text",
  content: "evidence",
  lineCount: 1,
  storedBytes: 8,
}];

describe("active tool registry", () => {
  it("builds one ordered tool set from active capabilities", () => {
    const tools = createActiveTools({
      attachments,
      modelId: "gemma4",
      readEnabled: true,
      grepEnabled: true,
      webSearchEnabled: true,
      searchProvider: { search: async () => ({ results: [] }) },
    });

    expect(activeToolNames(tools)).toEqual(["read", "grep", "web_search"]);
  });

  it("omits unavailable local tools and requires an active search provider", () => {
    expect(createActiveTools({
      modelId: "gemma4",
      readEnabled: true,
      grepEnabled: true,
    })).toEqual([]);
    expect(() => createActiveTools({
      modelId: "gemma4",
      webSearchEnabled: true,
    })).toThrow(/search provider/);
  });

  it("resolves preferences, grammar conflicts, runtime state, and references once", () => {
    const prepared = resolveToolAvailability({
      attachments,
      preferences: { read: true, grep: false, web_search: true },
      runtimeReady: false,
    });
    expect(prepared.find(tool => tool.id === "read")).toMatchObject({
      preferred: true,
      available: true,
      active: false,
      reason: "runtime_unavailable",
    });
    expect(localFileReferencesAvailable(prepared)).toBe(true);

    const grammarBlocked = resolveToolAvailability({
      attachments,
      preferences: { read: true },
      grammarMode: "json",
    });
    expect(grammarBlocked.find(tool => tool.id === "read")).toMatchObject({
      available: false,
      active: false,
      reason: "grammar_active",
    });
    expect(localFileReferencesAvailable(grammarBlocked)).toBe(false);

    const webOnly = resolveToolAvailability({
      attachments,
      preferences: { web_search: true },
    });
    expect(localFileReferencesAvailable(webOnly)).toBe(false);
  });
});
