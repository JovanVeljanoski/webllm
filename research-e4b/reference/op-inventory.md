# Op inventory — `gemma-4-e2b.js`

Extracted from `reference/e2b-bundle/gemma-4-e2b.js` via:

```bash
rg -o 'com\.xenova(\.[A-Za-z0-9]+)+' reference/e2b-bundle/gemma-4-e2b.js | sort -u
```

## Generic ops (`com.xenova.*`)

| Op | Purpose |
|----|---------|
| `AddInPlace` | In-place tensor add |
| `MulBroadcast` | Broadcast multiply |
| `RMSNorm` | Root mean square normalization |
| `Rope1d` | Rotary position embedding |
| `StridedCopy` | Tensor copy with stride |

## Gemma4 ops (`com.xenova.gemma4.*`)

| Op | Purpose |
|----|---------|
| `ArgMax` | Greedy token selection / finalize |
| `Attention` | Multi-token attention (prefill) |
| `DecodeAttention` | Single-token decode attention |
| `DecodeDownNormAdd` | Fused: down-proj QAT + residual |
| `DecodeGateUpNorm` | Fused: gate+up QAT + GELU + norm |
| `DecodeNormAdd` | Fused: RMS norm + residual add |
| `DecodeNormAddNorm` | Fused: double norm block |
| `DecodeOprojNorm` | Fused: o-proj QAT + post-attn norms |
| `DecodePleGate` | Fused: PLE gate path |
| `DecodePleProjNorm` | Fused: PLE projection + norm |
| `DecodeQkNormRope` | Fused: Q/K norm + RoPE |
| `DecodeQkvProj` | Fused: Q/K/V QAT projection |
| `DecodeRmsSrq` | Fused: RMS norm + SRQ quant |
| `DenseGemv` | Dense matrix-vector multiply |
| `PleGate` | Per-layer embedding gate (prefill) |
| `QatEmbedGather` | Quantized embedding lookup |
| `QatMatMul` | QAT matrix multiply (2/4/8-bit) |
| `SrqQuantize` | Activation quantization (SRQ) |

## E4B port priority

**Must implement / resize for E4B:**

1. `QatMatMul`, `QatEmbedGather`, `SrqQuantize` — foundation
2. `DecodeQkvProj`, `DecodeQkNormRope`, `DecodeAttention` — attention (note **2 KV heads**)
3. `DecodeOprojNorm`, `DecodeGateUpNorm`, `DecodeDownNormAdd` — main fusions
4. `DecodePleGate`, `DecodePleProjNorm` — **2-bit PLE** on E4B
5. `ArgMax` + LM head 2-bit path

**Prefill (lower priority for WebLLM chat v1):**

- `Attention`, `PleGate`, unfused variants

## Fusion comments in bundle

Search `gemma-4-e2b.js` for comments like:

- `Single-dispatch fused o-projection (QAT GEMV)`
- `mirrors com.xenova.gemma4.QatMatMul scalar`
- `contracts of com.xenova.RMSNorm`

These document unfused equivalents — use when splitting a broken fusion.

## Variant naming pattern (observed)

Examples from `DecodeOprojNorm`:

- `scalar` — f32 workgroup fallback
- `fused` — subgroup-optimized fusion
- `fused_rows` — row-cooperative variant

Guards reference `device.features`, `dtypes`, `args.*`, `numel(shapes.*)`, `adapterInfo.subgroupMinSize/MaxSize`.
