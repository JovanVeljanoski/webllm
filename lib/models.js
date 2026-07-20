/** @file Model registry and model-selection helpers. */

import {
  DEFAULT_MODEL_ID,
  GEMMA_HUB_ID,
  GEMMA_REVISION,
  BONSAI_HUB_ID,
  BONSAI_GGUF_FILE,
  BONSAI_CONTEXT_TOKENS,
  BONSAI_WEIGHTS_REVISION,
} from "./constants.js";

const DEFAULT_LOCAL_FILE_CONFIG = Object.freeze({
  excerptBytes: 4 * 1024,
  readLines: 100,
  readBytes: 4 * 1024,
  grepMatches: 10,
  grepBytes: 3 * 1024,
});

const LFM_LOCAL_FILE_CONFIG = Object.freeze({
  excerptBytes: 4 * 1024,
  readLines: 160,
  readBytes: 8 * 1024,
  grepMatches: 20,
  grepBytes: 6 * 1024,
});

export const MODELS = {
  gemma4: {
    id: "gemma4",
    name: "Gemma 4 E2B",
    subtitle: "Google · ~2.5 GB · thinking",
    runtime: "gemma",
    hubId: GEMMA_HUB_ID,
    revision: GEMMA_REVISION,
    cacheName: "webllm-gemma4-v1",
    cacheType: "safetensors",
    metaUrl: `https://huggingface.co/${GEMMA_HUB_ID}/resolve/${GEMMA_REVISION}/model.safetensors`,
    downloadHint: "~2.5 GB",
    declaredBytes: 2_458_111_846,
    contextWindowTokens: 131_072,
    supportsThinking: true,
    supportsTools: true,
    localFiles: {
      excerptBytes: 8 * 1024,
      readLines: 100,
      readBytes: 24 * 1024,
      grepMatches: 50,
      grepBytes: 12 * 1024,
    },
  },
  bonsai27b: {
    id: "bonsai27b",
    name: "Bonsai 27B",
    subtitle: "Prism ML · ~3.9 GB · 4K ctx",
    runtime: "bonsai",
    hubId: BONSAI_HUB_ID,
    ggufFile: BONSAI_GGUF_FILE,
    revision: BONSAI_WEIGHTS_REVISION,
    cacheName: "webllm-bonsai27b-v1",
    cacheType: "gguf",
    downloadHint: "~3.9 GB",
    declaredBytes: 3_900_000_000,
    contextWindowTokens: BONSAI_CONTEXT_TOKENS,
    defaultMaxNewTokens: 1024,
    supportsThinking: false,
    supportsTools: true,
    localFiles: {
      excerptBytes: 1024,
      readLines: 100,
      readBytes: 4 * 1024,
      grepMatches: 10,
      grepBytes: 3 * 1024,
    },
  },
  lfm2: {
    id: "lfm2",
    name: "LFM2.5 230M",
    subtitle: "Liquid AI · ~150 MB",
    runtime: "lfm2",
    hubId: "LiquidAI/LFM2.5-230M-GGUF",
    revision: "main",
    cacheName: "webllm-lfm2-v1",
    cacheType: "gguf",
    downloadHint: "~150 MB",
    declaredBytes: 153_000_000,
    contextWindowTokens: 128_000,
    supportsThinking: false,
    supportsTools: true,
    localFiles: LFM_LOCAL_FILE_CONFIG,
  },
  lfm2_350: {
    id: "lfm2_350",
    name: "LFM2.5 350M",
    subtitle: "Liquid AI · ~220 MB",
    runtime: "lfm2",
    hubId: "LiquidAI/LFM2.5-350M-GGUF",
    revision: "main",
    cacheName: "webllm-lfm2-350m-v1",
    cacheType: "gguf",
    downloadHint: "~220 MB",
    declaredBytes: 219_000_000,
    contextWindowTokens: 128_000,
    supportsThinking: false,
    supportsTools: true,
    localFiles: LFM_LOCAL_FILE_CONFIG,
  },
};

export function activeModelDef(selectedModelId, models = MODELS) {
  return models[selectedModelId] || models[DEFAULT_MODEL_ID];
}

export function loadedModelDef(loadedModelId, models = MODELS) {
  return loadedModelId ? models[loadedModelId] : null;
}

export function sessionModelId(session, models = MODELS) {
  return session?.modelId && models[session.modelId] ? session.modelId : null;
}

export function resolveModelIdForSession(session, selectedModelId, models = MODELS) {
  return sessionModelId(session, models)
    || (models[selectedModelId] ? selectedModelId : DEFAULT_MODEL_ID);
}

export function modelLabel(modelId, models = MODELS) {
  return models[modelId]?.name || models[DEFAULT_MODEL_ID].name;
}

export function modelSupportsThinking(loadedModelId, selectedModelId, models = MODELS) {
  const def = loadedModelDef(loadedModelId, models) || activeModelDef(selectedModelId, models);
  return !!def?.supportsThinking;
}

export function isValidModelId(modelId, models = MODELS) {
  return !!models[modelId];
}

export function modelLocalFileConfig(modelId, models = MODELS) {
  return models[modelId]?.localFiles || DEFAULT_LOCAL_FILE_CONFIG;
}
