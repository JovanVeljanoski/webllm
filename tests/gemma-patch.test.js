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
    expect(src).toContain(INLINE_STOP_TOOL_FN.trim());
    expect(src).toContain("rawText:p");
  });

  it("stops early on complete tool_call suffix", () => {
    expect(src).toMatch(/_wllmStopNames&&/);
    expect(src).toMatch(/_wllmStopTool\(p,_wllmStopNames\)/);
  });

  it("forwards abort signals into prefill and exits before generation", () => {
    expect(src).toContain("if(r.signal?.aborted)return");
    expect(src).toContain("signal:r.signal,onPrefillDone");
  });

  it("inline stop scanner source is valid JavaScript", () => {
    expect(() => new Function(INLINE_STOP_TOOL_FN)).not.toThrow();
  });

  it("inline scanner handles query arrays and thought channels", () => {
    const stop = new Function(`${INLINE_STOP_TOOL_FN}; return _wllmStopTool;`)();
    const call =
      '<|tool_call>call:web_search{queries:[<|"|>one<|"|>,<|"|>two<|"|>]}<tool_call|>';
    expect(stop(call, ["web_search"])).toBe(true);
    expect(stop(`<|think|>${call}`, ["web_search"])).toBe(false);
    expect(stop(`<|think|>draft<channel|>${call}`, ["web_search"])).toBe(true);
    expect(stop(call.slice(0, call.indexOf("]}") + 1), ["web_search"])).toBe(false);
  });

  it("inline scanner stops arbitrary declared tools regardless of argument names", () => {
    const stop = new Function(`${INLINE_STOP_TOOL_FN}; return _wllmStopTool;`)();
    expect(stop('call:calculator{expression:<|"|>2+2<|"|>}', ["calculator"]))
      .toBe(true);
    expect(stop('call:lookup{key:<|"|>x<|"|>}', ["lookup"])).toBe(true);
  });
});
