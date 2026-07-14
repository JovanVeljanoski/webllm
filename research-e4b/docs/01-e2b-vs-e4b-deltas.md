# E2B vs E4B mobile — deltas that matter for kernels

Sources: `weights/e2b/config.json`, `weights/e4b/config.json` (downloaded from Hugging Face).

## Text model (`text_config`)

| Field | E2B | E4B | Kernel impact |
|-------|-----|-----|---------------|
| `num_hidden_layers` | 35 | **42** | Loop count, KV layout |
| `hidden_size` | 1536 | **2560** | All GEMV/GEMM dims |
| `intermediate_size` | 6144 | **10240** | MLP gate/up/down |
| `num_key_value_heads` | 1 | **2** | GQA indexing, KV cache strides |
| `num_kv_shared_layers` | 20 | **18** | KV sharing schedule |
| `use_double_wide_mlp` | true | **false** | MLP fusion path differs |
| Full-attention layers | every 5th (0-index: 4,9,14…) | every 6th (0-index: 5,11,17…) | RoPE proportional branch |
| Sliding before first full | 4 layers | **5 layers** | Attention mask/window |

Unchanged (text): `num_attention_heads=8`, `head_dim=256`, `global_head_dim=512`, `sliding_window=512`, `vocab_size=262144`, `hidden_size_per_layer_input=256`.

## Quantization (`quantization_config`)

| Module pattern | E2B bits | E4B bits |
|----------------|----------|----------|
| `language_model.embed_tokens` | 2 | 2 |
| `language_model.embed_tokens_per_layer` | **4** | **2** |
| `language_model.layers.*.mlp.*` | **2** (layers 15+) / 4 (0–14) | **4** (all layers) |
| `language_model.layers.*.self_attn.*` | 4 | 4 |
| `language_model.layers.*.per_layer_input_gate` | 8 | 8 |
| `language_model.layers.*.per_layer_projection` | 8 | 8 |
| `lm_head` | 2 | 2 |

**Critical:** E4B uses **2-bit PLE embeddings** and **4-bit MLP everywhere**. E2B drops MLP to 2-bit on later layers. Dequant and fused kernel bit paths must follow E4B rules.

## Weight file size

| Model | `model.safetensors` |
|-------|---------------------|
| E2B | ~2.46 GB |
| E4B | ~3.53 GB |

Single-file safetensors (no shard index). Tensor metadata in `model.safetensors.header.json`.

## Generated diff

Run `python3 scripts/diff_configs.py` or see `docs/e2b-vs-e4b-deltas-generated.txt`.

## Scope for v1 runtime

**In scope:** `model.language_model.*` text decoder only.  
**Out of scope:** vision tower, audio tower (weights exist in same checkpoint but WebLLM is text-only today).
