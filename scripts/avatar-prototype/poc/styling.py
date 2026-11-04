"""Deterministic styling and occlusion for prepared garment layers (no model calls).

Every function here works on layers that were already prepared once, plus small metadata measured
from them. Results can be cached per garment (and per pair, where noted) or computed at swap time;
none of them re-render the garment.

  shirt metadata   graphic_bottom (lowest row with print), hem line
  pants metadata   waistband top line, leg centre per row, hem
  shoe metadata    per foot: top (collar) row, toe region

  tuck()        untucked / front / half / full / gathered: hides the shirt below a hem curve drawn
                from the chosen pants' waistband line, adds overhang shading and diagonal pull
                folds. Pixels above the graphics are never moved, so prints can't distort; a tuck
                only hides what a real tuck hides.
  follow_legs() bends each trouser leg so its centre line follows the mannequin's own thigh, knee
                and ankle landmarks (a horizontal shear per leg, strongest at the ankle). Widths
                are kept, so baggy stays baggy.
  stack()       ends the leg at a height chosen from the shoe's collar and gathers the fabric
                above it into folds (vertical compression with fold shading), instead of simply
                cutting the leg shorter.
  split_shoe()  divides a shoe layer into its back (drawn under the pants) and the toe box
                (drawn over the hem), so stacked hems rest on the shoe instead of swallowing it.

This is image processing, not cloth simulation: it is believable for small pose differences and
moderate tucks, and it can't create fabric that was never rendered (for example the inside of a
cuff, or a hem that has to wrap around a much bulkier shoe).
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# --------------------------------------------------------------------------- measurements


def alpha(layer: Image.Image) -> np.ndarray:
    return np.array(layer.getchannel("A")).astype(np.float32) / 255


def runs(row: np.ndarray, min_len: int = 8) -> list[tuple[int, int]]:
    xs = np.nonzero(row)[0]
    if not len(xs):
        return []
    parts = np.split(xs, np.nonzero(np.diff(xs) > 3)[0] + 1)
    return [(int(p[0]), int(p[-1])) for p in parts if len(p) >= min_len]


def shirt_meta(layer: Image.Image, cx: int) -> dict:
    """Lowest row that still carries print (text or graphics) near the centre, and the hem."""
    a = alpha(layer) > 0.5
    lum = np.array(layer.convert("L")).astype(np.float32)
    edges = np.abs(np.diff(lum, axis=1))
    edges[~a[:, 1:]] = 0
    energy = edges[:, cx - 220 : cx + 220].mean(axis=1)
    ys = np.nonzero(a.any(axis=1))[0]
    rows = a.sum(axis=1)
    hem = int(np.nonzero(rows > rows.max() * 0.3)[0][-1])
    plain = np.median(energy[hem - 120 : hem - 20])
    busy = np.nonzero(energy[: hem - 20] > plain * 3)[0]
    return {"top": int(ys[0]), "hem": hem, "graphic_bottom": int(busy[-1]) if len(busy) else int(ys[0])}


def pants_meta(layer: Image.Image) -> dict:
    a = alpha(layer) > 0.5
    ys = np.nonzero(a.any(axis=1))[0]
    top, bottom = int(ys[0]), int(ys[-1])
    # Waistband top per column (the first opaque row), used as the tuck line.
    first = np.where(a.any(axis=0), a.argmax(axis=0), -1)
    return {"top": top, "bottom": bottom, "waist_line": first.tolist()}


def shoe_meta(layer: Image.Image, cx: int) -> list[dict]:
    """Per foot: bounding box, collar (top) row and the row where the toe box starts."""
    a = alpha(layer) > 0.5
    feet = []
    for x0, x1 in ((0, cx), (cx, a.shape[1])):
        m = a[:, x0:x1]
        ys, xs = np.nonzero(m)
        if not len(ys):
            continue
        top, bottom = int(ys.min()), int(ys.max())
        h = bottom - top
        feet.append({"x0": int(xs.min()) + x0, "x1": int(xs.max()) + x0, "top": top, "bottom": bottom,
                     "collar": top + int(0.22 * h), "toe": top + int(0.48 * h)})
    return feet


# --------------------------------------------------------------------------- shirts


def tuck(shirt: Image.Image, style: str, waist_line: list[int], meta: dict, cx: int) -> Image.Image:
    """Return the shirt worn in a styling variant. The pants' waistband line decides the tuck height."""
    if style == "untucked":
        return shirt
    a = alpha(shirt)
    h, w = a.shape
    xs = np.arange(w)
    cols = np.nonzero(a.max(axis=0) > 0.5)[0]
    left, right = int(cols[0]), int(cols[-1])
    half = (right - left) / 2
    wl = np.array(waist_line, np.float32)
    wl[wl < 0] = np.nan
    wl = np.nan_to_num(wl, nan=np.nanmedian(wl))
    wl = ndimage.uniform_filter1d(wl, 41)
    hem = float(meta["hem"])
    tucked_y = wl + 14  # the shirt disappears just inside the waistband

    def bell(centre, radius):
        d = np.clip(np.abs(xs - centre) / radius, 0, 1)
        return 1 - (3 * d**2 - 2 * d**3)  # 1 at the tuck, easing to 0

    if style == "full":
        lift = np.ones(w)
        line = tucked_y
    elif style == "front":
        lift = bell(cx, half * 0.62)
        line = tucked_y * lift + (hem - 40) * (1 - lift)
    elif style == "half":
        c = cx - half * 0.32
        lift = bell(c, half * 0.75) * (xs < cx + half * 0.2)
        lift = ndimage.uniform_filter1d(lift.astype(np.float32), 61)
        line = tucked_y * lift + hem * (1 - lift)
    elif style == "gathered":
        # Loosely gathered over the waistband rather than into it: the hem rises toward the centre
        # and rests on (or just over) the pants instead of disappearing.
        lift = bell(cx, half * 0.85)
        line = (tucked_y + 30) * lift + (hem - 30) * (1 - lift)
    else:
        raise ValueError(style)

    # Gather, don't cut: in each column the fabric between `start` and the hem is squeezed up into
    # [start, line], so the hem rises and the cloth bunches toward the tuck. `start` is below the
    # lowest print, so graphics are never resampled; a print that reaches the waistband limits how
    # high the hem can go (reported as `limited_by_print`).
    start = float(max(meta["graphic_bottom"] + 10, np.nanmin(tucked_y) - 170))
    line = np.maximum(line, start + 28)
    limited = bool(np.any(line[lift > 0.9] > tucked_y[lift > 0.9] + 20)) if np.any(lift > 0.9) else False
    arr = np.array(shirt).astype(np.float32)
    yy = np.arange(h, dtype=np.float32)[:, None].repeat(w, 1)
    span_dst = np.maximum(line - start, 1)[None, :]
    t = np.clip((yy - start) / span_dst, 0, 1)
    ratio = (hem - start) / span_dst  # how many source rows each destination row has to hold
    folds_n = np.clip(ratio - 1, 0, 3)
    warp = t + 0.06 * folds_n * np.sin(t * np.pi * 2 * (1 + folds_n)) / (np.pi * 2)
    src_y = np.where(yy < start, yy, start + np.clip(warp, 0, 1) * (hem - start))
    xx = np.arange(w, dtype=np.float32)[None, :].repeat(h, 0)
    out = np.stack([ndimage.map_coordinates(arr[..., c], [src_y, xx], order=1) for c in range(4)], -1)
    below = yy > line[None, :]
    out[below] = 0
    # Fold shading inside the gathered band: ridges and valleys that grow toward the tuck line,
    # leaning toward the tuck point; a soft shadow where the fabric turns into the waistband.
    centre = cx if style != "half" else cx - half * 0.32
    rel = (xx - centre) / max(1, half)
    band = (yy >= start) & ~below
    ridge = np.cos((t * (1 + folds_n) + rel * 0.35) * np.pi * 2)
    amp = 0.10 * np.clip(ratio - 1, 0, 2.5) / 2.5 * t
    shade = 1 + np.where(band, amp * ridge - 0.10 * t**3 * np.clip(ratio - 1, 0, 1), 0)
    out[..., :3] *= shade[..., None]
    edge = Image.fromarray(np.clip(out[..., 3], 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    result = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    result.putalpha(edge)
    result.info["limited_by_print"] = limited
    return result


# --------------------------------------------------------------------------- pants


def leg_centres(layer: Image.Image, crotch_y: int) -> dict[int, tuple[float, float]]:
    a = alpha(layer) > 0.5
    out = {}
    for y in range(crotch_y + 60, a.shape[0]):
        r = sorted(runs(a[y]), key=lambda r: r[1] - r[0], reverse=True)[:2]
        if len(r) == 2:
            r = sorted(r)
            out[y] = ((r[0][0] + r[0][1]) / 2, (r[1][0] + r[1][1]) / 2)
    return out


def follow_legs(pants: Image.Image, lm: dict) -> tuple[Image.Image, dict]:
    """Shear each trouser leg so its centre follows the mannequin's leg landmarks."""
    a = alpha(pants)
    h, w = a.shape
    cur = leg_centres(pants, lm["crotch_y"])
    legs = lm["legs"]
    keys_y = [lm["crotch_y"] + 70, lm["knee_y"], lm["ankle_y"]]
    targets = [[legs[k][i]["c"] for k in ("thigh", "knee", "ankle")] for i in (0, 1)]
    ys = np.arange(h)
    shift = np.zeros((2, h), np.float32)
    report = {}
    for i in (0, 1):
        tgt = np.interp(ys, keys_y, targets[i])
        have = np.array([cur[y][i] if y in cur else np.nan for y in ys])
        valid = ~np.isnan(have)
        if valid.sum() < 50:
            continue
        have = np.interp(ys, ys[valid], have[valid])
        delta = tgt - have
        # No shift at the hips, full shift from the knee down; smooth along the leg.
        weight = np.clip((ys - lm["crotch_y"]) / (lm["knee_y"] - lm["crotch_y"]), 0, 1)
        shift[i] = ndimage.uniform_filter1d(delta * weight, 61)
        report[["image-left", "image-right"][i]] = {
            "knee_err_before": round(float(have[lm["knee_y"]] - targets[i][1]), 1),
            "ankle_err_before": round(float(have[min(lm["ankle_y"], h - 1)] - targets[i][2]), 1),
        }
    # Backward map: an output pixel left of the (shifted) split takes the left leg's shift.
    split = np.array([(cur[y][0] + cur[y][1]) / 2 if y in cur else lm["cx"] for y in ys])
    split = ndimage.uniform_filter1d(split + (shift[0] + shift[1]) / 2, 31)
    xx = np.arange(w)[None, :].repeat(h, 0).astype(np.float32)
    yy = ys[:, None].repeat(w, 1).astype(np.float32)
    t = np.clip((xx - split[:, None]) / 24 + 0.5, 0, 1)  # blend across the gap between legs
    sx = xx - (shift[0][:, None] * (1 - t) + shift[1][:, None] * t)
    arr = np.array(pants).astype(np.float32)
    out = np.stack([ndimage.map_coordinates(arr[..., c], [yy, sx], order=1, mode="constant") for c in range(4)], -1)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA"), report


STACK_LEVELS = {
    # hem height as a fraction of the shoe (0 = collar, 1 = sole), fabric gathered above it (px),
    # fold count, and how much the hem flares over the shoe.
    "minimal": (0.10, 40, 1, 0.00),
    "natural": (0.32, 120, 2, 0.04),
    "heavy": (0.52, 190, 3, 0.07),
    "puddled": (0.80, 260, 4, 0.10),
}


def stack(pants: Image.Image, feet: list[dict], level: str, cx: int) -> Image.Image:
    """Gather each leg above the shoe: compress the lower leg into folds that end at a hem set by the shoe."""
    frac, gather, n_folds, flare = STACK_LEVELS[level]
    arr = np.array(pants).astype(np.float32)
    h, w = arr.shape[:2]
    a = arr[..., 3] > 128
    out = arr.copy()
    for foot in feet:
        x0 = 0 if foot["x0"] < cx else cx
        x1 = cx if foot["x0"] < cx else w
        col = a[:, x0:x1]
        rows = np.nonzero(col.any(axis=1))[0]
        if not len(rows):
            continue
        src_hem = int(rows[-1])
        hem = int(foot["collar"] + frac * (foot["bottom"] - foot["collar"]))
        start = max(hem - gather, int(rows[0]) + 10)
        if src_hem <= hem:
            continue
        # Rows [start, src_hem] of the original leg are squeezed into [start, hem]: the same
        # fabric, folded, not just a shorter leg.
        n_dst = hem - start
        t = np.linspace(0, 1, n_dst)
        # Folds: the source position advances unevenly, so fabric bunches into n_folds ridges.
        warp = t + 0.08 * np.sin(t * np.pi * 2 * n_folds) / (2 * np.pi * n_folds) * n_folds
        src_y = start + np.clip(warp, 0, 1) * (src_hem - start)
        block = np.stack([ndimage.map_coordinates(arr[..., c][:, x0:x1], [src_y[:, None].repeat(x1 - x0, 1),
                          np.arange(x1 - x0)[None, :].repeat(n_dst, 0)], order=1) for c in range(4)], -1)
        # Fold shading: ridges catch light, valleys darken; stronger toward the hem.
        ridge = np.cos(t * np.pi * 2 * n_folds)[:, None]
        depth = (0.4 + 0.6 * t)[:, None]
        block[..., :3] *= (1 + 0.10 * ridge * depth - 0.06 * depth)[..., None]
        # Flare: the stack is a little wider than the leg above it.
        if flare:
            centre = (foot["x0"] + foot["x1"]) / 2 - x0
            grow = 1 + flare * t[:, None]
            xs = np.arange(x1 - x0)[None, :]
            sx = centre + (xs - centre) / grow
            block = np.stack([ndimage.map_coordinates(block[..., c], [np.arange(n_dst)[:, None].repeat(x1 - x0, 1), sx], order=1)
                              for c in range(4)], -1)
        out[start:hem, x0:x1] = block
        out[hem:, x0:x1] = 0
        # Soften the new hem edge.
        out[max(hem - 3, 0):hem, x0:x1, 3] *= np.linspace(1, 0.4, min(3, hem))[:, None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


# --------------------------------------------------------------------------- shoes


def split_shoe(shoes: Image.Image, feet: list[dict]) -> tuple[Image.Image, Image.Image]:
    """Back of each shoe (under the hem) and the toe box (over the hem), with a soft seam."""
    a = alpha(shoes)
    h, w = a.shape
    front = np.zeros_like(a)
    yy = np.arange(h)[:, None]
    for f in feet:
        band = np.clip((yy - f["toe"]) / 18 + 0.5, 0, 1)
        front[:, f["x0"] : f["x1"] + 1] = np.maximum(front[:, f["x0"] : f["x1"] + 1], band)
    rgba = np.array(shoes)
    back = rgba.copy()
    toe = rgba.copy()
    toe[..., 3] = (a * front * 255).astype(np.uint8)
    return Image.fromarray(back, "RGBA"), Image.fromarray(toe, "RGBA")


def hem_shadow(pants: Image.Image) -> Image.Image:
    """Soft contact shadow the hem casts on the shoe."""
    a = Image.fromarray((alpha(pants) * 255).astype(np.uint8))
    sh = Image.new("RGBA", pants.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * 0.45)).filter(ImageFilter.GaussianBlur(7)))
    out = Image.new("RGBA", pants.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 6))
    return out


def compose(plate: Image.Image, shoes=None, pants=None, shirt=None, feet=None) -> Image.Image:
    """Layer order with occlusion: shoe back, pants (+ hem shadow), shoe toes, shirt."""
    frame = plate.convert("RGBA").copy()
    toe = None
    if shoes is not None:
        back, toe = split_shoe(shoes, feet) if feet else (shoes, None)
        frame.alpha_composite(back)
    if pants is not None:
        frame.alpha_composite(hem_shadow(pants))
        frame.alpha_composite(pants)
    if toe is not None and pants is not None:
        frame.alpha_composite(toe)
    if shirt is not None:
        if pants is not None:
            # Contact shadow: the hem and lower body shade the pants just below where they rest.
            sh = Image.fromarray((alpha(shirt) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9))
            shade = Image.new("RGBA", shirt.size, (0, 0, 0, 0))
            shade.putalpha(Image.fromarray((np.array(sh).astype(np.float32) * 0.38 * alpha(pants)).astype(np.uint8)))
            moved = Image.new("RGBA", shirt.size, (0, 0, 0, 0))
            moved.alpha_composite(shade, (0, 9))
            frame.alpha_composite(moved)
        frame.alpha_composite(shirt)
    return frame


def rest_check(shirt: Image.Image, pants: Image.Image) -> dict:
    """Does the shirt rest over this pants' waistband? Overlap of hem below the waistband top, per column.

    min_overlap_px < 0 means a gap (the shirt floats above the waistband and the mannequin shows).
    """
    s, p = alpha(shirt) > 0.5, alpha(pants) > 0.5
    cols = np.nonzero(p.any(axis=0))[0]
    p_top = {x: int(p[:, x].argmax()) for x in cols}
    # Waistband columns: where the pants start within 60 px of their highest point (not the legs).
    top = int(np.percentile(list(p_top.values()), 5))  # robust to a stray speck above the waistband
    waist_cols = [x for x in cols if p_top[x] < top + 60]
    overlaps = []
    for x in waist_cols:
        ys = np.nonzero(s[:, x])[0]
        if len(ys):
            overlaps.append(int(ys[-1]) - p_top[x])
    ov = np.array(overlaps) if overlaps else np.array([0])
    return {"waist_cols": len(waist_cols), "covered_cols": int((ov > 0).sum()), "min_overlap_px": int(ov.min()), "median_overlap_px": int(np.median(ov))}
