"""Structured garment fit for the reusable-asset dress-up.

A fit spec is built per garment from two independent sources, then merged:

  measured   scale-free proportions taken from the garment photo's silhouette (image processing,
             free): width-to-length, leg width at thigh / knee / hem relative to the waist, rise.
  observed   attributes a vision model reads from the photo (cheap text call): fit words, boxy vs
             tapered, length class, construction, pockets, the exact visible text and which side of
             the garment each logo is on, and whether anything is hidden or unreadable.

Attributes are independent flags, not one category ("oversized" AND "boxy", "wide-leg" AND
"stacked"). Every value carries a confidence; anything that can't be read reliably is stored as
"uncertain" instead of a guessed number. The spec drives the preparation prompt and a silhouette
guide drawn on the standard mannequin, and is checked against the prepared layer afterwards.

Worn photos (optional, not used in this prototype run) would add a third source: body-pose
landmarks + garment segmentation on the person, reduced to the same scale-free ratios. Only those
numbers enter the spec; the person's pixels never reach the renderer.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# Landmarks of the canonical mannequin in its 1080×1920 frame (measured once from canonical.png).
M = {
    "cx": 545,
    "shoulder_y": 300,
    "shoulder_w": 370,
    "waist_y": 760,
    "waist_w": 262,
    "hip_y": 880,
    "hip_w": 290,
    "crotch_y": 960,
    "knee_y": 1300,
    "ankle_y": 1700,
    "floor_y": 1800,
    "thigh_leg_w": 155,
    "knee_leg_w": 100,
    "ankle_leg_w": 60,
    "leg_gap": 30,
}


def use_landmarks(path) -> None:
    """Switch templates to another canonical mannequin (e.g. the v3 pose) from its landmarks.json."""
    lm = json.loads(Path(path).read_text())
    legs = lm["legs"]
    M.update({k: lm[k] for k in ("cx", "shoulder_y", "crotch_y", "knee_y", "ankle_y", "floor_y")})
    # The pants waistband sits about a third of the way from the torso seam to the crotch; tops are
    # sized from the chest without the arm caps.
    M["waist_y"] = lm.get("pants_waist_y", lm["crotch_y"] - 230)
    M["waist_w"] = lm.get("pants_waist_w", round(lm["hip_w"] * 0.92))
    M["shoulder_w"] = round(lm["shoulder_w"] * 0.88)
    M["leg_c"] = {k: [legs[k][0]["c"], legs[k][1]["c"]] for k in ("thigh", "knee", "ankle")}
    M["leg_scale"] = (legs["thigh"][0]["w"] + legs["thigh"][1]["w"]) / 2 / 155
    # This mannequin has upper-arm caps: sleeves hang down over them instead of sticking out.
    M["arm_outer"] = lm["shoulder_w"] / 2


# Per-leg width on the mannequin (thigh, knee, hem) in px for each leg shape. Mannequin's own leg is
# about 155 / 100 / 60, so every shape keeps air around the leg below the knee.
LEG_WIDTHS = {
    "skinny": (150, 105, 75),
    "slim": (165, 118, 90),
    "straight": (175, 145, 140),
    "relaxed": (188, 168, 160),
    "baggy": (210, 200, 192),
    "wide-leg": (222, 225, 235),
    "extra-wide": (238, 248, 262),
}

# How far the hem pools over the shoe (px of extra length) for each stacking setting.
STACK = {"none": 0, "slight": 25, "stacked": 60, "heavy": 95}

# Hem position as a fraction of waistband -> crotch, by length class only (width is separate):
# an oversized tee is wide, not automatically long.
TOP_LENGTH = {"cropped": -0.15, "short": 0.30, "standard": 0.55, "long": 0.85, "longline": 1.25}


# --------------------------------------------------------------------------- measurement


def runs(row: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    xs = np.nonzero(row)[0]
    if len(xs) == 0:
        return []
    parts = np.split(xs, np.nonzero(np.diff(xs) > 2)[0] + 1)
    return [(int(p[0]), int(p[-1])) for p in parts if len(p) >= min_len]


def measure_bottom(mask: np.ndarray) -> dict:
    """Scale-free proportions of trousers photographed flat or hanging, front facing."""
    ys = np.nonzero(mask.any(axis=1))[0]
    top, bottom = int(ys[0]), int(ys[-1])
    span = bottom - top
    min_len = max(4, mask.shape[1] // 60)
    # Waistband: full left-to-right extent (the fly and belt loops can split it into pieces).
    band = [r for y in range(top + int(span * 0.01), top + int(span * 0.04)) for r in [runs(mask[y], min_len)] if r]
    waist = float(np.median([rs[-1][1] - rs[0][0] for rs in band])) if band else 1.0
    # Crotch: first row below the waist where the silhouette splits into two legs and stays split.
    crotch = None
    for y in range(top + int(span * 0.15), bottom - int(span * 0.2)):
        if all(len(runs(mask[y + k], min_len)) >= 2 for k in (0, 10, 20)):
            crotch = y
            break
    if crotch is None:
        return {"waist_px": waist, "confidence": 0.2, "note": "legs never separate; photo too folded"}
    inseam = bottom - crotch

    def leg_w(frac: float) -> float:
        y = min(bottom - 2, crotch + int(inseam * frac))
        r = sorted(runs(mask[y], min_len), key=lambda r: r[1] - r[0], reverse=True)[:2]
        return float(np.mean([b - a for a, b in r])) if r else float("nan")

    out = {
        "waist_px": waist,
        "rise_to_waist": round((crotch - top) / waist, 2),
        "outseam_to_waist": round(span / waist, 2),
        "thigh_to_waist": round(leg_w(0.06) / waist, 3),
        "knee_to_waist": round(leg_w(0.45) / waist, 3),
        "hem_to_waist": round(leg_w(0.97) / waist, 3),
    }
    out["taper"] = round(out["hem_to_waist"] / out["thigh_to_waist"], 2)
    out["confidence"] = 0.8
    return out


def measure_top(mask: np.ndarray) -> dict:
    """Scale-free proportions of a top: body width vs length, sleeve reach. Hanger shots are noisier."""
    ys = np.nonzero(mask.any(axis=1))[0]
    top, bottom = int(ys[0]), int(ys[-1])
    span = bottom - top
    width = mask.sum(axis=1)
    body = float(np.median(width[top + int(span * 0.65) : top + int(span * 0.85)]))
    widest = float(width[top : top + int(span * 0.5)].max())
    flat = width[top : top + int(span * 0.9)].std() / body < 0.25
    return {
        "body_px": body,
        "length_to_body": round(span / body, 2),
        "sleeve_reach": round((widest - body) / 2 / body, 2),
        # Hanger and closet shots crumple and overlap: trust them less than a flat lay.
        "confidence": 0.7 if flat else 0.35,
    }


def garment_mask_from(photo: Image.Image, session) -> np.ndarray:
    from rembg import remove
    from wardrobe_poc import garment_mask

    small = photo.copy()
    small.thumbnail((1200, 1200))
    alpha = np.array(remove(small, session=session).getchannel("A"))
    return ndimage.binary_fill_holes(garment_mask(alpha))


# --------------------------------------------------------------------------- spec


@dataclass
class Spec:
    item: dict
    measured: dict
    observed: dict

    def attr(self, name: str, default=None):
        # A correction the user made in the fit picker always wins over what was inferred.
        if name in self.item.get("override", {}):
            return self.item["override"][name]
        a = self.observed.get("attributes", {}).get(name)
        if not a or a.get("value") in (None, "uncertain") or a.get("confidence", 0) < 0.5:
            return default
        return a["value"]

    def to_json(self) -> dict:
        return {"item": self.item, "measured": self.measured, "observed": self.observed, "targets": self.targets()}

    def targets(self) -> dict:
        """Where the garment should land on the standard mannequin, in canvas pixels.

        Width, length, sleeves, leg shape and stacking are separate attributes, each set by the
        user's choice if there is one, else by what was observed, else a default.
        """
        k = M.get("leg_scale", 1.0)
        if self.item["category"] == "bottom":
            m = self.measured
            waist = M["waist_w"] * 1.05
            leg = str(self.attr("leg_shape", "straight")).lower()
            thigh, knee, hem = (v * k for v in LEG_WIDTHS.get(leg, LEG_WIDTHS["straight"]))
            # Blend in the photo's own thigh width only when the measurement is plausible (overhead
            # flat lay); angled shots exaggerate whatever is closest to the camera.
            ratio = m.get("thigh_to_waist")
            if ratio and 0.5 <= ratio <= 0.85 and m.get("confidence", 0) >= 0.7:
                thigh = 0.5 * thigh + 0.5 * ratio * waist
            default_stack = {"baggy": "stacked", "wide-leg": "stacked", "extra-wide": "heavy"}.get(leg, "slight" if leg == "relaxed" else "none")
            stack = str(self.attr("stack", "stacked" if self.attr("length") == "stacked" else default_stack)).lower()
            return {"leg": leg, "stack": stack, "waist": round(waist), "thigh": round(thigh), "knee": round(knee), "hem": round(hem), "stack_px": STACK.get(stack, 0)}
        fit = str(self.attr("fit", self.item.get("fit") or "regular")).lower()
        ease = {"fitted": 1.0, "slim": 1.0, "regular": 1.1, "relaxed": 1.18, "boxy": 1.25, "oversized": 1.32}.get(fit, 1.1)
        if str(self.attr("boxy")).lower() == "true":
            ease = max(ease, 1.25)
        body = M["shoulder_w"] * ease
        length_cls = str(self.attr("length", "standard")).lower()
        frac = TOP_LENGTH.get(length_cls, TOP_LENGTH["standard"])
        hem = M["waist_y"] + frac * (M["crotch_y"] - M["waist_y"])
        # The photo's own length/width ratio only counts when trustworthy (flat lay, plausible).
        ratio = self.measured.get("length_to_body")
        if ratio and 0.95 <= ratio <= 1.35 and self.measured.get("confidence", 0) >= 0.7:
            hem = 0.5 * hem + 0.5 * (M["shoulder_y"] + body * ratio)
        return {"fit": fit, "length_class": length_cls, "body": round(body), "length": round(hem - M["shoulder_y"]), "hem_y": round(hem)}


# --------------------------------------------------------------------------- silhouette guide


# Mannequin leg centre lines (offset from cx) at thigh, knee and ankle: the legs angle slightly outward.
LEG_CENTRE = {"thigh": 92, "knee": 100, "ankle": 103}

# Sleeve and shoulder shape per top fit: (shoulder drop px, sleeve reach past the body, sleeve length).
SLEEVES = {
    "fitted": (0, 0.10, 0.30),
    "slim": (0, 0.10, 0.30),
    "regular": (10, 0.14, 0.36),
    "relaxed": (30, 0.17, 0.42),
    "boxy": (40, 0.18, 0.40),
    "oversized": (60, 0.20, 0.52),
}


def silhouette(spec: Spec) -> Image.Image:
    """A flat target outline on the standard mannequin: the reusable, parametric 'template'."""
    t = spec.targets()
    cx = M["cx"]
    img = Image.new("L", (1080, 1920), 0)
    d = ImageDraw.Draw(img)
    if spec.item["category"] == "bottom":
        # Hem height by stacking: none shows the whole shoe, heavy pools down onto it.
        span = M["floor_y"] - M["ankle_y"]
        bottom = M["ankle_y"] + {0: 0.15, 25: 0.5, 60: 0.8, 95: 1.0}.get(t["stack_px"], 0.8) * span
        # Inner edges never cross the centre line: wide legs stay two legs, not a skirt.
        inner = lambda x, side: cx + side * max(14, side * (x - cx))
        d.rectangle((cx - t["waist"] / 2, M["waist_y"], cx + t["waist"] / 2, M["crotch_y"] + 20), fill=255)
        for side in (-1, 1):
            # Each leg is built around the mannequin's own leg line, so even slim legs cover it.
            i = 0 if side < 0 else 1
            centre = lambda k: M["leg_c"][k][i] if "leg_c" in M else cx + side * LEG_CENTRE[k]
            c_thigh, c_knee, c_ankle = centre("thigh"), centre("knee"), centre("ankle")
            hip_outer = cx + side * t["waist"] / 2
            pts = [
                (cx, M["crotch_y"] - 10),
                (hip_outer, M["waist_y"] + 40),
                (c_thigh + side * t["thigh"] / 2, M["crotch_y"] + 40),
                (c_knee + side * t["knee"] / 2, M["knee_y"]),
                (c_ankle + side * t["hem"] / 2, bottom),
                (inner(c_ankle - side * t["hem"] / 2, side), bottom),
                (inner(c_knee - side * t["knee"] / 2, side), M["knee_y"]),
                (inner(c_thigh - side * t["thigh"] / 2, side), M["crotch_y"] + 40),
                (cx, M["crotch_y"] + 10),
            ]
            d.polygon(pts, fill=255)
    else:
        body, hem = t["body"], t["hem_y"]
        drop, reach_k, length_k = SLEEVES.get(t.get("fit", "regular"), SLEEVES["regular"])
        sy = M["shoulder_y"]
        shoulder_x = M["shoulder_w"] / 2 + drop
        armhole_y = sy + 0.40 * body
        reach = body / 2 + body * reach_k
        sleeve_end_y = sy + 25 + body * length_k
        if "arm_outer" in M:
            reach = max(body / 2 + 20, M["arm_outer"] + 18) + body * reach_k * 0.3
            sleeve_end_y += 40
        d.polygon(
            [
                (cx - 65, sy - 18),
                (cx + 65, sy - 18),
                (cx + shoulder_x, sy + 12 + drop * 0.25),
                (cx + reach, sleeve_end_y - 40),
                (cx + reach - 18, sleeve_end_y),
                (cx + body / 2, armhole_y),
                (cx + body / 2, hem),
                (cx - body / 2, hem),
                (cx - body / 2, armhole_y),
                (cx - reach + 18, sleeve_end_y),
                (cx - reach, sleeve_end_y - 40),
                (cx - shoulder_x, sy + 12 + drop * 0.25),
            ],
            fill=255,
        )
    return img


def guide_image(canonical: Image.Image, sil: Image.Image) -> Image.Image:
    """Canonical mannequin with the target silhouette as a flat light-grey shape."""
    out = canonical.convert("RGB").copy()
    grey = Image.new("RGB", out.size, (205, 205, 205))
    out.paste(grey, (0, 0), sil)
    return out


def silhouette_score(layer_alpha: np.ndarray, sil: Image.Image) -> dict:
    """How closely the prepared layer follows the target outline (IoU) plus key-row width errors."""
    a = layer_alpha > 128
    s = np.array(sil) > 128
    iou = float((a & s).sum() / max(1, (a | s).sum()))
    ys = np.nonzero(a.any(axis=1))[0]
    return {"iou": round(iou, 2), "top_y": int(ys[0]) if len(ys) else None, "bottom_y": int(ys[-1]) if len(ys) else None}


def row_width(mask: np.ndarray, y: int) -> int:
    xs = np.nonzero(mask[y])[0]
    return int(xs[-1] - xs[0]) if len(xs) else 0


def dumps(obj) -> str:
    return json.dumps(obj, indent=2, default=float)


# --------------------------------------------------------------------------- observation (vision)

CLASSIFY_PROMPT = """You are cataloguing one garment for a virtual wardrobe from a phone photo.
Return JSON only, with this shape:
{
  "category": "top" | "bottom",
  "construction": short words, e.g. "crew-neck t-shirt", "camp-collar button-up shirt", "tank", "hoodie",
                  "5-pocket jeans", "cargo pants", "carpenter pants", "drawstring trousers",
  "attributes": {   each value is {"value": ..., "confidence": 0..1}; use "uncertain" when the photo
                    does not show it clearly. Attributes are independent; several can apply.
    tops:    "fit" (fitted|regular|relaxed|oversized), "boxy" (true|false), "tapered" (true|false),
             "length" (cropped|standard|longline), "shoulder_drop" (none|slight|dropped),
             "sleeve_length" (sleeveless|short|elbow|three-quarter|long)
    bottoms: "leg_shape" (skinny|slim|straight|relaxed|baggy|wide-leg), "rise" (low|mid|high),
             "length" (cropped|standard|stacked), "thigh_room" (tight|moderate|roomy|very-roomy),
             "hem_opening" (narrow|medium|wide|very-wide), "cargo_pockets" (true|false),
             "carpenter_details" (true|false)
  },
  "colour": plain-words main colour and wash,
  "visible_text": [{"text": exactly as printed, use ? for any letter you cannot see,
                    "location": where on the garment, "side": "image-left"|"centre"|"image-right",
                    "legibility": "clear"|"partial"|"unreadable"}],
  "logos": [{"description": ..., "location": ..., "side": "image-left"|"centre"|"image-right"}],
  "ignore": [things that are not part of the garment: store tags, stickers, hangers, other clothes],
  "needs_another_photo": true|false,
  "reason": why, if true (e.g. text hidden by a fold, garment folded, cropped out of frame)
}
"image-left" means the left side of the photo as you look at it. Never guess hidden letters."""


def classify(photo: Image.Image, key: str, model: str, ledger) -> dict:
    import base64
    import io
    import time
    import urllib.request

    img = photo.convert("RGB")
    img.thumbnail((1280, 1280))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    body = {
        "contents": [{"parts": [{"text": CLASSIFY_PROMPT}, {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    ledger.check(model)
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        data = json.load(res)
    ledger.record(f"classify", model, data.get("usageMetadata", {}), time.perf_counter() - t0)
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    return json.loads(text[text.find("{") : text.rfind("}") + 1])


# --------------------------------------------------------------------------- registration


_SESSION = None


def mannequin_mask(rgb: Image.Image, scale: float = 0.25) -> np.ndarray:
    """Bare green mannequin pixels at low resolution: foreground (background removal) that is still green.

    Garments aren't green, so they drop out; the backdrop is removed even when it has a gradient.
    """
    global _SESSION
    from rembg import new_session, remove

    if _SESSION is None:
        _SESSION = new_session("isnet-general-use")
    small = rgb.convert("RGB").resize((round(rgb.width * scale), round(rgb.height * scale)), Image.BILINEAR)
    fg = np.array(remove(small, session=_SESSION).getchannel("A")) > 128
    a = np.array(small).astype(np.float32)
    green = (a[..., 1] - np.maximum(a[..., 0], a[..., 2])) > 25
    return fg & green


def register(dressed: Image.Image, canonical: Image.Image) -> tuple[float, float, float]:
    """Scale and offset that map the dressed render onto the canonical mannequin.

    Image models sometimes zoom or shift the frame. Whatever stays bare green mannequin (neck, arms,
    legs, feet) is matched against the canonical mannequin over a range of scales; the garment
    itself is ignored. Returns (scale, dx, dy) in full-resolution pixels.
    """
    from scipy.signal import fftconvolve

    k = 0.25
    ref = mannequin_mask(canonical, k).astype(np.float32)
    src0 = Image.fromarray((mannequin_mask(dressed, k) * 255).astype(np.uint8))
    best = (-1.0, 1.0, 0.0, 0.0)
    for s in np.arange(0.60, 1.42, 0.02):
        src = (np.array(src0.resize((round(src0.width * s), round(src0.height * s)), Image.BILINEAR)) > 127).astype(np.float32)
        corr = fftconvolve(ref, src[::-1, ::-1], mode="full")
        score = corr.max() / np.sqrt(src.sum() * ref.sum() + 1e-6)
        if score > best[0]:
            iy, ix = np.unravel_index(corr.argmax(), corr.shape)
            best = (score, float(s), (ix - (src.shape[1] - 1)) / k, (iy - (src.shape[0] - 1)) / k)
    return best[1], best[2], best[3]


def neck_registration(dressed: Image.Image, canonical: Image.Image) -> tuple[float, float, float]:
    """Undo a zoom/shift using the neck stand, which stays bare above every collar.

    Returns (scale, dx, dy) mapping the dressed render onto the canonical frame. Used only to
    recover a render the framing check failed; the check then runs again on the result.
    """

    def neck(img):
        m = mannequin_mask(img, 0.5)
        w = m.shape[1]
        band = m[:, int(w * 0.3) : int(w * 0.7)]
        top = int(np.nonzero(band.sum(axis=1) > 4)[0][0])
        widths = [np.ptp(np.nonzero(band[y])[0]) if band[y].any() else 0 for y in range(top + 20, top + 60)]
        xs = np.nonzero(band[top + 40])[0] + int(w * 0.3)
        return top * 2, float(np.median(widths)) * 2, float(xs.mean()) * 2

    tc, wc, xc = neck(canonical)
    td, wd, xd = neck(dressed)
    s = wc / wd
    return s, xc - xd * s, tc - td * s


def apply_registration(img: Image.Image, s: float, dx: float, dy: float, size=(1080, 1920), fill=None) -> Image.Image:
    """Scale an image by s and place it at (dx, dy) on a canvas of the canonical size."""
    mode = img.mode
    scaled = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    frame = Image.new(mode, size, fill if fill is not None else (0,) * len(mode))
    frame.paste(scaled, (round(dx), round(dy)))
    return frame
