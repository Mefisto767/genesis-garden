#!/usr/bin/env python3
"""Deterministic runtime-derivative builder for Art Vertical Slice A.

Reads the three untouched, high-resolution source PNGs from
`apps/web/art_source/v1/` (never modified by this script — see
docs/ART_VERTICAL_SLICE_A.md for their exact SHA256 hashes) and produces the
three runtime derivatives at the exact canvases from
docs/VISUAL_ASSET_CONTRACT.md §5 (plot base 64x64, plant 64x96), written into
`apps/web/public/assets/...` where the game actually loads them from
(BootSceneOverhaul.ts).

Why a plain full-canvas resize, no content-bbox cropping:
  - plot_empty_source.png is 1254x1254 = exactly 1:1, target is 64x64 = 1:1.
  - both plant sources are 1024x1536 = exactly 2:3, target is 64x96 = 2:3.
  Source and target aspect ratios already match exactly, so no letterboxing
  or aspect-driven cropping is needed to "fit" the target canvas. Cropping to
  a content bounding box would additionally require picking a somewhat
  arbitrary alpha threshold (the raw alpha-channel bbox at threshold 0 is
  contaminated by isolated near-zero antialiasing remnants at the source
  canvas edges: alpha=1 on column 0 of every source), and would risk cutting
  content or distorting aspect ratio. A direct full-canvas NEAREST downscale
  is the simplest operation that satisfies "preserve aspect ratio, alpha,
  remove only the transparent padding required for correct fitting" — no
  padding removal is actually *required* here because nothing needs
  letterboxing. Any transparent margin in the source is preserved
  proportionally in the output, which is normal/expected sprite padding
  (anchors, breathing room), not a defect.

Deterministic: same inputs -> byte-identical outputs (Pillow's NEAREST
resampling is a pure deterministic nearest-index sample, no dithering/RNG).

Run: python3 scripts/build-art-vertical-slice-a.py
(from repo root; requires Pillow — `pip install pillow` if missing.)
"""

from __future__ import annotations

import hashlib
import pathlib
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - environment guard, not test-covered
    print("ERROR: Pillow is required (pip install pillow)", file=sys.stderr)
    raise

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "apps/web/art_source/v1"
TILES_DIR = REPO_ROOT / "apps/web/public/assets/tiles"
PLANTS_DIR = REPO_ROOT / "apps/web/public/assets/plants"

# (source filename, output path, target canvas (w, h))
JOBS = [
    ("plot_empty_source.png", TILES_DIR / "plot_empty.png", (64, 64)),
    ("plant_hybrid_unrevealed_source.png", PLANTS_DIR / "plant_hybrid_unrevealed.png", (64, 96)),
    ("plant_sunflower_mature_source.png", PLANTS_DIR / "plant_sunflower_mature.png", (64, 96)),
]


def sha256_of(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build() -> None:
    for source_name, out_path, target_size in JOBS:
        source_path = SOURCE_DIR / source_name
        if not source_path.exists():
            raise SystemExit(f"missing source: {source_path}")

        with Image.open(source_path) as im:
            im = im.convert("RGBA")
            src_w, src_h = im.size
            tgt_w, tgt_h = target_size
            src_ratio = src_w / src_h
            tgt_ratio = tgt_w / tgt_h
            if abs(src_ratio - tgt_ratio) > 1e-6:
                raise SystemExit(
                    f"{source_name}: source aspect {src_w}x{src_h} ({src_ratio:.4f}) "
                    f"does not match target aspect {tgt_w}x{tgt_h} ({tgt_ratio:.4f}) — "
                    "this script only handles the exact-aspect-match case; a mismatch "
                    "needs an explicit letterbox/crop decision, not a silent stretch."
                )
            derived = im.resize(target_size, resample=Image.NEAREST)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        derived.save(out_path, format="PNG")

        print(
            f"{source_name} ({src_w}x{src_h}, sha256={sha256_of(source_path)[:12]}...) "
            f"-> {out_path.relative_to(REPO_ROOT)} ({tgt_w}x{tgt_h}, "
            f"sha256={sha256_of(out_path)[:12]}...)"
        )


if __name__ == "__main__":
    build()
