# Phase 1 — Weight map + CPU oracle

Attach: `weights/e4b/config.json`, `weights/e4b/model.safetensors.header.json`, `weights/e2b/model.safetensors.header.json`, `docs/01-e2b-vs-e4b-deltas.md`

---

From `google/gemma-4-E4B-it-qat-mobile-transformers`:

1. Parse `model.safetensors.header.json` — list all `model.language_model.*` tensors with shape/dtype.
2. Map each tensor to layer/module; assign bit width using `quantization_config.module_quant_configs` regexes.
3. Flag deltas vs E2B (hidden 2560, kv_heads 2, no double_wide_mlp, 42 layers, 2-bit PLE, 4-bit MLP all layers).

Write a Python script (`scripts/generate_golden_vectors.py` extension or new file) that:

- Loads the model with transformers (CPU, float32)
- Runs ONE decode step at seq_len=1 with fixed seed and prompt `"2+2="`
- Dumps intermediate tensors after: embed, layer0 q/k/v, attn out, mlp out
- Saves as `golden/e4b/*.json`

Also write pure TypeScript CPU reference for:

- `QatMatMul` (2/4/8-bit)
- `RMSNorm`
- `GELU` (gelu_pytorch_tanh)
- `RoPE` (default + proportional)

That consumes the same packed weight layout as the safetensors header.

**Do not write GPU code in this phase.**
