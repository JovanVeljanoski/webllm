#!/usr/bin/env python3
"""Fetch only the safetensors JSON header from Hugging Face (no full weight download)."""

from __future__ import annotations

import json
import struct
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "e2b": "https://huggingface.co/google/gemma-4-E2B-it-qat-mobile-transformers/resolve/main/model.safetensors",
    "e4b": "https://huggingface.co/google/gemma-4-E4B-it-qat-mobile-transformers/resolve/main/model.safetensors",
}


def fetch_header(url: str, max_bytes: int = 50_000_000) -> dict:
    req = urllib.request.Request(url, headers={"Range": f"bytes=0-{max_bytes - 1}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        chunk = resp.read(max_bytes)
    if len(chunk) < 8:
        raise RuntimeError(f"Response too short from {url}")
    (header_len,) = struct.unpack("<Q", chunk[:8])
    header_bytes = chunk[8 : 8 + header_len]
    return json.loads(header_bytes.decode("utf-8"))


def summarize(header: dict) -> dict:
    tensors = []
    for name, meta in header.items():
        if name == "__metadata__":
            continue
        tensors.append(
            {
                "name": name,
                "dtype": meta.get("dtype"),
                "shape": meta.get("shape"),
                "data_offsets": meta.get("data_offsets"),
            }
        )
    tensors.sort(key=lambda t: t["name"])
    return {
        "tensor_count": len(tensors),
        "metadata": header.get("__metadata__", {}),
        "tensors": tensors,
    }


def main() -> int:
    out_dir = Path(__file__).resolve().parent.parent / "weights"
    for key, url in MODELS.items():
        print(f"Fetching header: {key} …", file=sys.stderr)
        header = fetch_header(url)
        summary = summarize(header)
        target = out_dir / key / "model.safetensors.header.json"
        target.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"  → {target} ({summary['tensor_count']} tensors)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
