# E2B runtime architecture (reverse-engineered from public bundle)

Source: `reference/e2b-bundle/gemma-4-e2b.js` (~540 KB minified, vendored from [gemma-4-webgpu-kernels](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels)).

## Public API

After script load:

```javascript
globalThis.Gemma4Mobile          // class
globalThis.GEMMA_DEFAULT_MODEL_ID // "google/gemma-4-E2B-it-qat-mobile-transformers"
globalThis.Gemma4ResolveModelRoot // hub path helper

const model = await Gemma4Mobile.load(null, {
  cacheName: "gemma4-chat-model-v1",
  revision: "<pin>",
  onProgress: ({ loaded, total, file }) => {},
  cache: true,
});
await model.warmup();
await model.generate({ messages, maxTokens, ... });
```

WebLLM uses this in `index.html` for `def.runtime === "gemma"`.

## Op registry pattern

Ops use Xenova-style manifests:

- `domain`: `"com.xenova"` or `"com.xenova.gemma4"`
- `schemaVersion`: 1
- Each op: `manifest`, `variants[]`, each variant has `when:` guard + `passes[]`
- Shaders: embedded as `.wgsl.jinja` templates, rendered with device features / tensor shapes

Variant selection rejects unsupported paths early (e.g. subgroup size mismatch — see HF discussion #1).

## Gemma4-specific ops (18)

See `reference/op-inventory.md` for full list.

**Prefill / generic:** `Attention`, `QatMatMul`, `QatEmbedGather`, `PleGate`, `DenseGemv`, `SrqQuantize`

**Decode fused (performance-critical):**

| Op | Role |
|----|------|
| `DecodeQkvProj` | Q/K/V QAT projection from hidden |
| `DecodeQkNormRope` | Q/K RMS norm + RoPE |
| `DecodeAttention` | Single-token attention + sliding/full |
| `DecodeOprojNorm` | O-proj QAT + residual norm + pre-FFN norm |
| `DecodePleGate` / `DecodePleProjNorm` | Per-layer embedding path |
| `DecodeGateUpNorm` | Gate+Up QAT + GELU + norm |
| `DecodeDownNormAdd` | Down QAT + residual |
| `DecodeNormAdd` / `DecodeNormAddNorm` | Norm fusion building blocks |
| `DecodeRmsSrq` | RMS norm + activation quant |
| `ArgMax` | Sampling / greedy decode |

## Generic Xenova ops (6)

`AddInPlace`, `MulBroadcast`, `RMSNorm`, `Rope1d`, `StridedCopy`

## Decode layer graph (conceptual)

One decode step per layer:

```
hidden
  → DecodeQkvProj → Q, K, V
  → DecodeQkNormRope (Q, K)
  → update KV cache
  → DecodeAttention
  → DecodeOprojNorm (+ PLE branches where configured)
  → DecodeGateUpNorm
  → DecodeDownNormAdd
  → hidden (next layer)
```

After all layers: LM head (2-bit QAT) → `ArgMax` / sampling.

## QAT mobile weight layout

From safetensors header (`weights/e4b/model.safetensors.header.json`), per linear:

- `{module}.weight` — packed quantized weights (dtype often `I8` / `U8` in header)
- `{module}.weight_scale` — per-block scales
- `{module}.input_activation_scale` / `output_activation_scale` — SRQ activation quant

Embeddings:

- `embed_tokens.embedding_quantized` + `embedding_scale`
- `embed_tokens_per_layer.embedding_quantized` + `embedding_scale`

## Portability requirements

From production debugging:

1. **Subgroup guards:** use `subgroupMinSize <= 32 && subgroupMaxSize >= 32`, not `== 32`
2. **Fallback variants:** scalar f32 / workgroup when subgroups unavailable
3. **f16 gating:** `enable f16` only when `shader-f16` feature present
4. **Cross-workgroup merges:** last-arriver atomic pattern; test with `tools/subgroup-diagnostic.html`

## What E4B port must change

1. All `in_features` / `out_features` constants tied to 2560 / 10240 / head layouts
2. 42-layer graph vs 35
3. GQA with 2 KV heads (E2B uses 1)
4. QAT bit widths (especially PLE 2-bit, MLP 4-bit all layers)
5. `use_double_wide_mlp: false` — do not use E2B double-wide MLP fusion assumptions

## Bundling

Final deliverable is a **single JS file** containing:

- Op registry + embedded WGSL
- Graph builder / warmup
- HF hub client + IndexedDB chunk cache
- Tokenizer (SentencePiece) + Gemma 4 chat template

E4B target: `gemma-4-e4b.js` mirroring this structure.
