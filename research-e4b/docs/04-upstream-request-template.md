# Upstream request template (webml-community)

Post to: https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels/discussions

---

**Title:** Request: `gemma-4-e4b.js` for mobile-QAT E4B weights

Hi — we're building a multi-model browser chat ([WebLLM](https://jovanveljanoski.github.io/webllm/)) on top of your E2B kernel bundle. Google has published E4B mobile-QAT weights:

- `google/gemma-4-E4B-it-qat-mobile-transformers` (~3.53 GB safetensors)

but the [gemma-4-webgpu-kernels](https://huggingface.co/spaces/webml-community/gemma-4-webgpu-kernels) space only ships `gemma-4-e2b.js` today.

**E4B text deltas vs E2B (from config):**

| | E2B | E4B |
|--|-----|-----|
| layers | 35 | 42 |
| hidden | 1536 | 2560 |
| MLP | 6144 (double-wide) | 10240 |
| KV heads | 1 | 2 |
| PLE embed bits | 4 | 2 |
| MLP bits (late layers) | 2 | 4 (all) |

We understand this needs new fused kernels, not a hub URL swap. Happy to help test:

- `tools/subgroup-diagnostic.html` results on Apple / NVIDIA / Intel
- Cache + load testing from a static GitHub Pages deploy
- Regression reports against E2B after E4B lands

Is an E4B mobile kernel bundle on the roadmap? We'd integrate immediately once published.

Thanks for the amazing work on Gemma 4 WebGPU!

---

Adjust author/links before posting.
