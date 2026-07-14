# Phase 4 — Fused decode ops

Attach: `reference/e2b-bundle/gemma-4-e2b.js`, Phase 2–3 results, `tools/subgroup-diagnostic.html`

---

Port E2B fused decode ops to E4B dimensions. For each fusion:

1. Start from WGSL comments in `gemma-4-e2b.js` (document unfused equivalents)
2. Adjust `in_features` / `out_features` for 2560 / 10240 / GQA
3. Keep **scalar fallback** variant
4. Add subgroup variant with guard: `subgroups && subgroupMinSize<=32 && subgroupMaxSize>=32`

Order:

1. `DecodeQkvProj`
2. `DecodeQkNormRope`
3. `DecodeAttention` (if not done in Phase 3)
4. `DecodeOprojNorm`
5. `DecodePleGate` / `DecodePleProjNorm` (**2-bit PLE**)
6. `DecodeGateUpNorm`
7. `DecodeDownNormAdd`

After each fusion: run full layer-0 decode vs CPU golden. If wrong, bisect by splitting fusion.

Run `tools/subgroup-diagnostic.html` after subgroup variants.
