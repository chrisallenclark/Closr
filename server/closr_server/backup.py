"""Portable backup and restore: the whole database plus every stored file, as plain files.

  python -m closr_server.admin export --to <dir>     # db/<table>.jsonl, files/<storage key>, manifest.json
  python -m closr_server.admin import --from <dir>   # into an empty database and storage

Provider-independent on both ends: export from Neon + Tigris and import into another Postgres and
S3-compatible bucket (or SQLite and a disk), so neither host is a lock-in or a single point of loss.
The providers' own safety nets (Neon's point-in-time restore, bucket durability) come first; this
is the copy you keep yourself, and the way to move hosts.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .db import DB

TABLES = ("users", "sessions", "records", "photos", "analyses", "jobs", "variants", "derived",
          "model_calls", "credit_events", "schema_migrations")
SERIAL = ("model_calls", "credit_events")


def export(db: DB, storage, dest: Path) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "db").mkdir(exist_ok=True)
    counts = {}
    for table in TABLES:
        rows = [dict(r) for r in db.all(f"SELECT * FROM {table}")]
        with open(dest / "db" / f"{table}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r, default=str) + "\n")
        counts[table] = len(rows)
    files = storage.keys("")
    for key in files:
        p = dest / "files" / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(storage.get_bytes(key))
    manifest = {"exported_at": time.time(), "rows": counts, "files": len(files)}
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def restore(db: DB, storage, src: Path, force: bool = False) -> dict:
    manifest = json.loads((src / "manifest.json").read_text())
    if not force and db.one("SELECT COUNT(*) AS n FROM users")["n"]:
        raise SystemExit("the target database already has accounts; restore into an empty one (or pass --force)")
    with db.tx():
        for table in TABLES:
            path = src / "db" / f"{table}.jsonl"
            if not path.exists():
                continue
            db.run(f"DELETE FROM {table}")
            for line in path.read_text().splitlines():
                row = json.loads(line)
                cols = list(row)
                db.run(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", *row.values())
    if db.dialect == "postgres":  # explicit ids don't move the sequences on: do it, or new rows would collide
        for table in SERIAL:
            db.run(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)")
    n = 0
    for p in sorted((src / "files").rglob("*")) if (src / "files").exists() else []:
        if p.is_file():
            storage.put_bytes(str(p.relative_to(src / "files")), p.read_bytes())
            n += 1
    return {"rows": manifest["rows"], "files": n}
