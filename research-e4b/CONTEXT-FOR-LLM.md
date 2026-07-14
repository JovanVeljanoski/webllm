# Context pack for LLM sessions

Attach these files when starting work on Gemma 4 E4B WebGPU runtime. Order matters: read overview first, then reference bundle, then target weights.

## Always attach (core)

| File | Purpose |
|------|---------|
| `docs/00-overview.md` | Goal, architecture, feasibility |
| `docs/01-e2b-vs-e4b-deltas.md` | Dimension and QAT differences |
| `docs/02-runtime-architecture.md` | Op registry, fusion, API surface |
| `prompts/00-master-system-prompt.md` | Master system instructions |
| `reference/e2b-bundle/gemma-4-e2b.js` | **Primary spec** — only public E2B runtime |
| `weights/e4b/config.json` | E4B architecture + quantization rules |
| `weights/e4b/model.safetensors.header.json` | All tensor names, shapes, dtypes |

## Attach for specific phases

| Phase | Additional files |
|-------|-------------------|
| 0 — Reverse-engineer E2B | `reference/op-inventory.md`, `reference/e2b-bundle/gemma-4-e2b.js` |
| 1 — Weight map + CPU oracle | `weights/e2b/model.safetensors.header.json`, `scripts/generate_golden_vectors.py` |
| 2–4 — Kernels | `upstream/gemma-4-webgpu-kernels/index.html`, `tools/subgroup-diagnostic.html` |
| 5 — Runtime shell | `weights/e4b/chat_template.jinja`, `weights/e4b/tokenizer_config.json` |
| 6 — Portability | `upstream/gemma-4-webgpu-kernels/discussion-1-subgroup-bug.html` |

## Optional (large)

| File | Size | When |
|------|------|------|
| `weights/e4b/tokenizer.json` | ~31 MB | Tokenizer implementation |
| `weights/e4b/model.safetensors` | ~3.5 GB | Only if generating goldens locally |
| Full `gemma-4-e2b.js` from upstream | ~540 KB | Compare with vendored copy |

## Session workflow

1. Paste `prompts/00-master-system-prompt.md` as system message.
2. Attach core files above.
3. Run one phase prompt from `prompts/01-phase-*.md` per session.
4. Require **PASS/FAIL tests** against CPU golden before merging kernel work.
5. Run `tools/subgroup-diagnostic.html` on real hardware after fusion changes.

## Do not ask the LLM to

- Write the full bundle in one shot without golden tests
- Invent QAT bit packing — derive from `model.safetensors.header.json` + E2B dequant code
- Skip scalar/f32 fallback variants before subgroup fusion

## Hub IDs

- E2B (reference runtime): `google/gemma-4-E2B-it-qat-mobile-transformers`
- E4B (target weights): `google/gemma-4-E4B-it-qat-mobile-transformers`
- Upstream space: https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels
