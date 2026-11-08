"""Garment preparation: the prototype pipeline (scripts/avatar-prototype/poc) behind a job interface.

The prototype modules keep the prompts, keying, alignment recovery and quality checks that were
validated on real garments; this module only routes their model calls through the guarded
`ModelClient`, and turns their results into "usable asset" or "ask the user" outcomes.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

POC = Path(__file__).resolve().parents[2] / "scripts" / "avatar-prototype" / "poc"
if str(POC) not in sys.path:
    sys.path.insert(0, str(POC))

import fit_spec  # noqa: E402
import styling  # noqa: E402
from ai_prep import color_lock, key_layer  # noqa: E402
from drape import DRAPE, SHIRT_PROMPT_NO_ANCHOR, default_drape, key_shirt, untucked_check  # noqa: E402
from fit_spec import CLASSIFY_PROMPT, Spec, apply_registration, guide_image, neck_registration, silhouette  # noqa: E402
from prep_v2 import REAL_SHOES_PROMPT, VERIFY_PROMPT, build_prompt, clean_layer, framing_check, hue_guard, refine_registration, text_gate  # noqa: E402

from .models import ModelClient, ModelError, jpeg_part  # noqa: E402

ASK_BELOW = 0.9  # a fit reading under this confidence is confirmed by the user before preparing


class NeedsPhoto(Exception):
    """The photo can't be prepared reliably (hidden text, folded garment): ask for another photo."""


class Unusable(Exception):
    """This attempt produced an inaccurate asset; retryable within the job's attempt limit."""


@dataclass
class Mannequin:
    canonical: Image.Image
    ref_trousers: Image.Image
    plate: Image.Image
    landmarks: dict
    session: object = None  # rembg session, created once

    @classmethod
    def load(cls, folder: Path) -> "Mannequin":
        fit_spec.use_landmarks(folder / "landmarks.json")
        import json

        from rembg import new_session

        return cls(
            canonical=Image.open(folder / "canonical.png").convert("RGB"),
            ref_trousers=Image.open(folder / "ref-trousers.png").convert("RGB"),
            plate=Image.open(folder / "plate.png").convert("RGB"),
            landmarks=json.loads((folder / "landmarks.json").read_text()),
            session=new_session("isnet-general-use"),
        )


@dataclass
class Ctx:
    client: ModelClient
    user_id: str
    job_id: str | None
    fingerprint: str  # perceptual hash of the main garment photo
    # Keeps every paid render, so a layer can be re-keyed or re-checked later without paying again.
    keep: Callable[[Image.Image, str], None] | None = None

    def render(self, purpose: str, parts: list[dict]) -> Image.Image:
        img = self.client.image(user_id=self.user_id, job_id=self.job_id, purpose=purpose, fingerprint=self.fingerprint, parts=parts)
        if self.keep:
            self.keep(img, purpose)
        return img


@dataclass
class Prepared:
    layer: Image.Image  # full 1080x1920 RGBA on the mannequin canvas
    styling: dict
    checks: dict = field(default_factory=dict)


# --------------------------------------------------------------------------- analysis


def _fabric(construction: str) -> str:
    c = construction.lower()
    if any(w in c for w in ("button", "camp", "oxford", "flannel", "overshirt", "woven")):
        return "woven"
    if "rib" in c:
        return "rib"
    if "denim" in c or "jean" in c:
        return "denim"
    return "knit"


def suggested_fit(category: str, observed: dict) -> dict:
    """App-facing fit with confidences, in plain categories the visual pickers use."""
    a = observed.get("attributes", {})

    def fv(key, value=None, conf=None):
        x = a.get(key) or {}
        v = value if value is not None else x.get("value")
        c = conf if conf is not None else x.get("confidence", 0.0)
        if v in ("uncertain", None):
            return {"value": None, "confidence": 0.0, "source": "vision"}
        return {"value": v, "confidence": float(c), "source": "vision"}

    if category == "top":
        width = str((a.get("fit") or {}).get("value", "regular")).lower()
        if str((a.get("boxy") or {}).get("value")).lower() == "true" and width in ("regular", "relaxed"):
            width = "boxy" if width == "regular" else width
        construction = observed.get("construction", "")
        return {
            "width": fv("fit", width),
            "length": fv("length"),
            "sleeves": fv("sleeve_length"),
            "shoulderDrop": fv("shoulder_drop"),
            "fabric": {"value": _fabric(construction), "confidence": 0.8, "source": "vision"},
            "hasClosure": {"value": _fabric(construction) == "woven", "confidence": 0.8, "source": "vision"},
        }
    if category == "bottom":
        return {"legShape": fv("leg_shape"), "rise": fv("rise"), "length": fv("length")}
    return {}


def questions(category: str, fit: dict) -> list[str]:
    """Which visual pickers to show before preparing: only what the reading isn't sure about."""
    keys = {"top": ["width", "length"], "bottom": ["legShape"]}.get(category, [])
    return [k for k in keys if (fit.get(k) or {}).get("confidence", 0) < ASK_BELOW or (fit.get(k) or {}).get("value") is None]


def analyze(photo: Image.Image, category: str, ctx: Ctx) -> dict:
    observed = ctx.client.vision(user_id=ctx.user_id, job_id=None, purpose="analyze", fingerprint=ctx.fingerprint,
                                 parts=[{"text": CLASSIFY_PROMPT}, jpeg_part(photo, 1280)])
    if observed.get("category") and category in ("top", "bottom") and observed["category"] != category:
        category_note = f"This looks like a {observed['category']}, not a {category}."
    else:
        category_note = None
    fit = suggested_fit(category, observed)
    problems = text_gate(observed) if category in ("top", "bottom", "outerwear", "onepiece") else []
    return {
        "category": category,
        "categoryNote": category_note,
        "construction": observed.get("construction"),
        "colour": observed.get("colour"),
        "fit": fit,
        "ask": questions(category, fit),
        "defaultDrape": default_drape(observed) if category == "top" else None,
        "needsAnotherPhoto": "; ".join(problems) or None,
        "observed": observed,
    }


def apply_corrections(observed: dict, category: str, corrections: dict) -> dict:
    """User corrections overwrite the reading, in the prototype's attribute names."""
    obs = {**observed, "attributes": dict(observed.get("attributes", {}))}
    mapping = {"width": "fit", "length": "length", "legShape": "leg_shape", "rise": "rise", "sleeves": "sleeve_length"}
    for k, v in (corrections or {}).items():
        if k in mapping and v is not None:
            if k == "width" and v == "boxy":
                obs["attributes"]["fit"] = {"value": "relaxed", "confidence": 1.0}
                obs["attributes"]["boxy"] = {"value": True, "confidence": 1.0}
            else:
                obs["attributes"][mapping[k]] = {"value": v, "confidence": 1.0}
    return obs


# --------------------------------------------------------------------------- shared steps


def _recover(render: Image.Image, base: Image.Image, category: str) -> tuple[Image.Image, dict]:
    """Alignment check with zoom recovery (the model sometimes zooms or shifts the frame)."""
    framing = framing_check(render, base, category)
    if framing["ok"]:
        return render, framing
    starts = [(z, (1 - z) * render.width / 2, (1 - z) * render.height * 0.15) for z in np.arange(0.5, 0.96, 0.05)]
    try:
        est = neck_registration(render, base)
        if 0.4 < est[0] < 1.6:
            starts.insert(0, est)
    except (ZeroDivisionError, IndexError, ValueError):
        pass
    best = max((refine_registration(render, base, category, *s) for s in starts),
               key=lambda r: framing_check(apply_registration(render, *r, fill=(0, 0, 0)), base, category)["ncc"])
    fill = tuple(int(v) for v in np.median(np.array(render)[:, :20].reshape(-1, 3), axis=0))
    moved = apply_registration(render, *best, fill=fill)
    again = framing_check(moved, base, category)
    if again["ncc"] > 0.93:
        return moved, {**again, "ok": True, "registered": [round(float(v), 3) for v in best]}
    raise Unusable("the render didn't line up with the mannequin")


IGNORE_PRINT = ("fine print", "fine text", "small", "tiny", "descriptive text", "paragraph", "body copy",
                "tag", "label", "trouser", "pants", "mannequin", "display", "hanger")
PRINT_CHANGED = ("missing", "font", "altered", "different", "misspell", "redrawn")


def _verify(photo: Image.Image, render: Image.Image, ctx: Ctx, purpose: str) -> tuple[dict, list[str]]:
    check = ctx.client.vision(user_id=ctx.user_id, job_id=ctx.job_id, purpose=purpose, fingerprint=ctx.fingerprint,
                              parts=[{"text": VERIFY_PROMPT}, jpeg_part(photo, 1280), jpeg_part(render, 1280)])
    changed = [m for m in check.get("mismatches", []) if not any(w in m.lower() for w in IGNORE_PRINT)
               and any(w in m.lower() for w in PRINT_CHANGED)]
    return check, changed


# --------------------------------------------------------------------------- per category


HOLES_MAX = {"top": 0.005, "bottom": 0.005, "shoes": 0.05}  # good layers measure <= 0.0007 (shoes 0.0154)


def enclosed_holes(layer: Image.Image) -> float:
    """Share of the garment's outline that is transparent inside it: keying that ate into the fabric."""
    from scipy import ndimage

    m = np.array(layer.getchannel("A")) > 128
    filled = ndimage.binary_fill_holes(m)
    return float((filled & ~m).sum() / max(1, filled.sum()))


def top_fit_note(observed: dict) -> str:
    """The confirmed fit, in words the image model follows (width, length, sleeves, shoulders)."""
    a = observed.get("attributes", {})
    val = lambda k: str((a.get(k) or {}).get("value") or "").lower()
    width = "boxy" if val("boxy") == "true" else val("fit")
    words = {
        "fitted": "Fitted: close to the body through the chest and waist.",
        "slim": "Slim: close to the body through the chest and waist.",
        "regular": "Regular fit: straight body with a little ease, not tight and not loose.",
        "relaxed": "Relaxed fit: loose through the body with visible ease at the sides.",
        "boxy": "Boxy fit: wide, straight, square body that stands away from the torso, with a wide hem.",
        "oversized": "Oversized: much wider than the body, dropped shoulders, roomy sleeves.",
    }
    parts = [words.get(width, "")]
    if val("length"):
        parts.append({"cropped": "Cropped length, ending above the waistband.", "short": "Short length, ending at the waistband.",
                      "standard": "Standard length, ending around the hips.", "long": "Long length, ending below the hips.",
                      "longline": "Longline, ending at the upper thigh."}.get(val("length"), ""))
    if val("shoulder_drop") == "dropped":
        parts.append("Dropped shoulder seams that sit below the shoulder point.")
    return " ".join(p for p in parts if p)


def _check_holes(layer: Image.Image, category: str, checks: dict) -> None:
    holes = enclosed_holes(layer)
    checks["holes"] = round(holes, 4)
    if holes > HOLES_MAX[category]:
        raise Unusable("parts of the garment came out transparent")


def prepare_top(photo: Image.Image, observed: dict, request: dict, mq: Mannequin, ctx: Ctx) -> Prepared:
    drape = request.get("drape") or default_drape(observed)
    closure = request.get("closure")
    style = "crisp_open" if closure == "open" else drape
    fit_note = request.get("fitNote") or top_fit_note(observed)
    if request.get("correction"):
        fit_note += f" Correction requested by the owner: {request['correction']}."
    prompt = SHIRT_PROMPT_NO_ANCHOR.format(style=DRAPE[style], ref="", fit=fit_note.strip())
    render = ctx.render(f"render:top:{style}", [{"text": prompt}, jpeg_part(mq.ref_trousers), jpeg_part(photo)])
    render, framing = _recover(render, mq.ref_trousers, "top")
    checks: dict = {"framing": framing}
    keyed = clean_layer(key_shirt(render))
    _check_holes(keyed, "top", checks)
    layer = hue_guard(color_lock(keyed, photo, mq.session), photo, mq.session)
    if style != "crisp_open":
        # The reference trousers' waistband (top row and x-range) on the shared base image.
        waist = untucked_check(render, layer, 754, 395, 713)
        checks["waist"] = waist
        if not waist["ok"]:
            raise Unusable("the shirt didn't stay outside the waistband")
    verify, changed = _verify(photo, render, ctx, f"verify:top:{style}")
    checks["verify"] = verify
    if changed:
        raise Unusable("the print didn't match the photo: " + "; ".join(changed))
    return Prepared(layer, {"drape": drape, "closure": closure, "tuck": "untucked", "slot": "outer" if closure == "open" else "inner"}, checks)


def prepare_bottom(photo: Image.Image, observed: dict, request: dict, mq: Mannequin, ctx: Ctx) -> Prepared:
    spec = Spec({"category": "bottom", "override": request.get("override", {})}, request.get("measured", {}), observed)
    guide = guide_image(mq.canonical, silhouette(spec))
    prompt = build_prompt(spec, template=True)
    if request.get("correction"):
        prompt += f" Correction requested by the owner: {request['correction']}."
    render = ctx.render("render:bottom", [{"text": prompt}, jpeg_part(guide), jpeg_part(photo)])
    render, framing = _recover(render, mq.canonical, "bottom")
    keyed = clean_layer(key_layer(render))
    holes: dict = {}
    _check_holes(keyed, "bottom", holes)
    layer = hue_guard(color_lock(keyed, photo, mq.session), photo, mq.session)
    layer, legs = styling.follow_legs(layer, mq.landmarks)
    verify, changed = _verify(photo, render, ctx, "verify:bottom")
    if changed:
        raise Unusable("details didn't match the photo: " + "; ".join(changed))
    return Prepared(layer, {"legs": "follow", "legShape": spec.targets()["leg"]}, {"framing": framing, "legs": legs, "verify": verify, **holes})


def prepare_shoes(photo: Image.Image, observed: dict, request: dict, mq: Mannequin, ctx: Ctx) -> Prepared:
    render = ctx.render("render:shoes", [{"text": REAL_SHOES_PROMPT}, jpeg_part(mq.canonical), jpeg_part(photo)])
    render, framing = _recover(render, mq.canonical, "bottom")
    layer = clean_layer(key_layer(render))
    a = np.array(layer.getchannel("A"))
    a[: mq.landmarks["ankle_y"] - 90] = 0  # only the feet
    layer.putalpha(Image.fromarray(a))
    layer = hue_guard(color_lock(layer, photo, mq.session), photo, mq.session)
    checks: dict = {"framing": framing}
    _check_holes(layer, "shoes", checks)
    feet = styling.shoe_meta(layer, mq.landmarks["cx"])
    if len(feet) != 2:
        raise Unusable("couldn't find both shoes on the feet")
    return Prepared(layer, {"feet": feet}, checks)


PREPARERS = {"top": prepare_top, "outerwear": prepare_top, "bottom": prepare_bottom, "shoes": prepare_shoes}


# --------------------------------------------------------------------------- derived pairs (free)


def derive_stacks(pants: Image.Image, shoes: Image.Image, feet: list[dict], cx: int) -> dict[str, Image.Image]:
    """Pants hem gathered against a specific shoe, at every stacking level. Deterministic, no model call."""
    return {lvl: styling.stack(pants, feet, lvl, cx) for lvl in ("minimal", "natural", "heavy", "puddled")}


def split_shoe(shoes: Image.Image, feet: list[dict]) -> tuple[Image.Image, Image.Image]:
    return styling.split_shoe(shoes, feet)
