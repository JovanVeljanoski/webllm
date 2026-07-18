import { describe, expect, it } from "vitest";
import { generateToCompletion } from "../lib/bonsai-generate.js";
import { GenerationTracker } from "../lib/generation-tracker.js";

describe("bonsai generateToCompletion", () => {
  it("collects rawText and counts decode tokens", async () => {
    const model = {
      async *generate() {
        yield { text: "hel", rawText: "hel", phase: "decode" };
        yield { text: "hello", rawText: "hello", phase: "decode" };
      },
    };

    const result = await generateToCompletion(model, [{ role: "user", content: "hi" }], {});
    expect(result.rawText).toBe("hello");
    expect(result.tokens).toBe(2);
  });

  it("does not count prefill chunks as decode tokens", async () => {
    const model = {
      async *generate() {
        yield { phase: "prefill", status: "start", prefillTokens: 3 };
        yield { phase: "prefill", status: "done", prefillTokens: 3 };
        yield { text: "ok", rawText: "ok", phase: "decode" };
      },
    };

    const result = await generateToCompletion(model, [{ role: "user", content: "hi" }], {});
    expect(result.tokens).toBe(1);
    expect(result.rawText).toBe("ok");
  });

  it("records Bonsai prefill and cache metrics", async () => {
    const model = {
      async *generate() {
        yield {
          phase: "prefill",
          status: "start",
          prefillTokens: 30,
          promptTokens: 50,
          cachedTokens: 20,
        };
        yield { phase: "prefill", status: "done", prefillTokens: 30 };
        yield { text: "ok", rawText: "ok", phase: "decode" };
      },
    };
    const tracker = new GenerationTracker();
    const result = await generateToCompletion(
      model,
      [{ role: "user", content: "hi" }],
      { tracker },
    );

    expect(result.metrics).toMatchObject({
      prefillTokens: 30,
      cachedTokens: 20,
      promptTokens: 50,
      tokens: 1,
    });
  });
});
