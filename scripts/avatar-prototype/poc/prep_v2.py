"""Fit-driven one-time garment preparation (v2 of ai_prep.py).

Same reusable-asset architecture: each garment is prepared once into a layer aligned to the canonical
mannequin, and outfits are stacked layers with no model call per swap. What changes is what goes
into that one preparation:

  1. fit spec      measured proportions + observed attributes (fit_spec.py), with confidences
  2. text gate     if text or a logo is only partly visible, stop and ask for another photo
                   instead of letting the model guess letters
  3. render        prompt built from the spec (fit words, landmark targets, exact text and which
                   side each logo is on, things to leave out) plus a silhouette guide image
  4. clean-up      chroma key, largest-piece clean-up, despill, colour match to the photo
  5. fit check     measure the layer against the targets; tops that land too long get their lower
                   body shortened (image processing), anything else is reported
  6. verify        a cheap vision call reads the prepared garment back and compares text and logo
                   sides with the spec

Changing one garment's fit re-runs only steps 3–6 for that garment.

Usage:
  python prep_v2.py --manifest m.json --photos <dir> --out <dir> --base <ai dir> [--budget 4.5]
  python prep_v2.py ... --shoes          # placeholder shoe layer
  python prep_v2.py ... --fit-sheets     # fit picker illustrations
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

from ai_prep import BudgetExceeded, Ledger, align, color_lock, generate, jpeg_part, key_layer, neck_anchor  # noqa: F401
from fit_spec import M, Spec, apply_registration, classify, garment_mask_from, guide_image, measure_bottom, measure_top, silhouette

RENDER_MODEL = "gemini-3-pro-image"
VISION_MODEL = "gemini-3.5-flash"

# Proportions taken from the Closr Build Outfit mockup: they set the aesthetic for each fit class,
# expressed against the mannequin, while the item's own attributes decide which class applies.
# Width words per fit. Length is separate (LENGTH_LOOK): an oversized tee is wide, not long.
TOP_LOOK = {
    "fitted": "close to the torso, shoulder seams on the shoulder points",
    "regular": "straight through the body with a little ease",
    "relaxed": "easy through the body, slightly dropped shoulders",
    "boxy": "wide and square through the body, slightly dropped shoulders",
    "oversized": (
        "wide and boxy: dropped shoulder seams well past the shoulder points, body clearly wider than the "
        "torso, roomy sleeves falling toward the elbow, soft drape"
    ),
}
LENGTH_LOOK = {
    "cropped": "Length: cropped, the hem ends just above the waistband, showing it.",
    "short": "Length: short, the hem just covers the waistband.",
    "standard": "Length: balanced, the hem ends at the hip line, covering the waistband by about a hand's width. Not thigh length.",
    "long": "Length: long, the hem ends at the top of the thigh.",
    "longline": "Length: longline, the hem reaches the upper thigh.",
}

LEG_LOOK = {
    "skinny": "skinny: close to the leg from hip to ankle",
    "slim": "slim: close through the thigh, narrowing to the ankle",
    "straight": "straight: the same width from knee to hem, falling straight down",
    "relaxed": "relaxed: easy through the thigh, straight from knee to hem",
    "baggy": (
        "baggy: full and roomy through the hip and thigh, the leg stays wide past the knee and falls to a "
        "wide hem, about the same width as at the knee; visible volume and soft vertical folds"
    ),
    "wide-leg": (
        "wide-leg: very full from the hip down, each leg as wide at the hem as at the thigh, the fabric "
        "hanging in large soft folds with clear space between the leg and the mannequin's leg"
    ),
    "extra-wide": (
        "extra-wide: very loose from the hip down, the leg even wider at the hem than at the thigh, heavy "
        "fabric hanging in deep vertical folds, a lot of air around the mannequin's leg"
    ),
}
STACK_LOOK = {
    "none": "The hems end at the ankle with no break.",
    "slight": "The hems end at the ankle with a slight break over the shoe tops.",
    "stacked": "The hems stack in two or three soft folds over the shoe tops, ending just above the floor.",
    "heavy": "The hems pool heavily in several deep stacked folds over the shoes, covering the laces, the back hem nearly touching the floor.",
}


def text_gate(observed: dict) -> list[str]:
    """Reasons to ask for another photo instead of rendering (never let the model guess letters)."""
    problems = []
    for t in observed.get("visible_text", []):
        if minor(t):
            continue  # labels, tags and small patches are rendered without readable words
        if t.get("legibility") != "clear" and "?" in t.get("text", "") and len(t["text"]) < 40:
            problems.append(f"“{t['text']}” on the {t.get('location')} is partly hidden")
    if observed.get("needs_another_photo"):
        problems.append(observed.get("reason") or "the photo doesn't show the whole garment")
    return problems


SMALL = ("label", "tag", "waistband", "pocket", "patch", "flap", "button", "rivet")


def minor(t: dict) -> bool:
    return any(w in t.get("location", "").lower() for w in SMALL)


def build_prompt(spec: Spec, template: bool = False) -> str:
    o, item, t = spec.observed, spec.item, spec.targets()
    attrs = o.get("attributes", {})
    val = spec.attr  # the user's choice wins over what was observed
    graphics = []
    for g in o.get("visible_text", []):
        if any(w in g.get("location", "").lower() for w in ("label", "tag", "waistband")):
            continue  # inner labels: left out
        if minor(g):
            graphics.append(f"small patch on the {g['location']}, {g['side']}: keep the patch, no readable words")
        elif g.get("legibility") == "clear":
            graphics.append(f"text “{g['text']}” on the {g['location']}, {g['side']} as seen in image 2")
        else:
            graphics.append(f"small print on the {g['location']}: keep it as small illegible print, do not write new words")
    for g in o.get("logos", []):
        graphics.append(f"{g['description']} on the {g['location']}, {g['side']} as seen in image 2")
    keep_sides = (
        "Keep every graphic on the same side of the garment as in image 2 (do not mirror): "
        + "; ".join(graphics) + ". "
        if graphics else "The garment has no graphics or text on the outside: add none. "
    )
    leave_out = ", ".join(o.get("ignore", []) + ["store tags", "price stickers", "size stickers", "hanger"])

    if item["category"] == "top":
        look = TOP_LOOK.get(t["fit"], TOP_LOOK["regular"]) + ". " + LENGTH_LOOK.get(t["length_class"], LENGTH_LOOK["standard"])
        shape = (
            f"Construction: {o.get('construction', 'top')}. Fit: {look} "
            f"{'Boxy, not tapered. ' if str(val('boxy')).lower() == 'true' else ''}"
            f"Shoulders: {val('shoulder_drop') or 'as photographed'}. Sleeves: {val('sleeve_length') or 'as photographed'}. "
            "Image 3 shows the target outline as a flat grey shape on the mannequin: match its width and "
            "especially where the hem ends."
        )
        dress = "Dress the mannequin from image 1 in ONLY this top. Hem loose, not tucked. The legs stay bare green mannequin."
    else:
        leg = t["leg"]
        stack = STACK_LOOK.get(t["stack"], STACK_LOOK["none"])
        details = []
        if str(val("cargo_pockets")).lower() == "true":
            details.append("cargo pockets on the outer thighs, sitting full on the side of the leg")
        if str(val("carpenter_details")).lower() == "true":
            details.append("carpenter details (hammer loop, utility pocket, double knee) exactly as photographed")
        shape = (
            f"Construction: {o.get('construction', 'trousers')}. Leg: {LEG_LOOK.get(leg, LEG_LOOK['straight'])}. "
            f"Rise: {val('rise') or 'mid'}. {'; '.join(details) + '. ' if details else ''}{stack} "
            "Image 3 shows the target outline as a flat grey shape on the mannequin: match the leg width at the "
            "thigh, knee and hem."
        )
        dress = "Dress the mannequin from image 1 in ONLY these trousers, worn at the natural waist. The torso stays bare green mannequin."

    if template:
        # Template edit: image 1 already carries the target outline, so the model fills a fixed shape
        # instead of choosing the garment's width and the mannequin's proportions itself.
        noun = "top" if item["category"] == "top" else "trousers"
        dress = (
            f"Image 1 is the mannequin with a flat light-grey placeholder shape. Replace the grey shape with ONLY the "
            f"{noun} from image 2, filling the grey outline: same waist position, same width at every height, same "
            "hem position, with realistic folds and volume inside that outline."
        )
        shape = shape.split(" Image 3 shows")[0]
        frame = "Keep everything outside the grey shape exactly as in image 1: mannequin, its size and proportions, framing, green background."
    else:
        frame = (
            "Keep the mannequin's pose, size, position, framing and the green background exactly as in image 1. "
            "Do not draw image 3's grey shape; it is only a guide."
        )
    return (
        f"{dress} {shape} Copy the garment from image 2 exactly: colour ({o.get('colour', 'as photographed')}), "
        f"wash, fabric texture, stitching, seams, pockets and hardware. {keep_sides}"
        f"Leave out: {leave_out}. Do not invent text, logos, labels or details that are not clearly visible in "
        f"image 2. {frame} Photorealistic fashion product photo."
    )


def clean_layer(layer: Image.Image) -> Image.Image:
    """Keep the garment's main piece(s); drop keyed specks on the floor or background."""
    a = np.array(layer.getchannel("A")) > 64
    labels, n = ndimage.label(a)
    if n > 1:
        sizes = ndimage.sum(a, labels, range(1, n + 1))
        keep = np.isin(labels, 1 + np.nonzero(sizes > sizes.max() * 0.05)[0])
        alpha = np.array(layer.getchannel("A")) * keep
        layer = layer.copy()
        layer.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return layer


def hue_guard(layer: Image.Image, photo: Image.Image, session) -> Image.Image:
    """Pull green-shifted pixels back to the garment's own hue (green-screen light on the fabric).

    Only for garments that aren't green in the photo; saturation and brightness (the folds and
    wash) are kept, only the hue moves. An olive or green garment is left untouched.
    """
    from rembg import remove
    from wardrobe_poc import garment_mask

    small = photo.copy()
    small.thumbnail((800, 800))
    cut = remove(small, session=session)
    m = garment_mask(np.array(cut.getchannel("A")))
    hsv_photo = np.array(cut.convert("RGB").convert("HSV")).astype(np.float32)
    sel = hsv_photo[m]
    sel = sel[sel[:, 1] > 25]  # ignore near-grey pixels: their hue is noise
    if len(sel) < 200:
        return layer
    ang = sel[:, 0] / 255 * 2 * np.pi
    target = (np.degrees(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360)
    if 50 <= target <= 170:
        return layer  # the garment really is green/olive
    hsv = np.array(layer.convert("RGB").convert("HSV")).astype(np.float32)
    hue = hsv[..., 0] / 255 * 360
    greenish = (hue >= 48) & (hue <= 175) & (np.array(layer.getchannel("A")) > 0)
    hsv[..., 0] = np.where(greenish, target / 360 * 255, hsv[..., 0])
    out = Image.fromarray(hsv.clip(0, 255).astype(np.uint8), "HSV").convert("RGBA")
    out.putalpha(layer.getchannel("A"))
    return out


def measure_layer(layer: Image.Image, category: str) -> dict:
    a = np.array(layer.getchannel("A")) > 128
    ys = np.nonzero(a.any(axis=1))[0]
    if not len(ys):
        return {}

    def width(y):
        xs = np.nonzero(a[min(y, a.shape[0] - 1)])[0]
        return int(xs[-1] - xs[0]) if len(xs) else 0

    def leg(y):
        row = a[min(y, a.shape[0] - 1)]
        xs = np.nonzero(row)[0]
        if not len(xs):
            return 0
        parts = np.split(xs, np.nonzero(np.diff(xs) > 2)[0] + 1)
        parts = sorted(parts, key=len, reverse=True)[:2]
        return int(np.mean([p[-1] - p[0] for p in parts]))

    if category == "top":
        # Hem: last row that is still a real part of the body (ignores thin shadows and specks).
        rows = a.sum(axis=1)
        solid = np.nonzero(rows > rows.max() * 0.3)[0]
        return {"hem_y": int(solid[-1]), "body_w": width(M["shoulder_y"] + 300)}
    return {"thigh": leg(M["crotch_y"] + 60), "knee": leg(M["knee_y"]), "hem": leg(M["ankle_y"] - 40), "bottom_y": int(ys[-1])}


def refine_registration(dressed: Image.Image, canonical: Image.Image, category: str, sc: float, dx: float, dy: float):
    """Search scale/offset near an estimate for the best bare-band match, at quarter resolution (fast)."""
    k = 0.25
    small = dressed.convert("RGB").resize((round(dressed.width * k), round(dressed.height * k)), Image.BILINEAR)
    canon_small = canonical.convert("RGB").resize((270, 480))
    bg = tuple(int(v) for v in np.median(np.array(small)[:, :5].reshape(-1, 3), axis=0))
    best = (-1.0, sc, dx, dy)
    for step_s, step_o, span in ((0.02, 8, 4), (0.005, 2, 4)):
        s0, x0, y0 = best[1], best[2], best[3]
        for ds in np.arange(-span, span + 1) * step_s:
            for ox in np.arange(-span, span + 1) * step_o:
                for oy in np.arange(-span, span + 1) * step_o:
                    s1, x1, y1 = s0 + ds, x0 + ox * 4 / 4, y0 + oy * 4 / 4
                    cand = apply_registration(small, s1, x1 * k, y1 * k, size=(270, 480), fill=bg)
                    score = framing_check(cand, canon_small, category)["ncc"]
                    if score > best[0]:
                        best = (score, s1, x1, y1)
    return best[1], best[2], best[3]


def framing_check(dressed: Image.Image, canonical: Image.Image, category: str = "bottom") -> dict:
    """Reject renders where the model changed the mannequin (zoom, shift, a different body).

    Layers are only reusable if every garment sits on the same body. Each kind of garment leaves a
    band of the mannequin bare (the torso above the waistband for pants, the neck and shoulders for
    tops). In that band, the render's bare green pixels must correlate with the canonical image:
    aligned renders score about 0.99, a 40 px shift about 0.7, a different mannequin below 0.6.
    """
    a = np.array(canonical.convert("RGB").resize((270, 480))).astype(np.float32)
    b = np.array(dressed.convert("RGB").resize((270, 480))).astype(np.float32)
    green = lambda x: (x[..., 1] - np.maximum(x[..., 0], x[..., 2])) > 25
    if category == "bottom":
        y0, y1 = M["shoulder_y"] // 4, (M["waist_y"] - 40) // 4
    else:
        y0, y1 = 150 // 4, (M["shoulder_y"] + 40) // 4
    both = green(a[y0:y1]) & green(b[y0:y1])  # bare in both: garment pixels drop out
    if both.sum() < 200:
        return {"band": [y0 * 4, y1 * 4], "ncc": 0.0, "ok": False}
    x, y = a[y0:y1, :, 1][both], b[y0:y1, :, 1][both]
    x, y = x - x.mean(), y - y.mean()
    ncc = float((x * y).sum() / np.sqrt((x * x).sum() * (y * y).sum() + 1e-6))
    return {"band": [y0 * 4, y1 * 4], "ncc": round(ncc, 3), "ok": bool(ncc > 0.95)}


VERIFY_PROMPT = """Image 1 is the original photo of a garment. Image 2 is a product render of the same garment.
Return JSON only: {"text_in_render": [{"text": ..., "side": "image-left"|"centre"|"image-right"}],
"logos_in_render": [{"description": ..., "side": ...}], "extra_items_in_render": [tags, stickers, labels or
details not on the original], "colour_match": "same"|"close"|"different", "mismatches": [plain sentences]}.
Compare carefully: spelling, which side each graphic is on, missing or invented details."""


def verify(photo: Image.Image, render: Image.Image, key: str, ledger: Ledger) -> dict:
    import urllib.request

    body = {
        "contents": [{"parts": [{"text": VERIFY_PROMPT}, jpeg_part(photo, 1280), jpeg_part(render, 1280)]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    ledger.check(VISION_MODEL)
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        data = json.load(res)
    ledger.record("verify", VISION_MODEL, data.get("usageMetadata", {}), time.perf_counter() - t0)
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    return json.loads(text[text.find("{") : text.rfind("}") + 1])


# --------------------------------------------------------------------------- one-off assets

SHOES_PROMPT = (
    "Keep this exact mannequin, pose, size, framing and green background. Put chunky off-white and light grey "
    "suede-and-mesh runner sneakers with white soles on its feet, following the feet exactly as they stand, no "
    "logos, no text. Change nothing else."
)

REAL_SHOES_PROMPT = (
    "Put the pair of shoes from image 2 on the feet of the mannequin in image 1: one shoe on each foot, "
    "following the feet exactly as they stand (same angle, same turn-out), laces tied neatly. Image 2 may show "
    "a single shoe from the side: infer the matching pair and how it looks from the front. Copy colours, "
    "materials (suede, mesh, leather), stitching, sole colour and any logo exactly as photographed; where a "
    "side logo would face away from the camera, show it only as it would really appear. Do not invent text. "
    "Ignore hands, floors, boxes and other shoes in image 2. Keep the mannequin, its pose, size, position, "
    "framing and the green background exactly as in image 1. Photorealistic."
)


def prepare_shoes(shoe_id: str, photo: Image.Image, canon: Image.Image, out: Path, ledger: Ledger, key: str, session) -> dict:
    """Shoes are their own layer under the pants; the torso stays bare, so the pants alignment band applies."""
    raw_path = out / "raw" / f"{shoe_id}.png"
    if raw_path.exists():
        dressed = Image.open(raw_path).convert("RGB")
    else:
        dressed = generate(shoe_id, [{"text": REAL_SHOES_PROMPT}, jpeg_part(canon), jpeg_part(photo)], RENDER_MODEL, ledger, key)
        dressed.save(raw_path)
    framing = framing_check(dressed, canon, "bottom")
    if not framing["ok"]:
        return {"status": "rejected: mannequin changed", "framing": framing}
    layer = clean_layer(key_layer(dressed))
    a = np.array(layer.getchannel("A"))
    a[: M["ankle_y"] - 90] = 0  # only the feet: anything above is mannequin that failed to key
    layer.putalpha(Image.fromarray(a))
    layer = hue_guard(color_lock(layer, photo, session), photo, session)
    layer.save(out / "layers" / f"{shoe_id}.png")
    return {"status": "prepared", "framing": framing}


FIT_SHEET = {
    "tops": (
        "Photorealistic fashion fit chart. Five identical headless armless matte black display mannequins in a "
        "row, same size and pose, evenly spaced, on a dark warm charcoal studio background. Each wears the same "
        "plain heather-grey crew-neck t-shirt with no graphics, in a different fit, left to right: 1 fitted (close "
        "to the torso, hem at the hips), 2 regular (a little ease, hem just below the waist), 3 boxy (wide and "
        "square, short, hem at the waist), 4 relaxed (easy, slightly dropped shoulders, hem at the hip), "
        "5 oversized (very wide, dropped shoulders, elbow sleeves, hem at the hip line). The mannequins wear the "
        "same plain black straight trousers. No text or labels anywhere. 16:9."
    ),
    "bottoms": (
        "Photorealistic fashion fit chart. Five identical headless armless matte black display mannequins in a "
        "row, same size and pose, evenly spaced, on a dark warm charcoal studio background. Each wears the same "
        "plain mid-blue denim jeans in a different leg shape, left to right: 1 slim (narrowing to the ankle), "
        "2 straight (same width knee to hem), 3 relaxed (easy thigh, straight leg), 4 baggy (full thigh and knee, "
        "wide hem stacking over the shoes), 5 wide-leg (very full, as wide at the hem as the thigh). All wear the "
        "same plain black t-shirt tucked in and plain white sneakers. No text or labels anywhere. 16:9."
    ),
}


def fit_sheet(kind: str, key: str, ledger: Ledger) -> Image.Image:
    from ai_prep import CANVAS  # noqa: F401  (generate() resizes to the 9:16 canvas; sheets need 16:9)
    import base64
    import io
    import urllib.request

    ledger.check(RENDER_MODEL)
    body = {
        "contents": [{"parts": [{"text": FIT_SHEET[kind]}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"}},
    }
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{RENDER_MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=240) as res:
        data = json.load(res)
    ledger.record(f"fit sheet: {kind}", RENDER_MODEL, data.get("usageMetadata", {}), time.perf_counter() - t0)
    for part in data["candidates"][0]["content"]["parts"]:
        blob = part.get("inline_data") or part.get("inlineData")
        if blob:
            return Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB")
    raise RuntimeError("no image")


# --------------------------------------------------------------------------- main


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--manifest", required=True, type=Path)
    p.add_argument("--photos", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--base", required=True, type=Path, help="folder with canonical.png, plate.png and ledger.json")
    p.add_argument("--budget", type=float, default=4.5)
    p.add_argument("--only", nargs="*")
    p.add_argument("--shoes", action="store_true")
    p.add_argument("--fit-sheets", action="store_true")
    p.add_argument("--template", action="store_true", help="edit the silhouette guide instead of dressing the bare mannequin")
    p.add_argument("--rekey", action="store_true", help="rebuild layers from saved renders, no API calls")
    p.add_argument("--dry-run", action="store_true", help="build specs and guides only, no renders")
    p.add_argument("--shoe", nargs=2, action="append", metavar=("ID", "PHOTO"), help="prepare a real pair of shoes from a photo")
    p.add_argument("--ledger", type=Path, help="spending ledger (default: <base>/ledger.json)")
    args = p.parse_args()

    key = os.environ.get("GEMINI_API_KEY", "")
    for sub in ("spec", "raw", "layers", "guides"):
        (args.out / sub).mkdir(parents=True, exist_ok=True)
    ledger = Ledger(args.ledger or args.base / "ledger.json", args.budget)
    canon = Image.open(args.base / "canonical.png").convert("RGB")
    if (args.base / "landmarks.json").exists():
        from fit_spec import use_landmarks

        use_landmarks(args.base / "landmarks.json")
    ref = neck_anchor(canon)

    from rembg import new_session

    session = new_session("isnet-general-use")
    report = json.loads((args.out / "report.json").read_text()) if (args.out / "report.json").exists() else {}

    try:
        if args.shoes and not (args.out / "layers" / "placeholder-sneakers.png").exists():
            dressed = generate("placeholder sneakers", [{"text": SHOES_PROMPT}, jpeg_part(canon)], RENDER_MODEL, ledger, key)
            dressed.save(args.out / "raw" / "placeholder-sneakers.png")
            layer = clean_layer(align(key_layer(dressed), dressed, ref))
            # Keep only the feet area: anything above the ankles is mannequin that failed to key.
            a = np.array(layer.getchannel("A"))
            a[: M["ankle_y"] - 40] = 0
            layer.putalpha(Image.fromarray(a))
            layer.save(args.out / "layers" / "placeholder-sneakers.png")

        for shoe_id, shoe_photo in args.shoe or []:
            photo = ImageOps.exif_transpose(Image.open(args.photos / shoe_photo)).convert("RGB")
            t0 = time.perf_counter()
            report[shoe_id] = {**prepare_shoes(shoe_id, photo, canon, args.out, ledger, key, session), "seconds": round(time.perf_counter() - t0, 1)}
            print(f"{shoe_id}: {report[shoe_id]}", flush=True)

        if args.fit_sheets:
            for kind in ("tops", "bottoms"):
                path = args.out / f"fit-sheet-{kind}.png"
                if not path.exists():
                    fit_sheet(kind, key, ledger).save(path)

        for item in json.loads(args.manifest.read_text())["items"]:
            if args.only is not None and item["id"] not in args.only:
                continue
            if (args.out / "layers" / f"{item['id']}.png").exists() and not args.rekey:
                continue
            t_start = time.perf_counter()
            photo = ImageOps.exif_transpose(Image.open(args.photos / item["photo"])).convert("RGB")
            mask = garment_mask_from(photo, session)
            measured = measure_bottom(mask) if item["category"] == "bottom" else measure_top(mask)
            obs_path = args.out / "spec" / f"{item['id']}.observed.json"
            observed = json.loads(obs_path.read_text()) if obs_path.exists() else classify(photo, key, VISION_MODEL, ledger)
            obs_path.write_text(json.dumps(observed, indent=1))
            spec = Spec(item, measured, observed)
            (args.out / "spec" / f"{item['id']}.json").write_text(json.dumps(spec.to_json(), indent=1, default=float))

            problems = text_gate(observed)
            if problems:
                report[item["id"]] = {"status": "needs another photo", "problems": problems}
                print(f"{item['id']}: needs another photo: {problems}", flush=True)
                continue

            sil = silhouette(spec)
            guide = guide_image(canon, sil)
            guide.save(args.out / "guides" / f"{item['id']}.jpg", quality=85)
            prompt = build_prompt(spec, template=args.template)
            if args.dry_run:
                print(f"{item['id']}: targets={spec.targets()}", flush=True)
                continue
            raw_path = args.out / "raw" / f"{item['id']}.png"
            if args.rekey and raw_path.exists():
                dressed = Image.open(raw_path).convert("RGB")
            else:
                parts = [{"text": prompt}, jpeg_part(guide), jpeg_part(photo)] if args.template else [
                    {"text": prompt}, jpeg_part(canon), jpeg_part(photo), jpeg_part(guide)]
                dressed = generate(item["id"], parts, RENDER_MODEL, ledger, key)
                dressed.save(raw_path)

            framing = framing_check(dressed, canon, item["category"])
            if not framing["ok"]:
                # A plain zoom or shift can be undone; a changed body cannot, and is rejected below.
                from fit_spec import apply_registration, neck_registration

                sc, dx, dy = neck_registration(dressed, canon)
                bg = tuple(int(v) for v in np.median(np.array(dressed)[:, :20].reshape(-1, 3), axis=0))
                sc, dx, dy = refine_registration(dressed, canon, item["category"], sc, dx, dy)
                moved = apply_registration(dressed, sc, dx, dy, fill=bg)
                again = framing_check(moved, canon, item["category"])
                # Rescaling blurs the render a little, which costs a few points of correlation;
                # misaligned renders score 0.7 or less, so 0.93 still separates them clearly.
                again["ok"] = bool(again["ncc"] > 0.93)
                if again["ok"]:
                    dressed, framing = moved, {**again, "registered": [round(sc, 3), round(dx), round(dy)]}
            if not framing["ok"]:
                report[item["id"]] = {"status": "rejected: mannequin changed", "framing": framing, "prompt": prompt}
                print(f"{item['id']}: REJECTED, mannequin proportions changed {framing}", flush=True)
                continue
            layer = clean_layer(key_layer(dressed))
            layer = hue_guard(color_lock(layer, photo, session), photo, session)
            layer.save(args.out / "layers" / f"{item['id']}.png")
            after = measure_layer(layer, item["category"])

            plate = Image.open(args.base / "plate.png").convert("RGBA")
            plate.alpha_composite(layer)
            check = report.get(item["id"], {}).get("verify") if args.rekey else None
            check = check or verify(photo, plate.convert("RGB"), key, ledger)
            report[item["id"]] = {
                "status": "prepared",
                "seconds": round(time.perf_counter() - t_start, 1),
                "targets": spec.targets(),
                "final": after,
                "framing": framing,
                "verify": check,
                "prompt": prompt,
            }
            print(f"{item['id']}: prepared in {report[item['id']]['seconds']}s  targets={spec.targets()}  got={after}", flush=True)
            print(f"  verify: {json.dumps(check)[:400]}", flush=True)
            (args.out / "report.json").write_text(json.dumps(report, indent=1, default=float))
    except BudgetExceeded as err:
        print(err, file=sys.stderr)
    (args.out / "report.json").write_text(json.dumps(report, indent=1, default=float))
    print(f"spent ${ledger.data['spent_usd']:.2f} of ${args.budget:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
