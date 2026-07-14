/** @file Shared constants for WebLLM (browser + tests). */

export const DB_NAME = "webllm-sessions";
export const DB_VERSION = 1;
export const STORE = "sessions";

export const PREFS_KEY = "webllm:prefs";
export const THEME_KEY = "webllm:theme";

export const GEMMA_REVISION = "65707b8733090dda89f84735f1a1452e7b025f86";
export const GEMMA_HUB_ID = "google/gemma-4-E2B-it-qat-mobile-transformers";

export const ASSISTANT_LABEL = "Assistant";
export const APP_VERSION = "0.0.5";
export const DEFAULT_MODEL_ID = "gemma4";
export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

export const BROWSER_LABELS = {
  chrome: "Chrome",
  edge: "Edge",
  safari: "Safari",
  firefox: "Firefox",
  other: "this browser",
};

export const LOAD_PHASE = {
  init: [0, 0.02],
  tokenizer: [0.02, 0.05],
  weights: [0.05, 1.0],
  ready: [1, 1],
};
