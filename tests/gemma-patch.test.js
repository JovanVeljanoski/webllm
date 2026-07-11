import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { INLINE_STOP_TOOL_FN } from "../scripts/tool-call-stop-inline.mjs";

const BUNDLE = path.join(process.cwd(), "gemma-4-e2b.js");

describe("gemma-4-e2b.js tool patch", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");

  it("passes tools into chat template render", () => {
    expect(src).toContain("tools:this._agentTools??null");
    expect(src).not.toContain("tools:null,bos_token");
  });

  it("supports preserveControlTokens, stopMode, and brace-aware stop scanner", () => {
    expect(src).toContain("_preserveControlTokens=!!r.preserveControlTokens");
    expect(src).toContain("_stopMode=r.stopMode??null");
    expect(src).toContain("_wllmStopTool");
    expect(src).toContain("rawText:p");
  });

  it("stops early on complete tool_call suffix", () => {
    expect(src).toMatch(/_wllmStopNames&&/);
    expect(src).toMatch(/_wllmStopTool\(p,_wllmStopNames\)/);
  });

  it("inline stop scanner source is valid JavaScript", () => {
    expect(() => new Function(INLINE_STOP_TOOL_FN)).not.toThrow();
  });
});
