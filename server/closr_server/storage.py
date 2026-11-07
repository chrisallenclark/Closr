"""Private object storage.

Keys are namespaced per user (`users/<user_id>/...`) and only served to that user; shared assets
(the canonical mannequin) live under `shared/`. The local-disk backend is for development; a
private cloud bucket with the same keys replaces it in production (never a public URL).
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image


class Storage:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("bad storage key")
        return p

    def put_bytes(self, key: str, data: bytes) -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(p)  # atomic: a crash never leaves half a file under the real key
        return key

    def put_image(self, key: str, im: Image.Image, **save_kw) -> tuple[str, int]:
        buf = io.BytesIO()
        fmt = "WEBP" if key.endswith(".webp") else "PNG" if key.endswith(".png") else "JPEG"
        im.save(buf, fmt, **save_kw)
        self.put_bytes(key, buf.getvalue())
        return key, buf.tell()

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def get_image(self, key: str) -> Image.Image:
        return Image.open(io.BytesIO(self.get_bytes(key)))

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def path(self, key: str) -> Path:
        return self._path(key)

    def delete_prefix(self, prefix: str) -> int:
        base = self._path(prefix)
        if not base.exists():
            return 0
        n = 0
        for p in sorted(base.rglob("*"), reverse=True):
            if p.is_file():
                p.unlink()
                n += 1
            else:
                p.rmdir()
        base.rmdir() if base.is_dir() else None
        return n

    @staticmethod
    def user_prefix(user_id: str) -> str:
        return f"users/{user_id}/"

    def readable_by(self, key: str, user_id: str) -> bool:
        return key.startswith("shared/") or key.startswith(self.user_prefix(user_id))
