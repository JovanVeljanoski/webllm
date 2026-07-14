# Gemma 4 E4B Mobile — WebGPU Runtime Research

Research pack for building `gemma-4-e4b.js` (custom WebGPU kernels + Google mobile-QAT weights), using the same paradigm as [webml-community/gemma-4-webgpu-kernels](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels).

## Quick start

1. Read [`CONTEXT-FOR-LLM.md`](./CONTEXT-FOR-LLM.md) — what to attach when prompting an advanced LLM.
2. Read [`docs/00-overview.md`](./docs/00-overview.md) — goal, feasibility, folder map.
3. Start with [`prompts/00-master-system-prompt.md`](./prompts/00-master-system-prompt.md), then phases 0–6 in `prompts/`.

## Folder layout

```
research-e4b/
├── README.md                 ← you are here
├── CONTEXT-FOR-LLM.md        ← attach list for LLM sessions
├── docs/                     ← human-readable research notes
├── prompts/                  ← copy-paste LLM instructions (master + phases)
├── reference/
│   └── e2b-bundle/           ← local copy of working E2B runtime
├── upstream/
│   └── gemma-4-webgpu-kernels/  ← HF Space files (demo + bundle)
├── weights/
│   ├── e2b/                  ← E2B hub metadata (configs, tokenizer, tensor header)
│   └── e4b/                  ← E4B hub metadata (configs, tokenizer, tensor header)
├── scripts/                  ← safetensors header fetch, config diff, golden generator
├── tools/                    ← WebGPU subgroup diagnostic (portability)
└── golden/                   ← output dir for CPU reference vectors (optional)
```

## What is downloaded

| Source | Files | Notes |
|--------|-------|-------|
| [google/gemma-4-E2B-it-qat-mobile-transformers](https://huggingface.co/google/gemma-4-E2B-it-qat-mobile-transformers) | config, tokenizer, chat template, README, **tensor header only** | Weights **not** included (~2.46 GB) |
| [google/gemma-4-E4B-it-qat-mobile-transformers](https://huggingface.co/google/gemma-4-E4B-it-qat-mobile-transformers) | same | Weights **not** included (~3.53 GB) |
| [webml-community/gemma-4-webgpu-kernels](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels) | gemma-4-e2b.js, index.html, landing.js, README | Reference implementation |
| Local WebLLM repo | `gemma-4-e2b.js`, `reference/e2b-bundle/gemma-4-e2b.js` | Vendored runtime and its preserved reference copy |

Tensor names/shapes without downloading weights: `weights/*/model.safetensors.header.json` (via `scripts/extract_safetensors_header.py`).

## Optional: full weights + golden vectors

```bash
# Re-fetch tensor headers (already done once)
python3 scripts/extract_safetensors_header.py

# Config diff
python3 scripts/diff_configs.py

# Golden vectors (downloads full model — several GB)
pip install torch transformers safetensors accelerate
python3 scripts/generate_golden_vectors.py --model e4b --output golden/e4b
```

## WebLLM integration (not yet available)

When a compatible, browser-validated `gemma-4-e4b.js` is published or built:

1. Vendor `gemma-4-e4b.js` next to `gemma-4-e2b.js`.
2. Add a `MODELS` entry with separate `cacheName` and hub `google/gemma-4-E4B-it-qat-mobile-transformers`.
3. Branch `ensureRuntime()` / `loadModel()` if the API differs from E2B.

## Status

- **Weights (E4B mobile QAT):** published by Google
- **Runtime (`gemma-4-e4b.js`):** not present in this repository
- **WebLLM integration:** not started; `lib/models.js` contains E2B and LFM2 entries only
- **This folder:** research + context only; it is not wired into `index.html`
