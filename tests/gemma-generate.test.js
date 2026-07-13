import { describe, expect, it } from "vitest";
import { generateToCompletion } from "../lib/gemma-generate.js";
import { GenerationTracker } from "../lib/generation-tracker.js";

describe("generateToCompletion", () => {
  it("collects the runtime stream without duplicate host-side stopping", async () => {
    const chunks = [
      "call:web_search{query:",
      "latest NBA trades}",
    ];
    let i = 0;
    const model = {
      generate() {
        return (async function* () {
          let acc = "";
          while (i < chunks.length) {
            acc += chunks[i++];
            yield { text: acc, rawText: acc };
          }
        })();
      },
    };

    const { rawText, tokens } = await generateToCompletion(
      model,
      [{ role: "user", content: "hi" }],
      { stopOnToolCall: true },
    );

    expect(tokens).toBe(2);
    expect(rawText).toBe("call:web_search{query:latest NBA trades}");
  });

  it("forwards prefill chunks without counting as decode tokens", async () => {
    const model = {
      generate() {
        return (async function* () {
          yield { phase: "prefill", status: "start", prefillTokens: 10 };
          yield { phase: "prefill", status: "done", prefillTokens: 10 };
          yield { text: "Hi", rawText: "Hi", phase: "decode" };
        })();
      },
    };
    const tracker = new GenerationTracker();
    const seen = [];
    const { tokens, metrics } = await generateToCompletion(
      model,
      [{ role: "user", content: "hi" }],
      { tracker },
      (chunk) => seen.push(chunk.phase || "decode"),
    );
    expect(seen).toEqual(["prefill", "prefill", "decode"]);
    expect(tokens).toBe(1);
    expect(metrics?.prefillTokens).toBe(10);
  });
});
