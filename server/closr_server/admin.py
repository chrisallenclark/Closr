"""Operator commands (run on the server, never shipped in the app).

  python -m closr_server.admin install-mannequin --from <dir>
      copies canonical.png, plate.png, ref-trousers.png and landmarks.json into shared storage
  python -m closr_server.admin build-replay --spec <json>
      records already-paid model outputs as replay fixtures, keyed by the photo's fingerprint
  python -m closr_server.admin restore-backup --from <dir>
      rebuilds the mannequin and replay fixtures from the private backup (files named as in
      closr-backup-index.json, plus closr-replay-bundle.json)
  python -m closr_server.admin reprocess --job <id>
      prepares a job again from its stored render (no new render is paid for)
  python -m closr_server.admin export --to <dir> | import --from <dir> [--force]
      full backup (database + every stored file) and restore, on any backend (closr_server/backup.py)
  python -m closr_server.admin spend
      prints spend per model, per user, and cost per usable asset from the ledger
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

from .config import Config
from .db import connect


def storage_for(cfg: Config):
    from .storage import S3Storage, Storage

    return S3Storage(cfg.s3_bucket, cfg.s3_endpoint) if cfg.s3_bucket else Storage(cfg.storage_dir)


def install_mannequin(cfg: Config, src: Path) -> None:
    """Into the configured storage: the private bucket in production, local disk in development."""
    import io

    store = storage_for(cfg)
    prefix = f"shared/mannequins/{cfg.mannequin_id}/"
    for name in ("canonical.png", "plate.png", "ref-trousers.png", "landmarks.json"):
        store.put_bytes(prefix + name, (src / name).read_bytes())
    plate = Image.open(src / "plate.png").convert("RGB").resize((540, 960), Image.LANCZOS)
    buf = io.BytesIO()
    plate.save(buf, "WEBP", quality=88)
    store.put_bytes(prefix + "plate-display.webp", buf.getvalue())
    where = f"s3://{cfg.s3_bucket}/{prefix}" if cfg.s3_bucket else str(cfg.storage_dir / prefix)
    print(f"installed mannequin {cfg.mannequin_id} into {where}")


def build_replay(cfg: Config, spec_path: Path) -> None:
    """spec: [{photo, analyze: json path, renders: {purpose: png path}, verify: {purpose: json path}}]"""
    spec = json.loads(spec_path.read_text())
    for entry in spec:
        from PIL import ImageOps

        from .models import perceptual_hash

        sha = perceptual_hash(ImageOps.exif_transpose(Image.open(entry["photo"])).convert("RGB"))
        d = cfg.replay_dir / sha
        d.mkdir(parents=True, exist_ok=True)
        if entry.get("analyze"):
            shutil.copyfile(entry["analyze"], d / "analyze.json")
        for purpose, path in entry.get("renders", {}).items():
            Image.open(path).convert("RGB").save(d / f"{purpose.replace(':', '--')}.png")
        for purpose, path in entry.get("verify", {}).items():
            (d / f"{purpose.replace(':', '--')}.json").write_text(Path(path).read_text() if Path(path).exists() else json.dumps(path))
        print(f"{Path(entry['photo']).name}: {sha[:12]} -> {sorted(p.name for p in d.iterdir())}")


def restore_backup(cfg: Config, src: Path, mannequin_only: bool = False) -> None:
    """Mannequin + replay fixtures from the backup: images are lossless, so renders come back exact."""
    import tempfile

    index = json.loads((src / "closr-backup-index.json").read_text())
    bundle = json.loads((src / "closr-replay-bundle.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for name, backup in (("canonical.png", "mannequin-v3-canonical.webp"), ("plate.png", "mannequin-v3-plate.webp"),
                             ("ref-trousers.png", "mannequin-v3-ref-trousers-base.webp")):
            Image.open(src / backup).save(t / name)
        (t / "landmarks.json").write_text(json.dumps(bundle["landmarks"], indent=1))
        install_mannequin(cfg, t)
    if mannequin_only:  # production needs only the mannequin (5 files: index, bundle, 3 images)
        return
    for rel, entry in bundle["replay"].items():
        dest = cfg.replay_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith(".json"):
            dest.write_text(json.dumps(entry))
        else:
            garment = index["replay_dirs"][rel.split("/")[0]]
            Image.open(src / index["replay_renders_from"][garment]).convert("RGB").save(dest)
    print(f"restored mannequin and {len(bundle['replay'])} replay files into {cfg.replay_dir}")


def spend(cfg: Config) -> None:
    db = connect(cfg.database)
    for r in db.all("SELECT model, COUNT(*) n, ROUND(SUM(COALESCE(cost_usd, reserved_usd)), 4) usd FROM model_calls GROUP BY model"):
        print(dict(r))
    for r in db.all("SELECT user_id, COUNT(*) jobs, SUM(CASE WHEN variant_id IS NOT NULL THEN 1 ELSE 0 END) usable, ROUND(SUM(cost_usd), 4) usd FROM jobs GROUP BY user_id"):
        d = dict(r)
        d["per_usable"] = round(d["usd"] / d["usable"], 4) if d["usable"] else None
        print(d)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("install-mannequin")
    m.add_argument("--from", dest="src", required=True, type=Path)
    r = sub.add_parser("build-replay")
    r.add_argument("--spec", required=True, type=Path)
    rb = sub.add_parser("restore-backup")
    rb.add_argument("--from", dest="src", required=True, type=Path)
    rb.add_argument("--mannequin-only", action="store_true")
    rp = sub.add_parser("reprocess")
    rp.add_argument("--job", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("--to", dest="dest", required=True, type=Path)
    im = sub.add_parser("import")
    im.add_argument("--from", dest="src", required=True, type=Path)
    im.add_argument("--force", action="store_true")
    sub.add_parser("spend")
    args = p.parse_args()
    cfg = Config()
    if args.cmd == "install-mannequin":
        install_mannequin(cfg, args.src)
    elif args.cmd == "build-replay":
        build_replay(cfg, args.spec)
    elif args.cmd in ("export", "import"):
        from . import backup

        db, store = connect(cfg.database), storage_for(cfg)
        out = backup.export(db, store, args.dest) if args.cmd == "export" else backup.restore(db, store, args.src, args.force)
        print(json.dumps(out, indent=1))
    elif args.cmd == "reprocess":
        from .service import Service

        print("new version for review:", Service(cfg).reprocess(args.job))
    elif args.cmd == "restore-backup":
        restore_backup(cfg, args.src, args.mannequin_only)
    else:
        spend(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
