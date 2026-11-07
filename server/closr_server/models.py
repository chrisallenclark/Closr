"""Image and vision model clients behind the cost guard.

`GeminiClient` is the only code that holds the API key; it runs on the server only. `ReplayClient`
serves recorded outputs (renders and readings already paid for during the prototype) keyed by the
source photo's fingerprint and the purpose of the call, so the whole pipeline can be exercised end
to end without spending. Both go through the same ledger.
"""

from __future__ import annotations

import base64
import io
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

from .config import Config
from .costs import CostGuard

CANVAS = (1080, 1920)


class ModelError(RuntimeError):
    pass


def perceptual_hash(img: Image.Image, size: int = 16) -> str:
    """Difference hash: stable across re-encoding and resizing, so a re-saved photo still matches."""
    import numpy as np

    g = np.asarray(img.convert("L").resize((size + 1, size), Image.LANCZOS), dtype=np.int16)
    bits = 0
    for b in (g[:, :-1] > g[:, 1:]).flatten():
        bits = (bits << 1) | int(b)
    return f"{bits:0{size * size // 4}x}"


def hash_distance(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def jpeg_part(img: Image.Image, max_side: int = 1536) -> dict:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}


class ModelClient:
    """Common interface: `image()` returns a 9:16 render, `vision()` returns parsed JSON."""

    def __init__(self, cfg: Config, guard: CostGuard):
        self.cfg, self.guard = cfg, guard

    def image(self, *, user_id: str, job_id: str | None, purpose: str, fingerprint: str, parts: list[dict]) -> Image.Image:
        raise NotImplementedError

    def vision(self, *, user_id: str, job_id: str | None, purpose: str, fingerprint: str, parts: list[dict]) -> dict:
        raise NotImplementedError


class GeminiClient(ModelClient):
    def _post(self, model: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.cfg.gemini_key()},
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            raise ModelError(f"model error {err.code}") from err

    def image(self, *, user_id, job_id, purpose, fingerprint, parts):
        model = self.cfg.render_model
        call = self.guard.reserve(user_id, job_id, purpose, model)
        data, ok = {}, False
        try:
            config = {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16", "imageSize": "2K"}}
            data = self._post(model, {"contents": [{"parts": parts}], "generationConfig": config})
            for cand in data.get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    blob = part.get("inline_data") or part.get("inlineData")
                    if blob:
                        ok = True
                        return Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB").resize(CANVAS, Image.LANCZOS)
            raise ModelError("no image returned")
        finally:
            self.guard.settle(call, model, data.get("usageMetadata"), ok)

    def vision(self, *, user_id, job_id, purpose, fingerprint, parts):
        model = self.cfg.vision_model
        call = self.guard.reserve(user_id, job_id, purpose, model)
        data, ok = {}, False
        try:
            data = self._post(model, {"contents": [{"parts": parts}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0}})
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            out = json.loads(text[text.find("{"): text.rfind("}") + 1])
            ok = True
            return out
        finally:
            self.guard.settle(call, model, data.get("usageMetadata"), ok)


class ReplayClient(ModelClient):
    """Serves `<replay_dir>/<perceptual hash>/<purpose>.png|json` for the nearest recorded photo.

    Missing recordings fail like a model error.
    """

    MAX_DISTANCE = 24  # of 256 bits: same garment photo, re-encoded or resized

    def _file(self, fingerprint: str, purpose: str, ext: str) -> Path:
        dirs = [d for d in self.cfg.replay_dir.iterdir() if d.is_dir()] if self.cfg.replay_dir.exists() else []
        best = min(dirs, key=lambda d: hash_distance(d.name, fingerprint), default=None)
        if best is None or hash_distance(best.name, fingerprint) > self.MAX_DISTANCE:
            return self.cfg.replay_dir / "_none" / "missing"
        return best / f"{purpose.replace(':', '--')}.{ext}"

    def image(self, *, user_id, job_id, purpose, fingerprint, parts):
        call = self.guard.reserve(user_id, job_id, purpose, "replay")
        p = self._file(fingerprint, purpose, "png")
        ok = p.exists()
        self.guard.settle(call, "replay", None, ok)
        if not ok:
            raise ModelError(f"no recorded render for {purpose}")
        time.sleep(0.2)  # keep the asynchronous flow honest in tests
        return Image.open(p).convert("RGB").resize(CANVAS, Image.LANCZOS)

    def vision(self, *, user_id, job_id, purpose, fingerprint, parts):
        call = self.guard.reserve(user_id, job_id, purpose, "replay")
        p = self._file(fingerprint, purpose, "json")
        ok = p.exists()
        self.guard.settle(call, "replay", None, ok)
        if not ok:
            raise ModelError(f"no recorded reading for {purpose}")
        return json.loads(p.read_text())


def make_client(cfg: Config, guard: CostGuard) -> ModelClient:
    if cfg.provider == "gemini":
        return GeminiClient(cfg, guard)
    if cfg.provider == "replay":
        return ReplayClient(cfg, guard)
    raise ValueError(f"unknown model provider {cfg.provider!r}")
