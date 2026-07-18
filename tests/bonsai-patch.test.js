import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BONSAI_INLINE_STOP_TOOL_FN } from "../scripts/bonsai-tool-stop-inline.mjs";

const bundlePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "bonsai-27b.js",
);

describe("bonsai runtime patch", () => {
  it("preserves control tokens and exposes rawText in generate chunks", () => {
    const source = fs.readFileSync(bundlePath, "utf8");
    expect(source).toContain("let m=!n.preserveControlTokens");
    expect(source).toContain("skip_special_tokens:m");
    expect(source).toContain("rawText:o");
    expect(source).toContain("this._agentTools=n.tools??null");
    expect(source).toContain("function _wllmBonsaiStopTool(");
    expect(source).toContain("JSON.parse(v);return!0");
    expect(source).toContain("tools:this._agentTools??null");
    expect(source).toContain('yield{phase:"prefill",status:"start"');
    expect(source).toContain('yield{phase:"prefill",status:"done"');
    expect(source).toContain("onPrefillDone:n.onPrefillDone");
    expect(source).toContain("cachedTokens:f");
    expect(source).toContain("globalThis.Bonsai27B = di");
    expect(source).not.toContain("export{di as Bonsai27B");
  });

  it("stops on canonical and wrapperless complete tool calls", () => {
    const stopTool = Function(
      `"use strict";${BONSAI_INLINE_STOP_TOOL_FN};return _wllmBonsaiStopTool;`,
    )();
    const names = ["web_search"];

    expect(stopTool(
      "<tool_call><function=web_search><parameter=queries>[\"news\"]"
        + "</parameter></tool_call>",
      names,
    )).toBe(true);
    expect(stopTool(
      "<function=web_search>\n<parameter=queries>\n[\"news\"]",
      names,
    )).toBe(true);
    expect(stopTool(
      "<function=web_search>\n<parameter=queries>\n[\"news\"",
      names,
    )).toBe(false);
    expect(stopTool(
      "<think><function=web_search><parameter=queries>[\"news\"]",
      names,
    )).toBe(false);
  });
});
