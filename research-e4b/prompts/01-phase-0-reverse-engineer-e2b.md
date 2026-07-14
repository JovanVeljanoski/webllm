# Phase 0 — Reverse-engineer E2B bundle

Attach: `reference/e2b-bundle/gemma-4-e2b.js`, `reference/op-inventory.md`, `docs/02-runtime-architecture.md`

---

Analyze `gemma-4-e2b.js`. Produce:

1. List of all `com.xenova.gemma4.*` ops with args, inputs, outputs, and variant `when:` guards (summarized).
2. Decode-step fusion diagram: which ops call which in one transformer layer.
3. QAT dequant formulas: bits, scales, zero_point, SRQ activation quant — quote relevant code/comments from the bundle.
4. KV cache layout and sliding-window vs full-attention indexing.
5. Which constants are E2B-specific (1536, 6144, 35 layers, 1 KV head, double-wide MLP) vs reusable framework code.
6. Minimal subset that must change for E4B (2560, 10240, 42 layers, 2 KV heads, no double-wide MLP, 2-bit PLE).

Output: markdown report + TypeScript interfaces for manifest schema.

**Do NOT write E4B kernels yet.**
