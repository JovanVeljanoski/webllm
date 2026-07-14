#!/usr/bin/env python3
"""
Generate CPU golden vectors for E4B decode validation (requires full model download).

Prerequisites:
  pip install torch transformers safetensors accelerate

Usage:
  python scripts/generate_golden_vectors.py --model e4b --output golden/e4b

This script is optional; it downloads ~3.5 GB for E4B on first run.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

HUB_IDS = {
    "e2b": "google/gemma-4-E2B-it-qat-mobile-transformers",
    "e4b": "google/gemma-4-E4B-it-qat-mobile-transformers",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=HUB_IDS.keys(), default="e4b")
    parser.add_argument("--output", type=Path, default=Path("golden/e4b"))
    parser.add_argument("--prompt", default="2+2=")
    args = parser.parse_args()

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise SystemExit(
            "Missing deps. Run: pip install torch transformers safetensors accelerate"
        ) from exc

    hub = HUB_IDS[args.model]
    args.output.mkdir(parents=True, exist_ok=True)

    print(f"Loading {hub} (this may download several GB) …")
    tokenizer = AutoTokenizer.from_pretrained(hub)
    model = AutoModelForCausalLM.from_pretrained(
        hub,
        torch_dtype=torch.float32,
        device_map="cpu",
        trust_remote_code=True,
    )
    model.eval()

    messages = [{"role": "user", "content": args.prompt}]
    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    else:
        text = args.prompt

    inputs = tokenizer(text, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs, use_cache=True)
        logits = out.logits[0, -1].tolist()

    payload = {
        "hub_id": hub,
        "prompt": args.prompt,
        "input_ids": inputs["input_ids"][0].tolist(),
        "last_token_logits_shape": [len(logits)],
        "last_token_logits_sample": logits[:16],
        "argmax_token_id": int(max(range(len(logits)), key=logits.__getitem__)),
    }
    out_file = args.output / "decode_step0.json"
    out_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {out_file}")


if __name__ == "__main__":
    main()
