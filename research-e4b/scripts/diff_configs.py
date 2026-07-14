#!/usr/bin/env python3
"""Print text_config + quantization deltas between E2B and E4B mobile configs."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "weights"


def load(name: str) -> dict:
    return json.loads((ROOT / name / "config.json").read_text(encoding="utf-8"))


def main() -> None:
    e2b, e4b = load("e2b"), load("e4b")
    t2b, t4b = e2b["text_config"], e4b["text_config"]
    keys = sorted(set(t2b) | set(t4b))
    print("## text_config deltas\n")
    for k in keys:
        a, b = t2b.get(k), t4b.get(k)
        if a != b:
            print(f"- **{k}**: E2B={a!r} → E4B={b!r}")
    print("\n## quantization_config.module_quant_configs\n")
    q2b = e2b["quantization_config"]["module_quant_configs"]
    q4b = e4b["quantization_config"]["module_quant_configs"]
    for k in sorted(set(q2b) | set(q4b)):
        a, b = q2b.get(k), q4b.get(k)
        if a != b:
            print(f"- **{k}**: E2B={a} → E4B={b}")


if __name__ == "__main__":
    main()
