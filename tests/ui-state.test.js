import { describe, expect, it } from "vitest";
import {
  clampMaxNewTokens,
  formatAllModelsCacheStatus,
  isCacheCapable,
  loadButtonLabel,
} from "../lib/ui-state.js";
import { MODELS } from "../lib/models.js";

describe("loadButtonLabel", () => {
  it("reflects model and cache state", () => {
    expect(loadButtonLabel({ model: null, loading: false, modelCached: false, fileOrigin: false, isHero: false }))
      .toBe("Load model");
    expect(loadButtonLabel({ model: {}, loading: false, modelCached: false, fileOrigin: false, isHero: false }))
      .toBe("Model ready");
    expect(loadButtonLabel({ model: null, loading: true, modelCached: false, fileOrigin: false, isHero: false }))
      .toBe("Loading…");
    expect(loadButtonLabel({ model: null, loading: false, modelCached: true, fileOrigin: false, isHero: true }))
      .toBe("Start");
  });
});

describe("formatAllModelsCacheStatus", () => {
  it("formats empty, partial, and full cache states", () => {
    expect(formatAllModelsCacheStatus({ modelCount: 0, stored: 0, declared: null }))
      .toBe("No models cached yet");
    expect(formatAllModelsCacheStatus({ modelCount: 2, stored: 1024, declared: null }))
      .toBe("Cached · ~1.0 KB from 2 models");
    expect(formatAllModelsCacheStatus({ modelCount: 1, stored: 100, declared: 1000 }))
      .toBe("Cached · ~100 B from 1 model (~1000 B total)");
  });
});

describe("isCacheCapable", () => {
  it("requires https-like origin and storage APIs", () => {
    expect(isCacheCapable({ fileOrigin: true, caches: {}, indexedDB: {}, models: MODELS })).toBe(false);
    expect(isCacheCapable({ fileOrigin: false, caches: null, indexedDB: {}, models: MODELS })).toBe(false);
    expect(isCacheCapable({ fileOrigin: false, caches: {}, indexedDB: {}, models: MODELS })).toBe(true);
  });
});

describe("clampMaxNewTokens", () => {
  it("clamps and falls back", () => {
    expect(clampMaxNewTokens("99999")).toBe(8192);
    expect(clampMaxNewTokens("10")).toBe(64);
    expect(clampMaxNewTokens("nope")).toBe(4096);
  });
});
