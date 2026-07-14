# Phase 5 — Full graph + runtime shell

Attach: All prior phases, `upstream/gemma-4-webgpu-kernels/index.html`, `weights/e4b/chat_template.jinja`

---

Wire 42-layer decode graph, `warmup()`, `generate()`.

Reuse patterns from E2B bundle:

- HF hub fetch with revision pin
- HTTP range requests + IndexedDB chunked cache
- Tokenizer (SentencePiece) + Gemma 4 chat template (thinking tags)
- Progress callbacks compatible with WebLLM `loadModel()`

Expose:

```javascript
globalThis.Gemma4Mobile
globalThis.GEMMA_DEFAULT_MODEL_ID = "google/gemma-4-E4B-it-qat-mobile-transformers"
```

Default hub when `load(null, opts)` is called.

Smoke test: load → warmup → generate `"2+2="` → compare greedy token id to `golden/e4b/decode_step0.json`.

Output: `gemma-4-e4b.js` single-file bundle.
