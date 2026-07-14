# Phase 3 — Attention

Attach: Phase 2 ops, `weights/e4b/config.json` (layer_types, sliding_window, rope_parameters)

---

Implement `Attention` + `DecodeAttention` for E4B:

- 8 Q heads, **2 KV heads** (GQA) — not E2B's 1
- Sliding window 512 on `sliding_attention` layers
- Full attention + proportional RoPE on `full_attention` layers (indices 5, 11, 17, 23, 29, 35, 41)
- KV sharing per `num_kv_shared_layers=18`

Test:

1. Prefill length 8
2. Decode 1 token
3. Compare attention output to Python golden from Phase 1

Include scalar fallback variant before flash/fused optimizations.
