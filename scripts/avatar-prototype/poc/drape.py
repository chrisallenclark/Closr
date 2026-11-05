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

# Untucked drapes follow the Closr drape reference sheet: the shirt stays completely outside the
# waistband. Only the shirt's own fabric changes; the hem is never lifted to show the waistband.
UNTUCKED_RULES = (
    "The shirt stays completely untucked and outside the trousers: its hem is below the waistband all the way "
    "around, the waistband and belt loops are fully covered, there is no raised V or arch at the centre and no "
    "part of the shirt goes into the trousers. At the centre front the hem hangs at the same height as the sides "
    "or slightly lower, never higher; any bunching happens in the fabric above the hem, not by lifting the hem. "
    "Keep the shirt's full length."
)

DRAPE = {
    "natural": (
        "Natural untucked drape: the weight of the fabric settles on the hips and the top of the trousers, making "
        "subtle soft horizontal folds and a few gentle diagonal wrinkles just above the hem and a slight sag at the "
        "front. The hem is slightly irregular, a little higher on one side than the other, never a perfectly straight "
        "line. " + UNTUCKED_RULES
    ),
    "smooth": (
        "Smooth untucked drape for a regular or fitted knit: the shirt follows the torso and hangs cleanly to its hem "
        "with only a few light, natural creases near the waist. No bunching, no gathering, no sag; the hem is close "
        "to level with a very slight natural irregularity. " + UNTUCKED_RULES
    ),
    "crisp": (
        "Crisp untucked drape for a woven button-up shirt: the shirt is buttoned and the fabric is a woven cotton or "
        "linen that holds its shape, so it hangs fairly straight from the shoulders with a boxy body, soft vertical "
        "creases and light woven wrinkles rather than knit-like sag or bunching. Keep the collar, placket, buttons, "
        "pocket and the straight hem (with side vents if the photo shows them) exactly as photographed. " + UNTUCKED_RULES
    ),
    "easy": (
        "Easy untucked drape for a relaxed but not boxy knit: the body hangs loosely and fairly straight, with only a "
        "few soft folds just above the hem where it meets the trousers; much lighter than an oversized tee, no "
        "bunching. Keep the neckline, armholes and any cut-off or raw edges exactly as photographed. " + UNTUCKED_RULES
    ),
    "crisp_open": (
        "Worn open: the button-up shirt is completely unbuttoned and the two fronts hang naturally apart from the "
        "collar down, showing a vertical strip of the green mannequin chest and the blue trousers between them (keep "
        "that strip green and blue, nothing else in it). The camp collar lies open and flat, the fronts fall straight "
        "with light woven creases, buttons and buttonholes visible on the edges, straight hem outside the trousers. "
        "Woven fabric that holds its shape; no knit sag."
    ),
    "relaxed": (
        "Relaxed untucked drape: more pronounced casual bunching around the waist, with fuller horizontal folds and "
        "irregular diagonal creases where the loose fabric settles over the top of the trousers, and a gently uneven, "
        "slightly wavy hem. " + UNTUCKED_RULES
    ),
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

# Without an earlier prepared layer to anchor it, the photo alone sets the shirt (image 3 is then the style reference).
SHIRT_PROMPT_NO_ANCHOR = (
    "Image 1: the mannequin wearing blue reference trousers. Image 2: photo of a shirt.{ref} Dress the mannequin in "
    "image 1 in this shirt over the blue trousers. {style} {fit} Copy the shirt exactly from image 2: colour, fabric "
    "texture, rib or weave, neckline, armholes, seams and length. Ignore hangers, beds and backgrounds in image 2. "
    "Do not change the trousers, the mannequin, its pose, the framing or the green background. The mannequin keeps "
    "its short arm caps: do not add arms or hands. Keep the whole figure in frame from the neck cap to the feet at "
    "exactly the same scale and position as image 1; do not zoom in. Photorealistic fashion product photo."
)

SHIRT_PROMPT = (
    "Image 1: the mannequin wearing blue reference trousers. Image 2: photo of a shirt. Image 3: the same shirt "
    "already prepared on this mannequin, hanging freely.{ref} Dress the mannequin in image 1 in this shirt over the "
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
    # Shadowed green (the shirt's shadow on the mannequin, e.g. inside an open front) is dark and only weakly
    # green by difference, but still clearly green by ratio: drop it too.
    dark_green = ((g > 1.3 * r) & (g > 1.25 * b) & (a.mean(axis=2) < 110)).astype(np.float32)
    alpha = 1 - np.maximum.reduce([green, blue, dark_blue, dark_green])
    alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7)))
    # Despill both key colours.
    a[..., 1] = np.minimum(g, np.maximum(r, b))
    a[..., 2] = np.minimum(a[..., 2], np.maximum(r, a[..., 1]) + 6)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")
    out.putalpha(Image.fromarray(alpha))
    return out


def default_drape(observed: dict) -> str:
    """The drape Closr shows by default, from the garment's construction, fit and length.

    oversized/boxy/relaxed knit tees at standard length -> natural (soft folds, slight sag)
    regular or fitted knits, tanks, longline                -> smooth (hangs cleanly)
    woven button-ups (camp, oxford, flannel)                -> crisp (holds its shape)
    Relaxed is never a default; it's prepared when a user asks for it.
    """
    a = observed.get("attributes", {})
    val = lambda k: str((a.get(k) or {}).get("value", "")).lower()
    construction = observed.get("construction", "").lower()
    if any(w in construction for w in ("button", "camp", "oxford", "flannel", "shirt jacket", "overshirt")):
        return "crisp"  # buttoned; "crisp_open" is a separate styling choice (closure), not a different garment
    if val("length") == "longline" or "tank" in construction or val("fit") in ("fitted", "regular", "slim"):
        return "smooth" if val("boxy") != "true" else "natural"
    if val("fit") == "relaxed" and val("boxy") != "true":
        return "easy"  # loose but not boxy: a few soft folds, not the oversized-tee drape
    return "natural"


def untucked_check(render: Image.Image, shirt: Image.Image, wy: int, x0: int, x1: int) -> dict:
    """Free check for untucked drapes: the reference waistband stays covered and the hem doesn't V up.

    exposed     share of the waistband band (top 40 px of the blue trousers) that shows blue
    centre_lift how much higher the hem sits at the centre front than at the sides (px)
    """
    a = np.array(render.convert("RGB")).astype(np.int32)
    band = a[wy : wy + 40, x0 + 25 : x1 - 25]
    blue = (band[..., 2] - np.maximum(band[..., 0], band[..., 1])) > 30
    exposed = float(blue.mean())
    al = np.array(shirt.getchannel("A")) > 128
    cx = (x0 + x1) // 2
    def hem(xa, xb):
        cols = [np.nonzero(al[wy - 100 : wy + 400, x])[0] for x in range(xa, xb)]
        ys = [c[-1] + wy - 100 for c in cols if len(c)]
        return float(np.median(ys)) if ys else float("nan")
    centre = hem(cx - 40, cx + 40)
    sides = (hem(x0 + 10, x0 + 70) + hem(x1 - 70, x1 - 10)) / 2
    lift = sides - centre
    return {"exposed": round(exposed, 3), "centre_lift_px": round(lift, 1), "hem_centre": centre, "hem_sides": sides,
            "ok": bool(exposed < 0.03 and lift < 25)}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-dir", required=True, type=Path, help="v3 base: canonical.png, landmarks.json")
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--ledger", required=True, type=Path)
    p.add_argument("--budget", type=float, default=8.0)
    p.add_argument("--shirt", nargs=3, action="append", metavar=("ID", "PHOTO", "FREE_LAYER"), default=[])
    p.add_argument("--styles", nargs="+", default=["soft", "blouse"])
    p.add_argument("--rekey", action="store_true")
    p.add_argument("--observed", nargs=2, action="append", metavar=("ID", "JSON"), default=[], help="fit reading per shirt, for --styles auto")
    p.add_argument("--fit-note", nargs=2, action="append", metavar=("ID", "TEXT"), default=[], help="fit wording for shirts without an anchor layer")
    p.add_argument("--style-ref", nargs=2, action="append", metavar=("STYLE", "IMAGE"), default=[],
                   help="a drape reference image for a style (fabric behaviour only)")
    p.add_argument("--waistband", type=int, nargs=3, metavar=("Y", "X0", "X1"), default=[754, 395, 713],
                   help="reference trousers' waistband top row and x-range, for the untucked checks")
    args = p.parse_args()
    args.observed = dict(args.observed)
    args.fit_note = dict(args.fit_note)
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
            free = None if free_path == "-" else Image.open(free_path).convert("RGBA")
            free_on_canon = None
            if free is not None:
                # Show image 3 as the free-hanging shirt on the green mannequin, so the model sees size and print.
                free_on_canon = canon.convert("RGBA").copy()
                free_on_canon.alpha_composite(free)
            styles = list(args.styles)
            if "auto" in styles:
                obs = json.loads(Path(args.observed[shirt_id]).read_text()) if shirt_id in args.observed else {}
                styles[styles.index("auto")] = default_drape(obs)
                print(f"{shirt_id}: default drape -> {styles}", flush=True)
            for style in styles:
                name = f"{shirt_id}--{style}"
                raw = args.out / "raw" / f"{name}.png"
                t0 = time.perf_counter()
                refs = dict(args.style_ref)
                if not raw.exists():
                    ref_no = 4 if free is not None else 3
                    ref_text = (f" Image {ref_no} is a styling reference showing only the kind of fabric behaviour wanted at the "
                                "waist; copy how the fabric folds and rests, not that garment, its colour or its length.") if style in refs else ""
                    if free is not None:
                        prompt = SHIRT_PROMPT.format(style=DRAPE[style], ref=ref_text)
                        parts = [{"text": prompt}, jpeg_part(base), jpeg_part(photo), jpeg_part(free_on_canon.convert("RGB"))]
                    else:
                        fit = args.fit_note.get(shirt_id, "")
                        prompt = SHIRT_PROMPT_NO_ANCHOR.format(style=DRAPE[style], ref=ref_text, fit=fit)
                        parts = [{"text": prompt}, jpeg_part(base), jpeg_part(photo)]
                    if style in refs:
                        parts.append(jpeg_part(Image.open(refs[style])))
                    img = generate(name, parts, RENDER_MODEL, ledger, key)
                    img.save(raw)
                img = Image.open(raw).convert("RGB")
                framing = framing_check(img, base, "top")
                if not framing["ok"]:
                    # The model sometimes zooms; undo a plain zoom/shift and check again.
                    # Start from the neck estimate when the neck is visible, and always also from a few
                    # zoom levels, since a render zoomed past the neck gives a meaningless neck estimate.
                    starts = [(z, (1 - z) * img.width / 2, (1 - z) * img.height * 0.15) for z in np.arange(0.5, 0.96, 0.05)]
                    try:
                        est = neck_registration(img, base)
                        if 0.4 < est[0] < 1.6:
                            starts.insert(0, est)
                    except (ZeroDivisionError, IndexError, ValueError):
                        pass
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
                waist = untucked_check(img, layer, *args.waistband) if style in ("natural", "relaxed", "smooth", "crisp", "easy") else None  # open shirts show the waistband by design
                if waist and not waist["ok"]:
                    layer.save(args.out / "layers" / f"{name}.rejected.png")
                    report[name] = {"status": "rejected: not fully untucked", "framing": framing, "waist": waist}
                    print(name, report[name], flush=True)
                    report_path.write_text(json.dumps(report, indent=1))
                    continue
                layer = hue_guard(color_lock(layer, photo, session), photo, session)
                layer.save(args.out / "layers" / f"{name}.png")
                # Read the print back against the photo: drape may fold lower print, never respell it.
                check = report.get(name, {}).get("verify") or verify(photo, img, key, ledger)
                # Folding may blur fine print; missing words, a changed font or a re-drawn graphic are a
                # different garment and the variant is rejected.
                # Small body copy (a paragraph of tiny text) is rendered as approximate print on every
                # model and can't be held to exact spelling; headline text, logos and graphics can.
                ignore = ("fine print", "fine text", "small", "tiny", "descriptive text", "paragraph", "body copy",
                          "tag", "label", "trouser", "pants", "mannequin", "display", "hanger")
                changed = [m for m in check.get("mismatches", []) if not any(w in m.lower() for w in ignore)
                           and any(w in m.lower() for w in ("missing", "font", "altered", "different", "misspell", "redrawn"))]
                status = "rejected: print changed" if changed else "prepared"
                report[name] = {"status": status, "framing": framing, "seconds": round(time.perf_counter() - t0, 1), "verify": check, "print_problems": changed, "waist": waist}
                print(name, report[name], flush=True)
                report_path.write_text(json.dumps(report, indent=1))
    except BudgetExceeded as err:
        print(err, file=sys.stderr)
    report_path.write_text(json.dumps(report, indent=1))
    print(f"spent ${ledger.data['spent_usd']:.2f} of ${args.budget:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
