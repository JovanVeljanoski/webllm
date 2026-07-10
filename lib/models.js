/** @file Model registry and model-selection helpers. */

import { DEFAULT_MODEL_ID, GEMMA_HUB_ID, GEMMA_REVISION } from "./constants.js";

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
    supportsThinking: true,
  },
  lfm2: {
    id: "lfm2",
    name: "LFM2.5 230M",
    subtitle: "Liquid AI · ~150 MB · fastest",
    runtime: "lfm2",
    hubId: "LiquidAI/LFM2.5-230M-GGUF",
    revision: "main",
    cacheName: "webllm-lfm2-v1",
    cacheType: "gguf",
    downloadHint: "~150 MB",
    declaredBytes: 153_000_000,
    supportsThinking: false,
  },
  lfm2_350: {
    id: "lfm2_350",
    name: "LFM2.5 350M",
    subtitle: "Liquid AI · ~220 MB · balanced",
    runtime: "lfm2",
    hubId: "LiquidAI/LFM2.5-350M-GGUF",
    revision: "main",
    cacheName: "webllm-lfm2-350m-v1",
    cacheType: "gguf",
    downloadHint: "~220 MB",
    declaredBytes: 219_000_000,
    supportsThinking: false,
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
