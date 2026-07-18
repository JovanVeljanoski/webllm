import { describe, expect, it } from "vitest";
import {
  MODELS,
  activeModelDef,
  loadedModelDef,
  modelLabel,
  modelSupportsThinking,
  resolveModelIdForSession,
  sessionModelId,
} from "../lib/models.js";
import { BONSAI_CONTEXT_TOKENS, DEFAULT_MODEL_ID } from "../lib/constants.js";

describe("model registry", () => {
  it("uses webllm-prefixed gemma cache name", () => {
    expect(MODELS.gemma4.cacheName).toBe("webllm-gemma4-v1");
  });

  it("resolves active and loaded model defs", () => {
    expect(activeModelDef("lfm2").id).toBe("lfm2");
    expect(activeModelDef("missing").id).toBe(DEFAULT_MODEL_ID);
    expect(loadedModelDef("lfm2_350")?.id).toBe("lfm2_350");
    expect(loadedModelDef(null)).toBeNull();
  });

  it("resolves session model with fallback", () => {
    const session = { modelId: "lfm2", messages: [] };
    expect(sessionModelId(session)).toBe("lfm2");
    expect(sessionModelId({ modelId: "bogus" })).toBeNull();
    expect(resolveModelIdForSession(session, "gemma4")).toBe("lfm2");
    expect(resolveModelIdForSession({ messages: [] }, "lfm2_350")).toBe("lfm2_350");
    expect(resolveModelIdForSession({ messages: [] }, "bogus")).toBe(DEFAULT_MODEL_ID);
  });

  it("labels models and thinking support", () => {
    expect(modelLabel("lfm2")).toBe("LFM2.5 230M");
    expect(modelLabel("bogus")).toBe("Gemma 4 E2B");
    expect(modelSupportsThinking("gemma4", "lfm2")).toBe(true);
    expect(modelSupportsThinking("lfm2", "lfm2")).toBe(false);
    expect(modelSupportsThinking(null, "gemma4")).toBe(true);
    expect(modelSupportsThinking(null, "lfm2")).toBe(false);
  });

  it("enables tools on every supported chat runtime", () => {
    expect(MODELS.gemma4.supportsTools).toBe(true);
    expect(MODELS.lfm2.supportsTools).toBe(true);
    expect(MODELS.lfm2_350.supportsTools).toBe(true);
  });

  it("declares each runtime context window in tokens", () => {
    expect(MODELS.gemma4.contextWindowTokens).toBe(131_072);
    expect(MODELS.bonsai27b.contextWindowTokens).toBe(BONSAI_CONTEXT_TOKENS);
    expect(MODELS.lfm2.contextWindowTokens).toBe(128_000);
    expect(MODELS.lfm2_350.contextWindowTokens).toBe(128_000);
  });

  it("registers Bonsai below Gemma and above LFM models", () => {
    const ids = Object.keys(MODELS);
    expect(ids.indexOf("gemma4")).toBeLessThan(ids.indexOf("bonsai27b"));
    expect(ids.indexOf("bonsai27b")).toBeLessThan(ids.indexOf("lfm2"));
    expect(MODELS.bonsai27b).toMatchObject({
      runtime: "bonsai",
      cacheType: "gguf",
      revision: "main",
      supportsThinking: false,
      supportsTools: true,
      cacheName: "webllm-bonsai27b-v1",
    });
  });
});
