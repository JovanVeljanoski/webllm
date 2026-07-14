# Golden vectors (optional)

This directory holds CPU reference outputs for kernel validation.

## Generate

Requires full model download (~3.5 GB for E4B):

```bash
pip install torch transformers safetensors accelerate
python3 ../scripts/generate_golden_vectors.py --model e4b --output e4b
```

## Expected files (after extended script)

| File | Contents |
|------|----------|
| `e4b/decode_step0.json` | Input ids, last-token logits sample, argmax token |
| `e4b/layer0_*.json` | Per-op intermediates (add as kernel work progresses) |

## Usage

GPU kernels must PASS against these within documented tolerances before fusion merges.
