"""Private object storage.

Keys are namespaced per user (`users/<user_id>/...`) and only served to that user; shared assets
(the canonical mannequin) live under `shared/`. The local-disk backend is for development;
`S3Storage`, a private bucket with the same keys, is for production (never a public URL).
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

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def path(self, key: str) -> Path:
        return self._path(key)

    def keys(self, prefix: str) -> list[str]:
        base = self._path(prefix) if prefix else self.root.resolve()  # "" lists everything
        return [str(p.relative_to(self.root.resolve())) for p in base.rglob("*") if p.is_file()] if base.exists() else []

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


class S3Storage(Storage):
    """A private S3-compatible bucket (Tigris, Cloudflare R2, AWS S3). Nothing is ever public: files
    reach the app only through presigned URLs that expire, for keys the API has checked belong to
    the caller. Credentials come from the standard AWS_* environment variables."""

    URL_TTL = 7 * 86400  # the longest a SigV4 presigned URL may live

    def __init__(self, bucket: str, endpoint: str | None = None):
        import boto3
        from botocore.config import Config as BotoConfig

        self.bucket = bucket
        self.s3 = boto3.client("s3", endpoint_url=endpoint or None, config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 5}))

    @staticmethod
    def _check(key: str) -> str:
        if key.startswith("/") or ".." in key.split("/"):
            raise ValueError("bad storage key")
        return key

    def put_bytes(self, key: str, data: bytes) -> str:
        self.s3.put_object(Bucket=self.bucket, Key=self._check(key), Body=data)  # a single PUT is atomic
        return key

    def get_bytes(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=self._check(key))["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.s3.head_object(Bucket=self.bucket, Key=self._check(key))
            return True
        except ClientError:
            return False

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self._check(key))

    def path(self, key: str) -> Path:
        raise NotImplementedError("bucket files are served through presigned URLs")

    def keys(self, prefix: str) -> list[str]:
        out, token = [], None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": self._check(prefix)}
            if token:
                kw["ContinuationToken"] = token
            page = self.s3.list_objects_v2(**kw)
            out += [o["Key"] for o in page.get("Contents", [])]
            if not page.get("IsTruncated"):
                return out
            token = page["NextContinuationToken"]

    def delete_prefix(self, prefix: str) -> int:
        keys = self.keys(prefix)
        for i in range(0, len(keys), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]], "Quiet": True})
        return len(keys)

    def presign(self, key: str, ttl: int = URL_TTL) -> str:
        return self.s3.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": self._check(key)}, ExpiresIn=ttl)

    def download_prefix(self, prefix: str, dest: Path) -> Path:
        for key in self.keys(prefix):
            p = dest / key[len(prefix):]
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.write_bytes(self.get_bytes(key))
        return dest
