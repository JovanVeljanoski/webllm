# Build process — end to end

## Phase map

| Phase | Output | Validation |
|-------|--------|------------|
| 0 | E2B structure doc, op contracts | Human review |
| 1 | Weight map, CPU reference | Match safetensors shapes |
| 2 | Primitive GPU ops | CPU vs GPU per op |
| 3 | Attention | Python golden at seq=8 + decode=1 |
| 4 | Fused decode ops | Per-layer golden |
| 5 | Full `Gemma4Mobile` | End-to-end "2+2=" token ids |
| 6 | Portability | Subgroup diagnostic + multi-GPU |

Detailed LLM prompts: `prompts/01-phase-*.md`.

## Human + LLM roles

**LLM good at:**

- Manifest + WGSL authoring from reference
- CPU reference implementations
- Test harness HTML/JS
- Porting fusion comments from E2B bundle

**Human / hardware required:**

- Running WebGPU on Apple, NVIDIA, Intel
- Bisecting wrong fused kernels
- Approving variant guards after real failures
- Performance profiling

## Reference oracle (mandatory)

Without golden vectors, kernel work is guesswork.

```bash
pip install torch transformers safetensors accelerate
python3 scripts/generate_golden_vectors.py --model e4b --output golden/e4b
```

Extend script to dump per-layer intermediates as you add ops.

## Tensor metadata without full download

Already extracted:

```bash
python3 scripts/extract_safetensors_header.py
# → weights/e2b/model.safetensors.header.json (2780 tensors)
# → weights/e4b/model.safetensors.header.json (3104 tensors)
```

## Upstream path (recommended)

Before building from scratch:

1. Open discussion on [gemma-4-webgpu-kernels](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels) requesting E4B
2. Offer GPU test matrix results from `tools/subgroup-diagnostic.html`
3. Integrate published `gemma-4-e4b.js` into WebLLM (hours, not months)

## WebLLM integration checklist (post-bundle)

- [ ] Vendor `gemma-4-e4b.js`
- [ ] Add `MODELS.gemma4_e4b` with `cacheName: "webllm-gemma4-e4b-v1"`
- [ ] Pin HF revision
- [ ] Separate cache from E2B
- [ ] UI copy: ~3.5 GB download, higher VRAM than E2B
- [ ] Test cache round-trip on GitHub Pages

## Success criteria

1. Loads E4B weights from HF on Chrome/Safari
2. `warmup()` completes without variant rejection
3. Greedy decode matches Python argmax on fixed prompt
4. Subgroup diagnostic PASS on developer machines
5. Reasonable tok/s (not necessarily E2B parity on v1)
