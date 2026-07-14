# Overview: Gemma 4 E4B mobile WebGPU runtime

## Goal

Produce `gemma-4-e4b.js` — a self-contained browser bundle that:

- Loads [`google/gemma-4-E4B-it-qat-mobile-transformers`](https://huggingface.co/google/gemma-4-E4B-it-qat-mobile-transformers) (~3.53 GB)
- Runs inference via **custom WebGPU kernels** (same stack as E2B, not ONNX/Transformers.js)
- Exposes `globalThis.Gemma4Mobile` compatible with the E2B API

## What already exists

| Piece | Status |
|-------|--------|
| E4B mobile-QAT weights on HF | ✅ Published |
| E2B WebGPU runtime (`gemma-4-e2b.js`) | ✅ [HF Space](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels) |
| E4B WebGPU runtime | ❌ Not published |
| WebLLM multi-model integration | ⏳ Not started; blocked on a compatible browser runtime bundle |

## Why E2B code cannot load E4B weights

The runtime is **not** a generic engine with a hub URL parameter. It embeds:

- Fused WGSL compute shaders sized for E2B tensors
- Op manifests with variant guards (f16, subgroups, tensor shapes)
- Hardcoded default hub `google/gemma-4-E2B-it-qat-mobile-transformers`

E4B differs in layers (42 vs 35), hidden size (2560 vs 1536), KV heads (2 vs 1), MLP layout (`use_double_wide_mlp: false`), and QAT bit widths. See `docs/01-e2b-vs-e4b-deltas.md`.

## Architecture (two-part system)

```
gemma-4-e4b.js (~500KB+)          google/gemma-4-E4B-it-qat-mobile-transformers
┌─────────────────────────┐       ┌──────────────────────────────────────┐
│ WebGPU op registry      │       │ model.safetensors (~3.53 GB)         │
│ Fused decode kernels    │──────▶│ QAT mobile schema (wNa8o8 family)    │
│ Tokenizer + chat template│       │ config.json, tokenizer.json          │
│ HF fetch + IDB cache    │       └──────────────────────────────────────┘
└─────────────────────────┘
```

Reportedly LLM-assisted (Fable) + maintained by Joshua Lochner / webml-community. Xenova used Claude Opus for subgroup diagnostics ([discussion #1](../upstream/gemma-4-webgpu-kernels/discussion-1-subgroup-bug.html)).

## Build strategy

**Do not** one-shot the bundle. Use phased prompts in `prompts/`:

0. Reverse-engineer E2B bundle structure  
1. Weight map + CPU golden vectors  
2. Primitive unfused GPU ops  
3. Attention (GQA, sliding + full)  
4. Fused decode ops (port E2B fusions to E4B dims)  
5. Full graph + `Gemma4Mobile` shell  
6. GPU portability torture tests  

## Feasibility

| Who | Can build kernels? |
|-----|-------------------|
| webml-community / Xenova | Most likely |
| WebLLM team with advanced LLM + test harness | Possible but months of iteration |
| WebLLM integration only | Easy once bundle exists |

## Tensor inventory (headers only)

Extracted without downloading weights:

- E2B: **2780** tensors — `weights/e2b/model.safetensors.header.json`
- E4B: **3104** tensors — `weights/e4b/model.safetensors.header.json`

Language-model keys follow pattern:

`model.language_model.layers.{N}.{self_attn,mlp,per_layer_*}.{weight,weight_scale,...}`
