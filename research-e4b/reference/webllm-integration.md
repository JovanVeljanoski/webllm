# WebLLM integration notes (future work)

E4B is not integrated into the current application. These are the checks to
perform only after a compatible, browser-validated `gemma-4-e4b.js` exists:

```javascript
// MODELS registry
gemma4_e4b: {
  id: "gemma4_e4b",
  name: "Gemma 4 E4B",
  subtitle: "Google · ~3.5 GB · thinking",
  runtime: "gemma",  // or "gemma_e4b" if separate global
  hubId: "google/gemma-4-E4B-it-qat-mobile-transformers",
  revision: "<pin from HF>",
  cacheName: "webllm-gemma4-e4b-v1",
  cacheType: "safetensors",
  supportsThinking: true,
},
```

Load path (current E2B pattern):

```javascript
state.model = await globalThis.Gemma4Mobile.load(null, {
  onProgress: onLoadProgress,
  cacheName: def.cacheName,
  revision: def.revision,
});
await state.model.warmup();
```

**Important:** use a **separate cache name** from E2B (`gemma4-chat-model-v1`) — weights must not share IndexedDB buckets.

Verify the actual `lib/models.js`, `index.html`, and cache helpers at
implementation time; line numbers and runtime APIs may change.
