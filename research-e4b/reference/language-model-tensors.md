# Language-model tensor names (E4B)

Filtered from `weights/e4b/model.safetensors.header.json`.

| Model | LM tensors | Full checkpoint tensors |
|-------|------------|-------------------------|
| E2B | 1597 | 2780 |
| E4B | 1921 | 3104 |

Files:

- `weights/e2b/language_model_tensors.txt`
- `weights/e4b/language_model_tensors.txt`

Regenerate:

```bash
python3 scripts/list_language_model_tensors.py e2b
python3 scripts/list_language_model_tensors.py e4b
```
