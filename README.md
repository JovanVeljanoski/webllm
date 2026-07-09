# WebLLM

A private AI chat that runs **entirely in your browser** — no server, no API keys, no data leaving your device. WebLLM is a demo and starting point for local WebGPU inference. The default model today is Gemma 4 E2B; the app is designed to support additional models over time.

## Credit

This demo would not be possible without **Transformers.js** and the work of **Joshua Lochner** ([@xenovacom](https://x.com/xenovacom) · [GitHub](https://github.com/Xenova)), who pioneered running state-of-the-art ML models in the browser with WebGPU. WebLLM is meant to showcase that stack, inspire local use cases, and promote his work — not to replace it.

The runtime bundle (`gemma-4-e2b.js`) is built on the Hugging Face / Transformers.js ecosystem. Follow Joshua for updates on browser ML.

## What it does

- Loads a local LLM (~2.5 GB for the default Gemma 4 weights) once, then caches in the browser
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

Push this repo and enable Pages (branch root or `/docs`). The app must be served over **HTTPS** for model caching to work. First visit downloads ~2.5 GB; refresh loads from cache in seconds.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Full app — UI, chat logic, caching, export (single file, no build step) |
| `gemma-4-e2b.js` | Vendored WebGPU runtime for the default model (`Gemma4Mobile.load`, generate, cache) |

There is no npm install or bundler. Deploy the two files as static assets.

## Implementation notes for developers

### Architecture

- **Static-only:** GitHub Pages (or any static host) serves HTML/JS. The browser fetches model weights directly from Hugging Face's CDN — no backend.
- **Two-tier cache** (handled inside the runtime, wired from `index.html`):
  - **Cache Storage** — tokenizer, config, small JSON assets
  - **IndexedDB** — safetensors weight chunks (~256 KB blobs, HTTP Range requests)
- **Chat persistence** — separate IndexedDB database for sessions; clearing model cache does not delete conversations.

### Key integration points in `index.html`

- `Gemma4Mobile.load(null, { revision, cacheName, onProgress })` — pin `MODEL_REVISION` and `MODEL_CACHE_NAME` when updating the model
- `state.fileOrigin` — disables cache on `file://`; production must use `https://`
- `buildMessages(session)` — builds the message list sent to the model (system + user/assistant turns)
- `exportSessionOpenAI(session)` — exports portable OpenAI Chat Completions JSON
- `getModelCacheSize()` — measures cached bytes from IDB + Cache Storage (prefer over `navigator.storage.estimate()`, which underreports on Safari)

### WebGPU probe

On load, the app checks `navigator.gpu`, requests an adapter, and shows browser-specific guidance (e.g. Safari OK, Firefox blocked). Model load is disabled until WebGPU is available.

### Contributing

- Keep the production surface minimal: `index.html` + runtime JS
- Match existing patterns (vanilla JS, CSS variables, no framework)
- Test on **HTTPS** (GitHub Pages URL) before shipping cache-related changes
- Bump `MODEL_REVISION` and `MODEL_CACHE_NAME` together when changing model weights

## License

MIT