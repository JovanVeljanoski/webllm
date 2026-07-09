# WebLLM

A private AI chat that runs **entirely in your browser** — no server, no API keys, no data leaving your device. WebLLM is a demo and starting point for local WebGPU inference. Choose a model in the sidebar: **Gemma 4 E2B** (default, ~2.5 GB) or **LFM2.5** 230M / 350M (~150–220 MB, faster).

## Try it live

**[https://jovanveljanoski.github.io/webllm/](https://jovanveljanoski.github.io/webllm/)**

1. Open the link in **Chrome, Edge, or Safari 18+** (Firefox is not supported for inference).
2. Open the sidebar **Model** panel and pick a model (Gemma 4 E2B, LFM2.5 230M, or LFM2.5 350M).
3. Click **Load model** — the first visit downloads weights from Hugging Face (one-time; ~2.5 GB for Gemma, ~150–220 MB for LFM2.5).
4. Wait for **Model ready**, then chat. Refresh later and the model loads from your browser cache in seconds.

Everything runs on your device.

## Credit

This demo would not be possible without **Transformers.js** and the work of **Joshua Lochner** ([@xenovacom](https://x.com/xenovacom) · [GitHub](https://github.com/Xenova)), who pioneered running state-of-the-art ML models in the browser with WebGPU. WebLLM is meant to showcase that stack, inspire local use cases, and promote his work — not to replace it.

The runtime bundles are built on the Hugging Face / Transformers.js ecosystem: `gemma-4-e2b.js` (Gemma 4) and `lfm2_5.js` ([webml-community/lfm2-webgpu-kernels](https://huggingface.co/spaces/webml-community/lfm2-webgpu-kernels)). Follow Joshua for updates on browser ML.

## What it does

- **Model switcher** in the sidebar — Gemma 4 E2B (default, thinking traces) or LFM2.5 230M / 350M (smaller, faster)
- Loads local LLMs once, then caches weights in the browser (per model)
- Runs inference via **WebGPU** (Chrome, Edge, Safari 18+)
- Stores chat history in **IndexedDB** on your machine
- Exports conversations as **OpenAI-style JSON** (`[{ "role", "content" }, …]`) for reuse elsewhere
- Supports system prompts, optional grammar guidance, thinking traces, and dark mode

## Quick start

**Requirements:** A browser with WebGPU (Chrome 113+, Edge 113+, Safari 18+). Firefox is not supported for the current runtime.

### Local development

Caching and IndexedDB require a real origin — **do not** open `index.html` via `file://`.

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

### GitHub Pages

The live demo is hosted on GitHub Pages — see [Try it live](#try-it-live) above. Pushes to `master` redeploy automatically.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Full app — UI, chat logic, model switcher, caching, export (single file, no build step) |
| `gemma-4-e2b.js` | WebGPU runtime for Gemma 4 E2B (`Gemma4Mobile.load`, generate, safetensors cache) |
| `lfm2_5.js` | WebGPU runtime for LFM2.5 GGUF models (`Lfm2Mobile.load`, shared by 230M & 350M) |

There is no npm install or bundler. Deploy these files as static assets.

## Implementation notes for developers

### Architecture

- **Static-only:** GitHub Pages (or any static host) serves HTML/JS. The browser fetches model weights directly from Hugging Face's CDN — no backend.
- **Two-tier cache** (Gemma, safetensors via runtime + `index.html`):
  - **Cache Storage** — tokenizer, config, small JSON assets
  - **IndexedDB** — safetensors weight chunks (~256 KB blobs, HTTP Range requests)
- **GGUF cache** (LFM2.5) — Cache Storage per model (`webllm-lfm2-v1` for 230M, `webllm-lfm2-350m-v1` for 350M; each with `-headers`)
- **Chat persistence** — separate IndexedDB database for sessions; clearing model cache does not delete conversations.

### Key integration points in `index.html`

- `MODELS` registry — add entries with `runtime`, `hubId`, `cacheName`, `cacheType`, `supportsThinking`
- `Gemma4Mobile.load(null, { revision, cacheName, onProgress })` — Gemma weights
- `Lfm2Mobile.load(hubId, { revision, cacheName, onProgress })` — LFM2.5 GGUF (dynamic `import("./lfm2_5.js")`)
- `state.fileOrigin` — disables cache on `file://`; production must use `https://`
- `buildMessages(session)` — builds the message list sent to the model (system + user/assistant turns)
- `exportSessionOpenAI(session)` — exports portable OpenAI Chat Completions JSON
- `getModelCacheSize()` — measures cached bytes from IDB + Cache Storage (prefer over `navigator.storage.estimate()`, which underreports on Safari)

### WebGPU probe

On load, the app checks `navigator.gpu`, requests an adapter, and shows browser-specific guidance (e.g. Safari OK, Firefox blocked). Model load is disabled until WebGPU is available.

### Contributing

- Keep the production surface minimal: `index.html` + runtime JS files
- Match existing patterns (vanilla JS, CSS variables, no framework)
- Test on **HTTPS** (GitHub Pages URL) before shipping cache-related changes
- Bump `MODEL_REVISION` and `MODEL_CACHE_NAME` together when changing model weights

## License

MIT