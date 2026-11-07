"""AI one-time garment preparation for the reusable-asset dress-up.

Every garment is dressed ONCE onto the same canonical mannequin by an image model, then keyed into a
transparent layer that lines up with every other layer. Outfit switching stays pure layer stacking
(see wardrobe_poc.py); the model is never called on a swap.

  1. canonical mannequin: an armless dress form on chroma green, generated once.
  2. display plate: the same mannequin recoloured matte black in a dark studio, generated once.
  3. per garment: [canonical mannequin + garment photo] -> mannequin wearing only that garment ->
     green keyed out -> aligned to the canonical neck -> transparent layer.

Spending is capped: before each call the ledger checks spent + worst case for that call against
--budget and stops instead of going over.

Usage:
  python ai_prep.py --manifest m.json --photos <dir> --out <dir> [--budget 5] [--model gemini-3-pro-image]
  python ai_prep.py ... --compose top-id,bottom-id [...]
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

CANVAS = (1080, 1920)  # 9:16, every layer and the plate share this frame

# USD per 1M tokens (input, output) and a worst-case cost per call used by the budget check.
PRICES = {
    "gemini-2.5-flash-image": (0.30, 30.0, 0.06),
    "gemini-3.1-flash-image": (0.50, 60.0, 0.12),
    "gemini-3-pro-image": (2.00, 120.0, 0.30),
    # Vision text calls for classification and verification: a fraction of a cent each.
    "gemini-3.5-flash": (0.50, 3.0, 0.02),
}

CANONICAL_PROMPT = (
    "Photorealistic studio product photo of a full-body male display mannequin used in clothing "
    "stores: headless, armless dress form (arms removed at the shoulders), short cylindrical neck "
    "stand with a flat round cap, realistic adult male torso, waist, hips, two legs and feet, standing "
    "perfectly straight facing the camera, feet shoulder-width apart, toes forward. The mannequin is "
    "matte, uniform chroma-key green (#00B140) with soft natural shading. Background: flat, evenly lit, "
    "slightly lighter chroma-key green, no floor line, no props, no text. Whole mannequin visible from "
    "the top of the neck cap to the feet, centred, filling about 85% of the image height."
)

PLATE_PROMPT = (
    "Keep this exact mannequin: identical pose, proportions, position, size and framing, pixel-aligned. "
    "Only change materials and background: make the mannequin a premium matte black finish with subtle "
    "satin highlights, and replace the green background with a dark warm charcoal-brown photo studio, "
    "a soft warm spotlight glow behind the mannequin, and a subtle floor shadow under the feet. "
    "Photorealistic fashion product photography."
)

FIT_WORDS = {
    "Slim": "slim fit, close to the body",
    "Fitted": "fitted, tailored",
    "Regular": "regular, true-to-size fit",
    "Relaxed": "relaxed fit with a little extra room",
    "Oversized": "oversized: dropped shoulders, wide boxy body, extra length, heavy drape",
}

DRESS = {
    "top": (
        "Dress the mannequin from image 1 in ONLY the top from image 2. It hangs naturally from the "
        "shoulders with realistic folds, sleeves falling at the sides, hem loose over the hips (not "
        "tucked). The legs stay bare green mannequin."
    ),
    "bottom": (
        "Dress the mannequin from image 1 in ONLY the trousers from image 2, worn at the natural waist, "
        "front view, legs falling straight with natural creases and a slight break over the feet. The "
        "torso stays bare green mannequin."
    ),
}


class BudgetExceeded(RuntimeError):
    pass


class Ledger:
    def __init__(self, path: Path, cap: float):
        self.path, self.cap = path, cap
        self.data = json.loads(path.read_text()) if path.exists() else {"spent_usd": 0.0, "calls": []}

    def check(self, model: str) -> None:
        worst = PRICES[model][2]
        if self.data["spent_usd"] + worst > self.cap:
            raise BudgetExceeded(f"stopping: ${self.data['spent_usd']:.2f} spent, next call could exceed ${self.cap:.2f}")

    def record(self, what: str, model: str, usage: dict, seconds: float) -> float:
        rin, rout, _ = PRICES[model]
        tin, tout = usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)
        usd = tin / 1e6 * rin + tout / 1e6 * rout
        self.data["spent_usd"] = round(self.data["spent_usd"] + usd, 4)
        self.data["calls"].append(
            {"what": what, "model": model, "in_tokens": tin, "out_tokens": tout, "usd": round(usd, 4), "seconds": round(seconds, 1)}
        )
        self.path.write_text(json.dumps(self.data, indent=2))
        print(f"  {what}: ${usd:.3f} in {seconds:.1f}s (total ${self.data['spent_usd']:.2f} of ${self.cap:.2f})", flush=True)
        return usd


def jpeg_part(img: Image.Image, max_side: int = 1536) -> dict:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}


def generate(what: str, parts: list[dict], model: str, ledger: Ledger, key: str) -> Image.Image:
    ledger.check(model)
    config: dict = {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}}
    if "pro" in model:
        config["imageConfig"]["imageSize"] = "2K"
    body = {"contents": [{"parts": parts}], "generationConfig": config}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=240) as res:
            data = json.load(res)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"Gemini error {err.code}: {err.read().decode()[:300]}") from err
    ledger.record(what, model, data.get("usageMetadata", {}), time.perf_counter() - t0)
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inline_data") or part.get("inlineData")
            if blob:
                return Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB").resize(CANVAS, Image.LANCZOS)
    raise RuntimeError(f"no image returned for {what}: {json.dumps(data)[:300]}")


def cached(path: Path, make) -> Image.Image:
    if path.exists():
        return Image.open(path).convert("RGB")
    im = make()
    im.save(path)
    return im


# --------------------------------------------------------------------------- keying + alignment


def green_alpha(rgb: np.ndarray) -> np.ndarray:
    """0 where the pixel is chroma green (mannequin or background), 1 for garment."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    greenness = g - np.maximum(r, b)
    return 1 - np.clip((greenness - 18) / 40, 0, 1)


def key_layer(dressed: Image.Image) -> Image.Image:
    rgb = np.array(dressed).astype(np.float32)
    alpha = green_alpha(rgb)
    # Despill: the garment was lit by a green room, so green may not exceed the other two channels.
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    a = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).convert("RGBA")
    out.putalpha(a)
    return out


def color_lock(layer: Image.Image, photo: Image.Image, session) -> Image.Image:
    """Match the layer's colour balance (not its brightness) to the garment in the original photo."""
    from rembg import remove

    from wardrobe_poc import garment_mask

    # A fixed working size: phone uploads arrive already downscaled, and a fraction of a small photo
    # can leave too few pixels for the garment mask.
    small = photo.convert("RGB").copy()
    small.thumbnail((900, 900))
    cut = np.array(remove(small, session=session)).astype(np.float32)
    lay = np.array(layer).astype(np.float32)
    # Only the garment itself (hangers, neighbouring clothes and floor removed), never the whole photo.
    garment = cut[garment_mask(cut[..., 3])][:, :3]
    solid = lay[lay[..., 3] > 200][:, :3]
    if len(garment) < 200 or len(solid) < 200:
        return layer  # nothing reliable to match against: leave the colours as rendered
    want, have = garment.mean(axis=0), solid.mean(axis=0)
    if not (np.isfinite(want).all() and np.isfinite(have).all()) or want.mean() < 1 or have.min() < 1:
        return layer
    # Half-strength gain on chromaticity only: phone photos carry their room's white balance too, so
    # this removes the green-screen cast without copying a warm closet light onto the garment.
    gain = np.clip(np.sqrt((want / want.mean()) / (have / have.mean())), 0.85, 1.15)
    lay[..., :3] = np.clip(lay[..., :3] * gain, 0, 255)
    return Image.fromarray(lay.astype(np.uint8), "RGBA")


def neck_anchor(rgb: Image.Image) -> tuple[float, float, float]:
    """Top-centre of the mannequin's neck cap and its width, found against the lighter background."""
    a = np.array(rgb).astype(np.float32)
    lum = a.mean(axis=2)
    bg = np.median(lum[:40, :])
    w = a.shape[1]
    band = slice(int(w * 0.3), int(w * 0.7))
    dark = (lum[:, band] < bg - 25) & (a[..., 1][:, band] - np.maximum(a[..., 0], a[..., 2])[:, band] > 15)
    rows = np.nonzero(dark.sum(axis=1) > 8)[0]
    top = int(rows[0]) if len(rows) else 0
    xs = np.nonzero(dark[min(top + 25, a.shape[0] - 1)])[0] + band.start
    width = float(xs[-1] - xs[0]) if len(xs) > 2 else 1.0
    cx = float(xs.mean()) if len(xs) else w / 2
    return cx, float(top), width


def align(layer: Image.Image, src: Image.Image, ref: tuple[float, float, float]) -> Image.Image:
    cx, top, width = neck_anchor(src)
    rcx, rtop, rwidth = ref
    s = rwidth / width if 0.8 < rwidth / width < 1.25 else 1.0
    scaled = layer.resize((round(layer.width * s), round(layer.height * s)), Image.LANCZOS)
    frame = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    frame.alpha_composite(scaled, (round(rcx - cx * s), round(rtop - top * s)))
    return frame


# --------------------------------------------------------------------------- main


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--manifest", required=True, type=Path)
    p.add_argument("--photos", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--budget", type=float, default=5.0)
    p.add_argument("--model", default="gemini-3-pro-image", choices=sorted(PRICES))
    p.add_argument("--only", nargs="*", help="item ids to prepare (default: all)")
    p.add_argument("--compose", nargs="*", help="outfits to render as top-id,bottom-id")
    p.add_argument("--rekey", action="store_true", help="rebuild layers from saved renders, no API calls")
    args = p.parse_args()

    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("GEMINI_API_KEY is not set", file=sys.stderr)
        return 2
    for sub in ("raw", "layers", "outfits"):
        (args.out / sub).mkdir(parents=True, exist_ok=True)
    ledger = Ledger(args.out / "ledger.json", args.budget)
    from rembg import new_session

    session = new_session("isnet-general-use")

    try:
        canon = cached(args.out / "canonical.png", lambda: generate("canonical mannequin", [{"text": CANONICAL_PROMPT}], args.model, ledger, key))
        plate = cached(args.out / "plate.png", lambda: generate("display plate", [{"text": PLATE_PROMPT}, jpeg_part(canon)], args.model, ledger, key))
        ref = neck_anchor(canon)

        manifest = json.loads(args.manifest.read_text())
        for item in manifest["items"]:
            if args.only and item["id"] not in args.only:
                continue
            layer_path = args.out / "layers" / f"{item['id']}.png"
            raw_path = args.out / "raw" / f"{item['id']}.png"
            photo = ImageOps.exif_transpose(Image.open(args.photos / item["photo"])).convert("RGB")
            if args.rekey and raw_path.exists():
                dressed = Image.open(raw_path).convert("RGB")
                color_lock(align(key_layer(dressed), dressed, ref), photo, session).save(layer_path)
                print(f"{item['id']}: re-keyed", flush=True)
                continue
            if layer_path.exists():
                continue
            prompt = (
                f"{DRESS[item['category']]} Fit: {FIT_WORDS[item.get('fit') or 'Regular']}. Copy the garment "
                "exactly from image 2: colour, wash, fabric texture, every print, graphic, logo and word of "
                "text (same spelling, size and position), stitching, pockets and hardware. Do not invent, "
                "remove, mirror or restyle anything; ignore hangers, tags, hands, floors and backgrounds in "
                "image 2. Keep the mannequin's pose, size, position, framing and the green background exactly "
                "as in image 1. Photorealistic."
            )
            t0 = time.perf_counter()
            dressed = generate(item["id"], [{"text": prompt}, jpeg_part(canon), jpeg_part(photo)], args.model, ledger, key)
            dressed.save(raw_path)
            color_lock(align(key_layer(dressed), dressed, ref), photo, session).save(layer_path)
            print(f"{item['id']}: prepared in {time.perf_counter() - t0:.1f}s", flush=True)
    except BudgetExceeded as err:
        print(err, file=sys.stderr)

    if args.compose:
        plate_rgba = plate.convert("RGBA")
        order = {"bottom": 0, "top": 1}
        cats = {i["id"]: i["category"] for i in json.loads(args.manifest.read_text())["items"]}
        for spec in args.compose:
            ids = sorted(spec.split(","), key=lambda i: order[cats[i]])
            t0 = time.perf_counter()
            frame = plate_rgba.copy()
            for i in ids:
                frame.alpha_composite(Image.open(args.out / "layers" / f"{i}.png"))
            ms = (time.perf_counter() - t0) * 1000
            frame.convert("RGB").save(args.out / "outfits" / f"{'+'.join(ids)}.jpg", quality=90)
            print(f"{spec}: composed in {ms:.0f} ms")
    print(f"spent ${ledger.data['spent_usd']:.2f} of ${args.budget:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
