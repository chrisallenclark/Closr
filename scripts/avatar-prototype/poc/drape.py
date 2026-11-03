"""Shirt drape prepared in context: on the mannequin wearing reference pants (no model call per swap).

A shirt rendered alone hangs like a curtain because nothing is under its hem. Here each shirt is
prepared ONCE per drape style on the canonical mannequin wearing plain chroma-blue reference pants
with a real waistband, so the image model shows the fabric resting, folding and bunching against
that waistband while staying untucked. Green (mannequin, backdrop) and blue (reference pants) are
keyed out, leaving a reusable shirt layer that sits on any pants with a similar rise.

  base       one-time: canonical mannequin + chroma-blue reference pants (shared by every shirt)
  drape      one-time per shirt and style: the shirt on that base, anchored to the shirt's own
             existing free-hanging layer so size, length and print stay the same

Styles: free (the existing layer), soft (natural waist bunching), blouse (relaxed blousing).

Usage:
  python drape.py --base-dir <v3 base> --out <dir> --ledger <ledger.json> --budget 8 \
      --shirt bora-bora-tee photos/bora-bora-tee.jpg layers/bora-bora-tee.png --styles soft blouse
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from ai_prep import BudgetExceeded, Ledger, color_lock, generate, jpeg_part
from fit_spec import Spec, guide_image, silhouette, use_landmarks
from fit_spec import apply_registration, neck_registration
from prep_v2 import RENDER_MODEL, clean_layer, framing_check, hue_guard, refine_registration, verify

REF_PANTS = (
    "Image 1 is the mannequin with a flat light-grey placeholder shape. Replace the grey shape with plain "
    "relaxed-fit cotton trousers in matte chroma-key blue (#1E3CC8): mid-rise, worn at the natural waist, with a "
    "clearly visible waistband, belt loops and a fly, two front pockets, no logos, no labels, no belt. The legs "
    "fall straight to a slight break at the ankle. Keep everything outside the grey shape exactly as in image 1: "
    "the green mannequin, its pose, size and proportions, the framing and the green background. Photorealistic."
)

DRAPE = {
    "soft": (
        "Natural soft waist bunching, untucked: the shirt rests on the hips and on the waistband of the blue "
        "trousers. Just above the waistband the fabric settles into soft horizontal and diagonal folds where it "
        "meets the trousers. The hem is not a straight line: it lifts slightly at the centre front and on one side "
        "and hangs a little lower on the other, so a small part of the waistband shows in one place."
    ),
    "blouse": (
        "Relaxed blousing, untucked: the lower part of the shirt pouches gently forward and gathers above the "
        "waistband in fuller, more pronounced folds, the way an oversized tee looks when it settles on the "
        "trousers. The hem rises a little more at the front and one side, showing a strip of the waistband there, "
        "and hangs lower at the other side. Never tucked in."
    ),
}

SHIRT_PROMPT = (
    "Image 1: the mannequin wearing blue reference trousers. Image 2: photo of a shirt. Image 3: the same shirt "
    "already prepared on this mannequin, hanging freely. Dress the mannequin in image 1 in this shirt over the "
    "blue trousers. {style} Keep the shirt exactly as in image 3 through the chest, shoulders and sleeves: same "
    "size, width, sleeve length and overall length (the hem may rise or fall a little where it drapes, but do not "
    "shorten or crop it), same colour and wash, and every print, word and graphic in the same place, size and "
    "spelling as in images 2 and 3. Folds may pass over lower print naturally but text must stay readable and "
    "correctly spelled. The print is the most important thing to keep: same font, same size relative to the "
    "chest, every line of text present (including small lines), same graphic, exactly as in image 3; only the "
    "fabric below it may fold. Do not tuck the shirt in. Do not change the trousers, the mannequin, its pose, the "
    "framing or the green background. Photorealistic fashion product photo."
)


def key_shirt(render: Image.Image) -> Image.Image:
    """Remove the green mannequin/backdrop and the blue reference trousers; keep the shirt."""
    a = np.array(render.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = np.clip(((g - np.maximum(r, b)) - 18) / 40, 0, 1)
    blue = np.clip(((b - np.maximum(r, g)) - 22) / 40, 0, 1)
    # Shadowed blue fabric is dark and less saturated: also drop dark pixels that lean blue.
    dark_blue = ((b > r + 8) & (b > g + 4) & (a.mean(axis=2) < 70)).astype(np.float32)
    alpha = 1 - np.maximum.reduce([green, blue, dark_blue])
    alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7)))
    # Despill both key colours.
    a[..., 1] = np.minimum(g, np.maximum(r, b))
    a[..., 2] = np.minimum(a[..., 2], np.maximum(r, a[..., 1]) + 6)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")
    out.putalpha(Image.fromarray(alpha))
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-dir", required=True, type=Path, help="v3 base: canonical.png, landmarks.json")
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--ledger", required=True, type=Path)
    p.add_argument("--budget", type=float, default=8.0)
    p.add_argument("--shirt", nargs=3, action="append", metavar=("ID", "PHOTO", "FREE_LAYER"), default=[])
    p.add_argument("--styles", nargs="+", default=["soft", "blouse"])
    p.add_argument("--rekey", action="store_true")
    args = p.parse_args()
    for sub in ("raw", "layers"):
        (args.out / sub).mkdir(parents=True, exist_ok=True)
    key = os.environ.get("GEMINI_API_KEY", "")
    ledger = Ledger(args.ledger, args.budget)
    use_landmarks(args.base_dir / "landmarks.json")
    canon = Image.open(args.base_dir / "canonical.png").convert("RGB")
    report_path = args.out / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}

    from rembg import new_session

    session = new_session("isnet-general-use")
    try:
        base_path = args.out / "base-ref-pants.png"
        if not base_path.exists():
            spec = Spec({"category": "bottom", "override": {"leg_shape": "relaxed", "stack": "slight"}}, {}, {})
            guide = guide_image(canon, silhouette(spec))
            base = generate("reference pants base", [{"text": REF_PANTS}, jpeg_part(guide)], RENDER_MODEL, ledger, key)
            base.save(base_path)
        base = Image.open(base_path).convert("RGB")
        report["base"] = framing_check(base, canon, "bottom")
        print("base framing", report["base"], flush=True)
        if not report["base"]["ok"]:
            print("reference base doesn't line up with the canonical mannequin; stopping", file=sys.stderr)
            return 1

        for shirt_id, photo_path, free_path in args.shirt:
            photo = ImageOps.exif_transpose(Image.open(photo_path)).convert("RGB")
            free = Image.open(free_path).convert("RGBA")
            # Show image 3 as the free-hanging shirt on the green mannequin, so the model sees size and print.
            free_on_canon = canon.convert("RGBA").copy()
            free_on_canon.alpha_composite(free)
            for style in args.styles:
                name = f"{shirt_id}--{style}"
                raw = args.out / "raw" / f"{name}.png"
                t0 = time.perf_counter()
                if not raw.exists():
                    prompt = SHIRT_PROMPT.format(style=DRAPE[style])
                    img = generate(name, [{"text": prompt}, jpeg_part(base), jpeg_part(photo), jpeg_part(free_on_canon.convert("RGB"))], RENDER_MODEL, ledger, key)
                    img.save(raw)
                img = Image.open(raw).convert("RGB")
                framing = framing_check(img, base, "top")
                if not framing["ok"]:
                    # The model sometimes zooms; undo a plain zoom/shift and check again.
                    try:
                        starts = [neck_registration(img, base)]
                    except (ZeroDivisionError, IndexError, ValueError):
                        # Neck not found (zoomed past it): try a few zoom levels around the centre.
                        starts = [(z, (1 - z) * img.width / 2, (1 - z) * img.height * 0.15) for z in (0.75, 0.82, 0.9)]
                    best = max((refine_registration(img, base, "top", *st) for st in starts),
                               key=lambda r: framing_check(apply_registration(img, *r, fill=(0, 0, 0)), base, "top")["ncc"])
                    sc, dx, dy = best
                    fill = tuple(int(v) for v in np.median(np.array(img)[:, :20].reshape(-1, 3), axis=0))
                    moved = apply_registration(img, sc, dx, dy, fill=fill)
                    again = framing_check(moved, base, "top")
                    if again["ncc"] > 0.93:
                        img, framing = moved, {**again, "ok": True, "registered": [round(sc, 3), round(dx), round(dy)]}
                if not framing["ok"]:
                    report[name] = {"status": "rejected: mannequin changed", "framing": framing}
                    print(name, report[name], flush=True)
                    continue
                layer = clean_layer(key_shirt(img))
                layer = hue_guard(color_lock(layer, photo, session), photo, session)
                layer.save(args.out / "layers" / f"{name}.png")
                # Read the print back against the photo: drape may fold lower print, never respell it.
                check = report.get(name, {}).get("verify") or verify(photo, img, key, ledger)
                # Folding may blur fine print; missing words, a changed font or a re-drawn graphic are a
                # different garment and the variant is rejected.
                ignore = ("fine print", "small", "tag", "label", "trouser", "pants", "mannequin", "display", "hanger")
                changed = [m for m in check.get("mismatches", []) if not any(w in m.lower() for w in ignore)
                           and any(w in m.lower() for w in ("missing", "font", "altered", "different", "misspell", "redrawn"))]
                status = "rejected: print changed" if changed else "prepared"
                report[name] = {"status": status, "framing": framing, "seconds": round(time.perf_counter() - t0, 1), "verify": check, "print_problems": changed}
                print(name, report[name], flush=True)
                report_path.write_text(json.dumps(report, indent=1))
    except BudgetExceeded as err:
        print(err, file=sys.stderr)
    report_path.write_text(json.dumps(report, indent=1))
    print(f"spent ${ledger.data['spent_usd']:.2f} of ${args.budget:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
