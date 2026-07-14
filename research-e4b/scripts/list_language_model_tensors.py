#!/usr/bin/env python3
"""List language_model tensor names from safetensors header JSON."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "weights"


def main() -> None:
    key = sys.argv[1] if len(sys.argv) > 1 else "e4b"
    header_path = ROOT / key / "model.safetensors.header.json"
    out_path = ROOT / key / "language_model_tensors.txt"
    data = json.loads(header_path.read_text(encoding="utf-8"))
    lines = []
    for t in data["tensors"]:
        name = t["name"]
        if "language_model" not in name:
            continue
        shape = t.get("shape")
        dtype = t.get("dtype")
        lines.append(f"{name}\t{dtype}\t{shape}")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(lines)} tensors → {out_path}")


if __name__ == "__main__":
    main()
