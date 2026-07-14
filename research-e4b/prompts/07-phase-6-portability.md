# Phase 6 — Portability torture testing

Attach: `gemma-4-e4b.js` (from Phase 5), `upstream/gemma-4-webgpu-kernels/discussion-1-subgroup-bug.html`

---

1. Run `tools/subgroup-diagnostic.html` on every target GPU (Apple, NVIDIA, Intel). Paste full output.

2. Extend diagnostic with one E4B-specific test: f16 QatMatMul 2560→2560 single row vs CPU.

3. Fix any FAIL from:
   - Non-linear subgroup lane mapping
   - Butterfly reduction wrong total
   - Cross-workgroup last-arriver race

4. Full model smoke tests:
   - Load + warmup on each platform
   - Greedy decode 20 tokens — no repetition garbage
   - Cache round-trip (second load uses IDB)

5. Document supported adapters and known limitations in `docs/04-portability-results.md`.

Do not ship until subgroup diagnostic PASS on at least one NVIDIA + one Apple GPU.
