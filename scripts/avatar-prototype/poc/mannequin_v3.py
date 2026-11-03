"""Canonical mannequin v3: posed after the Closr Build Outfit mockup.

Generates, once, the bare chroma-green mannequin every garment is prepared on, plus the matching
display plate (matte black, dark studio), then measures its landmarks so fit templates follow this
body's pose, including its asymmetric legs.

Usage:
  python mannequin_v3.py --reference mockup.jpg --out <dir> --ledger <ai>/ledger.json [--budget 5]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from ai_prep import BudgetExceeded, Ledger, generate, jpeg_part

MODEL = "gemini-3-pro-image"

CANONICAL = (
    "Image 1 is a fashion app mockup: a headless display mannequin wearing a t-shirt, cargo pants and sneakers. "
    "Create a photorealistic studio photo of that SAME mannequin body with no clothing, no shoes and no "
    "accessories, keeping the reference's camera angle, framing and natural stance: headless male display "
    "mannequin with a short neck stand and flat round cap, no arms (smooth caps at the shoulders), natural "
    "relaxed shoulders, realistic adult male torso with a soft waist, weight resting a little more on the "
    "image-left leg, the image-right knee very slightly relaxed, feet a little wider than hip width with toes "
    "turned slightly outward, both feet flat on the floor and fully visible, legs clearly apart from the crotch "
    "down. Facing the camera, camera at waist height. The whole mannequin is matte uniform chroma-key green "
    "(#00B140) with soft natural shading. Background: flat, evenly lit, slightly lighter chroma-key green, no "
    "floor line, no props, no text. Whole body visible from the neck cap to the feet, centred, filling about "
    "85% of the image height."
)

PLATE = (
    "Keep this exact mannequin: identical pose, proportions, position, size and framing, pixel-aligned. Only "
    "change materials and background: premium matte charcoal-black finish with subtle satin highlights, and "
    "replace the green background with a dark warm charcoal-brown photo studio, a soft warm spotlight glow "
    "behind the mannequin, and a soft contact shadow on the floor under the feet. Photorealistic fashion "
    "product photography, the mood of a premium menswear app."
)


def mask(img: Image.Image) -> np.ndarray:
    """Mannequin silhouette via background removal (the green backdrop has a gradient near the floor)."""
    from rembg import new_session, remove

    alpha = np.array(remove(img.convert("RGB"), session=new_session("isnet-general-use")).getchannel("A"))
    return alpha > 128


def runs(row: np.ndarray, min_len: int = 6) -> list[tuple[int, int]]:
    xs = np.nonzero(row)[0]
    if not len(xs):
        return []
    parts = np.split(xs, np.nonzero(np.diff(xs) > 3)[0] + 1)
    return [(int(p[0]), int(p[-1])) for p in parts if len(p) >= min_len]


def landmarks(canon: Image.Image) -> dict:
    """Shoulders, waist, crotch, and each leg's centre and width at thigh, knee and ankle."""
    from scipy import ndimage

    m = ndimage.binary_opening(mask(canon), iterations=2)
    labels, n = ndimage.label(m)
    sizes = ndimage.sum(m, labels, range(1, n + 1))
    m = labels == (1 + int(np.argmax(sizes)))
    ys = np.nonzero(m.any(axis=1))[0]
    top, feet = int(ys[0]), int(ys[-1])
    width = np.array([(r[-1][1] - r[0][0]) if (r := runs(m[y])) else 0 for y in range(m.shape[0])])
    body = feet - top
    shoulder_y = top + int(np.argmax(width[top : top + int(body * 0.2)] > width[top : top + int(body * 0.2)].max() * 0.85))
    crotch = next(y for y in range(top + int(body * 0.35), feet) if len(runs(m[y])) >= 2 and len(runs(m[y + 12])) >= 2)
    torso = range(shoulder_y + 40, crotch - 60)
    waist_y = min(torso, key=lambda y: width[y])

    def legs(y):
        r = sorted(runs(m[y]), key=lambda r: r[1] - r[0], reverse=True)[:2]
        r = sorted(r)
        return [{"c": (a + b) / 2, "w": b - a} for a, b in r]

    leg_len = feet - crotch
    knee_y = crotch + int(leg_len * 0.45)
    ankle_y = feet - int(leg_len * 0.10)
    cx = float(np.mean([(r[0][0] + r[-1][1]) / 2 for y in range(shoulder_y, waist_y) if (r := runs(m[y]))]))
    return {
        "cx": round(cx),
        "neck_top": top,
        "shoulder_y": shoulder_y,
        "shoulder_w": int(width[shoulder_y + 10]),
        "waist_y": waist_y,
        "waist_w": int(width[waist_y]),
        "hip_y": crotch - 70,
        "hip_w": int(width[crotch - 70]),
        "crotch_y": crotch,
        "knee_y": knee_y,
        "ankle_y": ankle_y,
        "floor_y": feet,
        "legs": {"thigh": legs(crotch + 70), "knee": legs(knee_y), "ankle": legs(ankle_y)},
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--reference", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--ledger", required=True, type=Path)
    p.add_argument("--budget", type=float, default=5.0)
    p.add_argument("--attempt", default="1")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(args.ledger, args.budget)
    key = os.environ["GEMINI_API_KEY"]
    canon_path = args.out / "canonical.png"
    try:
        if not canon_path.exists():
            ref = Image.open(args.reference)
            generate(f"canonical v3 (attempt {args.attempt})", [{"text": CANONICAL}, jpeg_part(ref)], MODEL, ledger, key).save(canon_path)
        canon = Image.open(canon_path).convert("RGB")
        lm = landmarks(canon)
        (args.out / "landmarks.json").write_text(json.dumps(lm, indent=1))
        print(json.dumps(lm))
        if (args.out / "approved").exists() and not (args.out / "plate.png").exists():
            generate("display plate v3", [{"text": PLATE}, jpeg_part(canon)], MODEL, ledger, key).save(args.out / "plate.png")
    except BudgetExceeded as err:
        print(err, file=sys.stderr)
    print(f"spent ${ledger.data['spent_usd']:.2f} of ${args.budget:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
