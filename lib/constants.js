/** @file Shared constants for WebLLM (browser + tests). */

export const DB_NAME = "webllm-sessions";
export const DB_VERSION = 2;
export const STORE = "sessions";
export const ATTACHMENTS_STORE = "attachments";
export const ATTACHMENTS_SESSION_INDEX = "sessionId";

export const PREFS_KEY = "webllm:prefs";
export const THEME_KEY = "webllm:theme";

export const GEMMA_REVISION = "65707b8733090dda89f84735f1a1452e7b025f86";
export const GEMMA_HUB_ID = "google/gemma-4-E2B-it-qat-mobile-transformers";

/** Pinned commit of webml-community/bonsai-webgpu-kernels (runtime bundle only). */
export const BONSAI_SPACE_REVISION = "baf1a20b9fc7e12da1787764ede3abd5760ff188";
export const BONSAI_HUB_ID = "prism-ml/Bonsai-27B-gguf";
export const BONSAI_GGUF_FILE = "Bonsai-27B-Q1_0.gguf";
/** GGUF weights revision — use main; Space revision is not valid on the weights repo. */
export const BONSAI_WEIGHTS_REVISION = "main";
/** Matches Bonsai27B runtime default (Qd=4096); HF demo uses the same cap. */
export const BONSAI_CONTEXT_TOKENS = 4096;

export const ASSISTANT_LABEL = "Assistant";
export const APP_VERSION = "0.0.6";
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
