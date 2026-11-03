"""Closr reusable-asset dress-up proof of concept.

Each clothing photo is prepared ONCE into a mannequin-ready layer: background removed, hanger and
clutter stripped, straightened, scaled onto a standard mannequin by its category and fit, and lightly
shaded so it reads as worn rather than pasted. Outfit switching then only stacks prepared layers over
a fixed mannequin plate: no AI call, no re-processing.

The actual garment pixels are kept (only resampled and shaded), so colours, washes, prints, logos and
text are the real ones. Scaling is uniform: the fit picks the size, and the item's own proportions
(boxy, long, wide-leg) are never stretched to match a template.

Usage:
  python wardrobe_poc.py prepare --manifest m.json --photos <dir> --out <dir>
  python wardrobe_poc.py compose --assets <dir> --out <dir> --outfit top-id,bottom-id [...]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from scipy import ndimage

W, H = 1000, 2000
CX = W // 2
SHOULDER_Y = 330  # top of the shoulder line on the mannequin
WAIST_Y = 860  # where trousers sit
FLOOR_Y = 1930

# Chest width (px) each fit is drawn at on the mannequin. The garment is scaled uniformly to this,
# so its length and sleeve shape follow from its own proportions.
TOP_CHEST = {"Slim": 360, "Fitted": 380, "Regular": 410, "Relaxed": 440, "Oversized": 480}
# Waist width (px) for bottoms; the legs follow the garment's real shape below it.
BOTTOM_WAIST = {"Slim": 300, "Fitted": 305, "Regular": 315, "Relaxed": 325, "Oversized": 335}


# --------------------------------------------------------------------------- preparation


def load(path: Path, max_side: int = 1600) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    return im


def garment_mask(alpha: np.ndarray) -> np.ndarray:
    """Binary mask of the one garment: drops hanger hooks, other hangers and background scraps."""
    m = alpha > 128
    r = max(3, int(min(m.shape) * 0.012))
    # Opening removes thin things (hanger hooks, wires, straps of neighbouring clothes).
    m = ndimage.binary_opening(m, structure=np.ones((r, r)), iterations=2)
    labels, n = ndimage.label(m)
    if n == 0:
        return m
    # Keep the component nearest the photo centre, weighted by size.
    cy, cx = np.array(m.shape) / 2
    best, best_score = 0, -1.0
    for i, (sl, area) in enumerate(zip(ndimage.find_objects(labels), ndimage.sum(m, labels, range(1, n + 1))), 1):
        ys, xs = sl
        dist = np.hypot((ys.start + ys.stop) / 2 - cy, (xs.start + xs.stop) / 2 - cx) / max(m.shape)
        score = area * (1 - min(dist, 0.9))
        if score > best_score:
            best, best_score = i, score
    m = labels == best
    return m


def row_profile(m: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    has = m.any(axis=1)
    left = np.where(has, m.argmax(axis=1), 0)
    right = np.where(has, m.shape[1] - 1 - m[:, ::-1].argmax(axis=1), 0)
    return has, left, right


def straighten(rgba: Image.Image, m: np.ndarray) -> tuple[Image.Image, np.ndarray]:
    """Rotate so the garment's centre line is vertical (hanger tilt, phone tilt)."""
    has, left, right = row_profile(m)
    ys = np.nonzero(has)[0]
    if len(ys) < 20:
        return rgba, m
    lo, hi = ys[0] + (ys[-1] - ys[0]) * 0.2, ys[0] + (ys[-1] - ys[0]) * 0.8
    sel = ys[(ys > lo) & (ys < hi)]
    mid = (left[sel] + right[sel]) / 2
    slope = np.polyfit(sel, mid, 1)[0]
    angle = float(np.degrees(np.arctan(slope)))
    if abs(angle) < 0.7 or abs(angle) > 15:
        return rgba, m
    rot = rgba.rotate(-angle, resample=Image.BICUBIC, expand=True)
    return rot, np.array(rot.getchannel("A")) > 128


def measure(m: np.ndarray, category: str) -> dict:
    has, left, right = row_profile(m)
    ys = np.nonzero(has)[0]
    top, bottom = int(ys[0]), int(ys[-1])
    width = (right - left + 1) * has
    span = bottom - top
    if category == "bottom":
        # Waist: median width over the top 4% (the waistband).
        band = width[top : top + max(3, int(span * 0.04))]
        ref = float(np.median(band))
    else:
        # Chest: median width between 45% and 75% down, below the sleeves.
        band = width[top + int(span * 0.45) : top + int(span * 0.75)]
        ref = float(np.median(band))
    return {"top": top, "bottom": bottom, "ref_width": ref, "max_width": int(width.max())}


def drape_shading(rgba: Image.Image, category: str) -> Image.Image:
    """Cylindrical falloff toward the sides and a soft top light, so flat photos read as rounded."""
    w, h = rgba.size
    alpha = np.array(rgba.getchannel("A")).astype(np.float32) / 255
    # Distance from the garment's own edge, so each leg/sleeve gets its own roundness.
    dist = ndimage.distance_transform_edt(alpha > 0.5)
    depth = np.clip(dist / (0.09 * w if category != "bottom" else 0.06 * w), 0, 1)
    shade = 0.72 + 0.28 * np.sqrt(depth)
    ys = np.linspace(0, 1, h)[:, None]
    shade *= 1.04 - 0.08 * ys  # light from above
    rgb = np.array(rgba.convert("RGB")).astype(np.float32) * shade[..., None]
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("RGBA")
    out.putalpha(rgba.getchannel("A"))
    return out


def prepare_item(item: dict, photo: Path, session) -> tuple[Image.Image, dict]:
    from rembg import remove

    t0 = time.perf_counter()
    src = load(photo)
    rgba = remove(src, session=session)
    t_seg = time.perf_counter()

    m = garment_mask(np.array(rgba.getchannel("A")))
    alpha = np.array(rgba.getchannel("A")) * m
    rgba.putalpha(Image.fromarray(alpha.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
    rgba, m = straighten(rgba, m)
    bbox = Image.fromarray((m * 255).astype(np.uint8)).getbbox()
    rgba, m = rgba.crop(bbox), m[bbox[1] : bbox[3], bbox[0] : bbox[2]]

    cat, fit = item["category"], item.get("fit") or "Regular"
    meas = measure(m, cat)
    target = (BOTTOM_WAIST if cat == "bottom" else TOP_CHEST)[fit]
    scale = target / meas["ref_width"]
    w, h = round(rgba.width * scale), round(rgba.height * scale)
    layer = rgba.resize((w, h), Image.LANCZOS)

    if cat == "bottom":
        # Trousers longer than the mannequin's leg pool at the floor: compress the bottom of the leg
        # rather than shrinking the whole garment (keeps waist and leg width true).
        room = FLOOR_Y - WAIST_Y
        if h > room:
            keep = int(room * 0.82)
            upper = layer.crop((0, 0, w, keep))
            lower = layer.crop((0, keep, w, h)).resize((w, room - keep), Image.LANCZOS)
            layer = Image.new("RGBA", (w, room))
            layer.alpha_composite(upper, (0, 0))
            layer.alpha_composite(lower, (0, keep))
        x, y = CX - layer.width // 2, WAIST_Y
    else:
        x, y = CX - layer.width // 2, SHOULDER_Y - round(0.03 * layer.height)

    layer = drape_shading(layer, cat)
    t_end = time.perf_counter()

    meta = {
        **item,
        "x": x,
        "y": y,
        "w": layer.width,
        "h": layer.height,
        "scale": round(scale, 3),
        "aspect_kept": True,
        "mean_rgb_photo": [round(v) for v in mean_rgb(rgba)],
        "mean_rgb_asset": [round(v) for v in mean_rgb(layer)],
        "prep_ms": {"segment": round((t_seg - t0) * 1000), "total": round((t_end - t0) * 1000)},
    }
    return layer, meta


def mean_rgb(rgba: Image.Image) -> np.ndarray:
    a = np.array(rgba)
    sel = a[..., 3] > 200
    return a[sel][:, :3].mean(axis=0) if sel.any() else np.zeros(3)


# --------------------------------------------------------------------------- mannequin + compose


def mannequin_plate() -> tuple[Image.Image, Image.Image]:
    """Backdrop + dark dress form (behind clothes), and the neck stand (in front of the collar)."""
    bg = np.zeros((H, W, 3), np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    spot = np.exp(-(((xx - CX) / 520) ** 2 + ((yy - 900) / 900) ** 2))
    base = np.array([22, 18, 15], np.float32)
    warm = np.array([82, 66, 54], np.float32)
    bg = base + (warm - base) * spot[..., None]
    floor = np.exp(-(((xx - CX) / 330) ** 2 + ((yy - FLOOR_Y) / 40) ** 2))
    bg *= (1 - 0.55 * floor)[..., None]
    plate = Image.fromarray(bg.clip(0, 255).astype(np.uint8)).convert("RGBA")

    # Torso: shoulders and chest of a matte black form, visible through armholes and necklines.
    form = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(form)
    d.rounded_rectangle((CX - 190, SHOULDER_Y + 10, CX + 190, WAIST_Y + 40), radius=110, fill=255)
    d.ellipse((CX - 200, SHOULDER_Y, CX + 200, SHOULDER_Y + 140), fill=255)
    plate.alpha_composite(shaded_black(form, CX, 190))

    neck = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(neck)
    d.rectangle((CX - 46, 250, CX + 46, SHOULDER_Y + 22), fill=255)
    d.ellipse((CX - 46, SHOULDER_Y + 2, CX + 46, SHOULDER_Y + 42), fill=255)
    neck_layer = shaded_black(neck, CX, 46)
    cap = Image.new("L", (W, H), 0)
    ImageDraw.Draw(cap).ellipse((CX - 50, 236, CX + 50, 266), fill=255)
    neck_layer.alpha_composite(shaded_black(cap, CX, 50, lift=22))
    return plate, neck_layer


def shaded_black(mask: Image.Image, cx: int, half: int, lift: int = 0) -> Image.Image:
    xx = np.arange(W)[None, :].repeat(H, 0)
    t = np.clip(1 - np.abs(xx - cx + half * 0.25) / (half * 1.15), 0, 1)
    v = 14 + lift + 46 * t**1.6
    rgb = np.stack([v, v * 0.95, v * 0.9], -1).astype(np.uint8)
    out = Image.fromarray(rgb).convert("RGBA")
    out.putalpha(mask.filter(ImageFilter.GaussianBlur(1.2)))
    return out


def soft_shadow(layer: Image.Image, blur: int = 16, strength: float = 0.5) -> Image.Image:
    s = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    s.putalpha(layer.getchannel("A").point(lambda a: int(a * strength)).filter(ImageFilter.GaussianBlur(blur)))
    return s


class Renderer:
    """What the app would do on a swap: stack already-prepared layers. Nothing is re-processed."""

    ORDER = ["shoes", "bottom", "onepiece", "top", "outerwear", "accessory"]

    def __init__(self, assets: Path):
        self.plate, self.neck = mannequin_plate()
        self.assets = assets
        self.layers: dict[str, tuple[Image.Image, Image.Image, dict]] = {}
        for meta_path in sorted(assets.glob("*.json")):
            meta = json.loads(meta_path.read_text())
            im = Image.open(assets / f"{meta['id']}.png").convert("RGBA")
            self.layers[meta["id"]] = (im, soft_shadow(im), meta)

    def render(self, ids: list[str]) -> Image.Image:
        frame = self.plate.copy()
        chosen = sorted((self.layers[i] for i in ids), key=lambda l: self.ORDER.index(l[2]["category"]))
        for im, shadow, meta in chosen:
            if meta["category"] == "bottom":
                floor = Image.new("RGBA", (meta["w"] + 80, 60), (0, 0, 0, 0))
                ImageDraw.Draw(floor).ellipse((0, 0, meta["w"] + 80, 60), fill=(0, 0, 0, 120))
                frame.alpha_composite(floor.filter(ImageFilter.GaussianBlur(14)), (meta["x"] - 40, FLOOR_Y - 30))
            frame.alpha_composite(shadow, (meta["x"], meta["y"] + 12))
            frame.alpha_composite(im, (meta["x"], meta["y"]))
        frame.alpha_composite(self.neck)
        return frame


# --------------------------------------------------------------------------- cli


def cmd_prepare(args) -> int:
    from rembg import new_session

    manifest = json.loads(args.manifest.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    session = new_session("isnet-general-use")
    for item in manifest["items"]:
        layer, meta = prepare_item(item, args.photos / item["photo"], session)
        layer.save(args.out / f"{item['id']}.png", optimize=True)
        meta["bytes"] = (args.out / f"{item['id']}.png").stat().st_size
        (args.out / f"{item['id']}.json").write_text(json.dumps(meta, indent=2))
        print(f"{item['id']:>24}: {meta['prep_ms']['total']} ms, {meta['bytes'] // 1024} KB", flush=True)
    return 0


def cmd_compose(args) -> int:
    r = Renderer(args.assets)
    args.out.mkdir(parents=True, exist_ok=True)
    for spec in args.outfit:
        ids = spec.split(",")
        t0 = time.perf_counter()
        frame = r.render(ids)
        ms = (time.perf_counter() - t0) * 1000
        frame.convert("RGB").save(args.out / f"{'+'.join(ids)}.jpg", quality=90)
        print(f"{spec}: {ms:.0f} ms")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("prepare")
    a.add_argument("--manifest", required=True, type=Path)
    a.add_argument("--photos", required=True, type=Path)
    a.add_argument("--out", required=True, type=Path)
    b = sub.add_parser("compose")
    b.add_argument("--assets", required=True, type=Path)
    b.add_argument("--out", required=True, type=Path)
    b.add_argument("--outfit", nargs="+", required=True)
    args = p.parse_args()
    return cmd_prepare(args) if args.cmd == "prepare" else cmd_compose(args)


if __name__ == "__main__":
    sys.exit(main())
