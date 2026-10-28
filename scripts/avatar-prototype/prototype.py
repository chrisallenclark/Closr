"""Closr avatar dress-up prototype.

Turns clothing photos into avatar-ready garment pieces and layers them on a mannequin, so we can
judge the "video game dress-up" idea before building it into the app.

Pipeline per item:
  photo -> [optional AI normalisation: front-facing ghost-mannequin render of the same garment,
            shaped by the item's fit] -> background removal -> trim -> scale/anchor to the avatar
            by category + fit.

Usage:
  python prototype.py --manifest sample-manifest.json --photos <dir> --out <dir>
  GEMINI_API_KEY=... python prototype.py ... --provider gemini

AI results are cached in <out>/ai so re-runs don't pay twice.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from rembg import new_session, remove

HERE = Path(__file__).resolve().parent
CANVAS_W, CANVAS_H = 1000, 2000

# How much wider a garment sits on the avatar for each fit (Regular = 1).
FIT_SCALE = {"Slim": 0.9, "Fitted": 0.95, "Regular": 1.0, "Relaxed": 1.08, "Oversized": 1.2}
SHORT_BOTTOMS = {"shorts", "cutoff-shorts", "jorts", "swim-trunks", "bikini-bottom"}
SKIRTS = {"skirt"}

# Draw order: later entries sit on top.
LAYER_ORDER = ["bottom", "onepiece", "shoes", "top", "outerwear", "accessory"]

FIT_PROMPTS = {
    "Slim": "a slim fit: close to the body, narrow through the chest and legs",
    "Fitted": "a fitted, tailored silhouette with clean lines",
    "Regular": "a regular, true-to-size fit",
    "Relaxed": "a relaxed fit with a little extra room and soft drape",
    "Oversized": "an oversized, baggy fit: dropped shoulders, wide boxy body, longer length, roomy, heavy drape",
}

CATEGORY_PROMPTS = {
    "top": "Show it front-on as if worn by an invisible upper body, sleeves hanging naturally at the sides.",
    "outerwear": "Show it front-on and open/closed as photographed, as if worn by an invisible upper body.",
    "onepiece": "Show it front-on, full length, as if worn by an invisible body.",
    "bottom": "Show it front-on, full length, as if worn by an invisible lower body, legs straight down.",
    "shoes": "Show the pair side by side, front three-quarter view, as if standing.",
    "accessory": "Show it front-on, centred.",
}


# --------------------------------------------------------------------------- AI normalisation


def ai_prompt(item: dict) -> str:
    fit = FIT_PROMPTS.get(item.get("fit") or "Regular", FIT_PROMPTS["Regular"])
    return (
        "Recreate the exact garment from this photo as a clean e-commerce 'ghost mannequin' product "
        f"image. {CATEGORY_PROMPTS[item['category']]} Render it with {fit}. "
        "Preserve every detail exactly: colours, fabric texture, wash, prints, graphics, logos, text, "
        "stitching, buttons and pockets. Garment only: no hanger, no tags, no person, no visible "
        "mannequin, no props, no shadow. Solid pure white background (#FFFFFF). Centred, "
        "symmetrical, evenly lit, square image."
    )


def gemini_normalise(img: Image.Image, item: dict, key: str, model: str) -> Image.Image:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=92)
    body = {
        "contents": [
            {
                "parts": [
                    {"text": ai_prompt(item)},
                    {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}},
                ]
            }
        ],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            data = json.load(res)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"Gemini error {err.code}: {err.read().decode()[:400]}") from err
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inline_data") or part.get("inlineData")
            if blob:
                return Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB")
    raise RuntimeError(f"Gemini returned no image: {json.dumps(data)[:400]}")


# --------------------------------------------------------------------------- cutout + placement


def cutout(img: Image.Image, session) -> Image.Image:
    rgba = remove(img.convert("RGB"), session=session)
    alpha = rgba.getchannel("A").point(lambda a: 0 if a < 24 else a)
    rgba.putalpha(alpha)
    bbox = alpha.point(lambda a: 255 if a > 40 else 0).getbbox()
    return rgba.crop(bbox) if bbox else rgba


def resize(im: Image.Image, w: float, h: float) -> Image.Image:
    return im.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)


def place(item: dict, cut: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Scale a cutout to its slot on the avatar and return it with its top-left position."""
    fs = FIT_SCALE.get(item.get("fit") or "Regular", 1.0)
    cat, sub = item["category"], item["subcategory"]
    aspect = cut.height / cut.width

    if cat in ("top", "outerwear", "onepiece"):
        width = {"top": 600, "outerwear": 650, "onepiece": 560}[cat] * fs
        height = min(width * aspect, 1550 if cat == "onepiece" else 900)
        width = height / aspect
        im = resize(cut, width, height)
        top = {"top": 285, "outerwear": 272, "onepiece": 290}[cat]
        return im, (round(CANVAS_W / 2 - im.width / 2), top)

    if cat == "bottom":
        height = 430 if sub in SHORT_BOTTOMS else 540 if sub in SKIRTS else 1090
        # Flat-lay photos splay the legs; narrow them to the form's hips but keep the length.
        width = min(height / aspect, 380)
        # Fit widens or narrows the legs without changing the length.
        im = resize(cut, width * fs, height)
        return im, (round(CANVAS_W / 2 - im.width / 2), 815)

    if cat == "shoes":
        im = resize(cut, 290, 290 * aspect)
        return im, (round(CANVAS_W / 2 - im.width / 2), 1975 - im.height)

    im = resize(cut, 190, 190 * aspect)  # accessory: floats beside the form for now
    return im, (770, 420)


def with_shadow(layer: Image.Image) -> Image.Image:
    alpha = layer.getchannel("A")
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shadow.putalpha(alpha.point(lambda a: a * 0.45).filter(ImageFilter.GaussianBlur(14)))
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.alpha_composite(shadow, (0, 10))
    out.alpha_composite(layer)
    return out


def backdrop() -> Image.Image:
    bg = Image.new("RGBA", (CANVAS_W, CANVAS_H), (24, 19, 16, 255))
    glow = Image.new("L", (CANVAS_W, CANVAS_H), 0)
    ImageDraw.Draw(glow).ellipse((-150, 100, 1150, 1700), fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    warm = Image.new("RGBA", (CANVAS_W, CANVAS_H), (74, 60, 50, 255))
    bg.paste(warm, (0, 0), glow)
    return bg


def compose(avatar: Image.Image, placed: dict[str, tuple[Image.Image, tuple[int, int]]]) -> Image.Image:
    frame = backdrop()
    frame.alpha_composite(avatar)
    for cat in LAYER_ORDER:
        if cat in placed:
            im, (x, y) = placed[cat]
            frame.alpha_composite(with_shadow(im), (x, y))
    return frame


# --------------------------------------------------------------------------- reporting


def on_cream(im: Image.Image, size: int) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (236, 226, 208, 255))
    fit = im.copy()
    fit.thumbnail((size - 24, size - 24))
    tile.alpha_composite(fit.convert("RGBA"), ((size - fit.width) // 2, (size - fit.height) // 2))
    return tile


def label(img: Image.Image, text: str) -> None:
    ImageDraw.Draw(img).text((10, img.height - 24), text, fill=(240, 232, 220, 255), font=ImageFont.load_default())


def items_sheet(rows: list[tuple[dict, Image.Image, Image.Image | None, Image.Image]], out: Path) -> None:
    size = 220
    cols = 3 if any(r[2] is not None for r in rows) else 2
    sheet = Image.new("RGBA", (cols * size, len(rows) * (size + 28)), (20, 16, 13, 255))
    for i, (item, photo, ai_img, cut) in enumerate(rows):
        cells = [photo.convert("RGBA")] + ([ai_img.convert("RGBA")] if cols == 3 and ai_img else []) + [cut]
        for j, im in enumerate(cells):
            sheet.alpha_composite(on_cream(im, size), (j * size, i * (size + 28)))
        ImageDraw.Draw(sheet).text(
            (6, i * (size + 28) + size + 6),
            f"{item['id']} · {item['subcategory']} · {item.get('fit') or '-'}",
            fill=(220, 210, 196, 255),
            font=ImageFont.load_default(),
        )
    sheet.convert("RGB").save(out, quality=90)


# --------------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--photos", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--provider", choices=["none", "gemini"], default="none")
    parser.add_argument("--model", default=os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"))
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    key = os.environ.get("GEMINI_API_KEY", "")
    if args.provider == "gemini" and not key:
        print("GEMINI_API_KEY is not set", file=sys.stderr)
        return 2

    for sub in ("cutouts", "outfits", "ai"):
        (args.out / sub).mkdir(parents=True, exist_ok=True)

    session = new_session("isnet-general-use")
    avatar = Image.open(io.BytesIO(cairosvg.svg2png(url=str(HERE / "avatar.svg"), output_width=CANVAS_W))).convert("RGBA")

    cuts: dict[str, Image.Image] = {}
    rows = []
    for item in manifest["items"]:
        photo = Image.open(args.photos / item["photo"]).convert("RGB")
        ai_img = None
        if args.provider == "gemini":
            cached = args.out / "ai" / f"{item['id']}.png"
            if cached.exists():
                ai_img = Image.open(cached).convert("RGB")
            else:
                print(f"AI: {item['id']}…", flush=True)
                ai_img = gemini_normalise(photo, item, key, args.model)
                ai_img.save(cached)
        cut = cutout(ai_img or photo, session)
        cut.save(args.out / "cutouts" / f"{item['id']}.png")
        cuts[item["id"]] = cut
        rows.append((item, photo, ai_img, cut))
        print(f"cut: {item['id']}", flush=True)

    items_sheet(rows, args.out / "items-sheet.jpg")

    by_id = {i["id"]: i for i in manifest["items"]}
    renders = []
    for outfit in manifest["outfits"]:
        placed = {}
        for item_id in outfit["items"]:
            item = by_id[item_id]
            placed[item["category"]] = place(item, cuts[item_id])
        frame = compose(avatar, placed)
        label(frame, outfit["name"])
        frame.convert("RGB").save(args.out / "outfits" / f"{outfit['id']}.jpg", quality=90)
        renders.append(frame)

    if renders:
        thumb_w = 400
        strip = Image.new("RGB", (thumb_w * len(renders), thumb_w * 2), (20, 16, 13))
        for i, r in enumerate(renders):
            strip.paste(r.convert("RGB").resize((thumb_w, thumb_w * 2), Image.LANCZOS), (i * thumb_w, 0))
        strip.save(args.out / "outfits-strip.jpg", quality=90)
    print(f"done → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
