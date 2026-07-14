# Phase 2 — Primitive GPU ops (unfused)

Attach: Phase 0 report, CPU reference from Phase 1, `reference/e2b-bundle/gemma-4-e2b.js` (QatMatMul sections)

---

Implement GPU kernels + tests for these primitives ONLY, **E4B dimensions**:

| Op | Example shapes (M=1 GEMV) |
|----|---------------------------|
| QatMatMul | 2560→2048 (QKV), 2048→2560 (o_proj), 2560→10240 (gate/up), 10240→2560 (down) |
| RMSNorm | dim 2560 |
| Rope1d + proportional RoPE | head_dim 256, global_head_dim 512 |
| SrqQuantize | activation scales per module |

Each op:

- Manifest (`com.xenova.gemma4.*` or `com.xenova.*`)
- At least 2 variants: scalar f32, f16 subgroup (if applicable)
- Standalone test HTML: WebGPU vs CPU golden → PASS/FAIL

**Do not fuse ops yet.** Do not build full layer graph.
