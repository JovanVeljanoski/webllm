/** @file Central registry for runtime loading and generation behavior. */

import {
  countGemmaPromptTokens,
  generateGemmaAssistant,
  GEMMA_TOOL_PROTOCOL,
} from "./gemma-adapter.js";
import {
  countBonsaiPromptTokens,
  generateBonsaiAssistant,
  applyBonsaiChatTemplate,
  BONSAI_TOOL_PROTOCOL,
} from "./bonsai-adapter.js";
import {
  countLfmPromptTokens,
  generateLfmAssistant,
  LFM_TOOL_PROTOCOL,
} from "./lfm-adapter.js";

let gemmaScriptPromise = null;
let bonsaiScriptPromise = null;
let lfmRuntimePromise = null;

async function loadGemmaRuntime() {
  if (typeof globalThis.Gemma4Mobile === "function") {
    return globalThis.Gemma4Mobile;
  }
  if (!gemmaScriptPromise) {
    gemmaScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "gemma-4-e2b.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load Gemma runtime"));
      document.head.appendChild(script);
    })
      .then(() => {
        if (typeof globalThis.Gemma4Mobile !== "function") {
          throw new Error("Gemma runtime did not register Gemma4Mobile");
        }
        return globalThis.Gemma4Mobile;
      })
      .catch(error => {
        gemmaScriptPromise = null;
        throw error;
      });
  }
  return gemmaScriptPromise;
}

async function loadBonsaiRuntime() {
  if (typeof globalThis.Bonsai27B === "function") {
    return globalThis.Bonsai27B;
  }
  if (!bonsaiScriptPromise) {
    bonsaiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "bonsai-27b.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load Bonsai runtime"));
      document.head.appendChild(script);
    })
      .then(() => {
        if (typeof globalThis.Bonsai27B !== "function") {
          throw new Error("Bonsai runtime did not register Bonsai27B");
        }
        return globalThis.Bonsai27B;
      })
      .catch(error => {
        bonsaiScriptPromise = null;
        throw error;
      });
  }
  return bonsaiScriptPromise;
}

async function loadLfmRuntime() {
  if (!lfmRuntimePromise) {
    lfmRuntimePromise = import("../lfm2_5.js")
      .then(module => module.Lfm2Mobile)
      .catch(error => {
        lfmRuntimePromise = null;
        throw error;
      });
  }
  const runtime = await lfmRuntimePromise;
  if (typeof runtime?.load !== "function") {
    throw new Error("LFM runtime did not export Lfm2Mobile");
  }
  return runtime;
}

const RUNTIME_ADAPTERS = {
  gemma: {
    toolProtocol: GEMMA_TOOL_PROTOCOL,
    generateAgent: generateGemmaAssistant,
    countPromptTokens(model, messages, { enableThinking = true } = {}) {
      return countGemmaPromptTokens(model, messages, { enableThinking });
    },
    chatOptions({ maxNewTokens, enableThinking, signal }) {
      return { maxNewTokens, enableThinking, signal };
    },
    async loadModel(_def, options) {
      const Runtime = await loadGemmaRuntime();
      return Runtime.load(null, options);
    },
  },
  bonsai: {
    toolProtocol: BONSAI_TOOL_PROTOCOL,
    generateAgent: generateBonsaiAssistant,
    countPromptTokens(model, messages, { enableThinking = false } = {}) {
      return countBonsaiPromptTokens(model, messages, { enableThinking });
    },
    chatOptions({ maxNewTokens, enableThinking = false, signal }) {
      return { maxNewTokens, enableThinking, signal };
    },
    applyChatTemplate(model, { enableThinking = false } = {}) {
      applyBonsaiChatTemplate(model, { enableThinking });
    },
    async loadModel(def, options) {
      const Runtime = await loadBonsaiRuntime();
      const model = await Runtime.load(def.hubId, {
        ...options,
        file: def.ggufFile,
        maxLength: def.contextWindowTokens,
      });
      applyBonsaiChatTemplate(model, { enableThinking: false });
      return model;
    },
  },
  lfm2: {
    toolProtocol: LFM_TOOL_PROTOCOL,
    generateAgent: generateLfmAssistant,
    countPromptTokens(model, messages) {
      return countLfmPromptTokens(model, messages);
    },
    chatOptions({ maxNewTokens, signal }) {
      return { maxNewTokens, signal };
    },
    async loadModel(def, options) {
      const Runtime = await loadLfmRuntime();
      return Runtime.load(def.hubId, options);
    },
  },
};

export function getRuntimeAdapter(runtime) {
  const adapter = RUNTIME_ADAPTERS[runtime];
  if (!adapter) throw new Error(`Unsupported model runtime: ${runtime}`);
  return adapter;
}
