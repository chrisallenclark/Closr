"""Persistent, portable store for prepared garment assets.

The prototype scripts write their working files wherever they are run; this module is the format
the real feature keeps. It is a plain directory tree (or the same keys in a cloud bucket), with
JSON metadata beside the images, so it can be synced, backed up and read by the app or a backend.

  store/
    mannequins/<mannequin_id>/                 the canonical body every layer is aligned to
      plate.webp  landmarks.json  manifest.json
    garments/<item_id>/
      item.json                                category, fit spec (with sources and confidences),
                                               user corrections, default variant, variant index
      source/<sha256>.jpg                      original photo(s), downscaled; worn photos go in
                                               source/worn/ and are deletable on their own
      variants/<variant_key>/
        master.webp                            lossless layer on the mannequin canvas (cropped)
        display.webp                           phone-size layer the app draws
        variant.json                           placement on the canvas, styling, checks, status
                                               (needs_review / approved / rejected), provenance
                                               (model, attempts, cost), mannequin id

Variant keys name the styling, never the outfit: tops `drape=natural`, `drape=crisp;closure=open`,
bottoms `legs=follow`. Combinations that depend on two garments (pants hem stacked against a given
shoe) are derived at compose time and only cached, never stored as assets.

Usage:
  python asset_store.py export --store <dir> --spec export.json
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import time
from pathlib import Path

from PIL import Image, ImageOps

DISPLAY_SCALE = 0.5  # 1080x1920 canvas -> 540x960: sharp on a ~330 pt Build Outfit stage at 3x
STATUSES = ("needs_review", "approved", "rejected")


def _webp(im: Image.Image, path: Path, **kw) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", **kw)
    return path.stat().st_size


def put_mannequin(store: Path, mannequin_id: str, plate: Path, landmarks: Path) -> dict:
    d = store / "mannequins" / mannequin_id
    d.mkdir(parents=True, exist_ok=True)
    im = Image.open(plate).convert("RGB")
    size = _webp(im, d / "plate.webp", quality=90)
    shutil.copyfile(landmarks, d / "landmarks.json")
    manifest = {"id": mannequin_id, "canvas": list(im.size), "plate_bytes": size, "created_at": _now()}
    (d / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def put_source(store: Path, item_id: str, photo: Path, worn: bool = False) -> str:
    """Store a source photo once (content-addressed); returns its relative path."""
    im = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    im.thumbnail((1600, 1600))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    digest = hashlib.sha256(buf.getvalue()).hexdigest()[:20]
    rel = Path("garments") / item_id / "source" / ("worn" if worn else "") / f"{digest}.jpg"
    out = store / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        out.write_bytes(buf.getvalue())
    return str(rel)


def put_variant(store: Path, item_id: str, variant_key: str, layer_path: Path, meta: dict) -> dict:
    """Store one prepared layer (full-canvas RGBA) as a cropped master + display copy with placement."""
    layer = Image.open(layer_path).convert("RGBA")
    bbox = layer.getbbox()
    crop = layer.crop(bbox)
    d = store / "garments" / item_id / "variants" / variant_key.replace("/", "_")
    master_bytes = _webp(crop, d / "master.webp", lossless=True)
    small = crop.resize((max(1, round(crop.width * DISPLAY_SCALE)), max(1, round(crop.height * DISPLAY_SCALE))), Image.LANCZOS)
    display_bytes = _webp(small, d / "display.webp", quality=86)
    variant = {
        "key": variant_key,
        "item_id": item_id,
        "canvas": list(layer.size),
        "placement": {"x": bbox[0], "y": bbox[1], "w": crop.width, "h": crop.height},
        "display_scale": DISPLAY_SCALE,
        "bytes": {"master": master_bytes, "display": display_bytes},
        "status": meta.get("status", "needs_review"),
        "created_at": _now(),
        **{k: v for k, v in meta.items() if k != "status"},
    }
    assert variant["status"] in STATUSES
    (d / "variant.json").write_text(json.dumps(variant, indent=1, default=str))
    return variant


def put_item(store: Path, item: dict) -> None:
    d = store / "garments" / item["id"]
    d.mkdir(parents=True, exist_ok=True)
    variants = sorted(p.parent.name for p in (d / "variants").glob("*/variant.json"))
    (d / "item.json").write_text(json.dumps({**item, "variants": variants, "updated_at": _now()}, indent=1, default=str))


def set_status(store: Path, item_id: str, variant_key: str, status: str) -> None:
    """The user's review decision: only approved variants are offered in Build Outfit."""
    assert status in STATUSES
    p = store / "garments" / item_id / "variants" / variant_key / "variant.json"
    v = json.loads(p.read_text())
    v["status"], v["reviewed_at"] = status, _now()
    p.write_text(json.dumps(v, indent=1))


def delete_worn_photos(store: Path, item_id: str) -> int:
    """Remove a garment's worn photos (and nothing else); fit values derived from them are flagged."""
    d = store / "garments" / item_id / "source" / "worn"
    n = len(list(d.glob("*"))) if d.exists() else 0
    shutil.rmtree(d, ignore_errors=True)
    item_path = store / "garments" / item_id / "item.json"
    if item_path.exists():
        item = json.loads(item_path.read_text())
        for a in item.get("fit", {}).values():
            if isinstance(a, dict) and a.get("source") == "worn-photo":
                a.update({"value": None, "source": "deleted", "confidence": 0})
        item_path.write_text(json.dumps(item, indent=1))
    return n


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def cmd_export(args) -> int:
    """Export from a spec file: {mannequin: {...}, items: [{id, category, photo, fit, default, variants: [...]}]}."""
    spec = json.loads(args.spec.read_text())
    m = spec["mannequin"]
    put_mannequin(args.store, m["id"], Path(m["plate"]), Path(m["landmarks"]))
    total = 0
    for item in spec["items"]:
        src = put_source(args.store, item["id"], Path(item["photo"]))
        for v in item["variants"]:
            meta = {k: v[k] for k in v if k not in ("key", "layer")}
            meta["mannequin_id"] = m["id"]
            out = put_variant(args.store, item["id"], v["key"], Path(v["layer"]), meta)
            total += sum(out["bytes"].values())
        put_item(args.store, {k: item[k] for k in item if k not in ("photo", "variants")} | {"sources": [src], "mannequin_id": m["id"]})
    size = sum(p.stat().st_size for p in args.store.rglob("*") if p.is_file())
    print(f"exported {len(spec['items'])} garments to {args.store}: {size // 1024} KB total ({total // 1024} KB of layers)")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("--store", required=True, type=Path)
    e.add_argument("--spec", required=True, type=Path)
    args = p.parse_args()
    return cmd_export(args)


if __name__ == "__main__":
    sys.exit(main())
