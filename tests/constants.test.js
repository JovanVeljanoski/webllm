import { describe, expect, it } from "vitest";
import {
  DB_NAME,
  PREFS_KEY,
  THEME_KEY,
} from "../lib/constants.js";
import { MODELS } from "../lib/models.js";

describe("storage naming cleanup", () => {
  it("uses webllm-prefixed session and prefs keys", () => {
    expect(DB_NAME).toBe("webllm-sessions");
    expect(PREFS_KEY).toBe("webllm:prefs");
    expect(THEME_KEY).toBe("webllm:theme");
  });

  it("uses consistent webllm model cache names", () => {
    expect(MODELS.gemma4.cacheName).toBe("webllm-gemma4-v1");
    expect(MODELS.lfm2.cacheName).toBe("webllm-lfm2-v1");
    expect(MODELS.lfm2_350.cacheName).toBe("webllm-lfm2-350m-v1");
  });
});
