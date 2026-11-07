"""Garment preparation service: sessions, photos, fit readings, jobs, review and assets.

Guarantees
  - one job per (user, item, photo, fit, styling): asking twice returns the existing job
  - a credit is held when a job is queued, charged when it yields a reviewable asset, refunded on failure
  - jobs survive restarts: a worker leases a job; an expired lease puts it back in the queue
  - automatic retries stop at `max_attempts`; a photo that can't be prepared reliably fails with a
    request for another photo instead of producing an inaccurate asset
  - model calls only happen in `analyze` (cached per photo set) and in the worker
"""

from __future__ import annotations

import hashlib
import io
import json
import secrets
import uuid
from pathlib import Path

from PIL import Image, ImageOps

from . import pipeline
from .config import Config
from .costs import CostGuard, OutOfCredits, RateLimited, SpendLimit
from .db import DB, dumps, loads, now
from .models import ModelError, make_client, perceptual_hash
from .storage import Storage

CATEGORIES = ("top", "outerwear", "bottom", "shoes")
LEASE_SECONDS = 600
DISPLAY_SCALE = 0.5


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _id() -> str:
    return uuid.uuid4().hex


class Service:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.db = DB(cfg.db_path)
        self.storage = Storage(cfg.storage_dir)
        self.guard = CostGuard(self.db, cfg)
        self.client = make_client(cfg, self.guard)
        self._mannequin: pipeline.Mannequin | None = None

    # -- mannequin ------------------------------------------------------------------------------

    @property
    def mannequin_prefix(self) -> str:
        return f"shared/mannequins/{self.cfg.mannequin_id}/"

    def mannequin(self) -> pipeline.Mannequin:
        if self._mannequin is None:
            self._mannequin = pipeline.Mannequin.load(self.storage.path(self.mannequin_prefix))
        return self._mannequin

    def mannequin_info(self) -> dict:
        lm = json.loads(self.storage.get_bytes(self.mannequin_prefix + "landmarks.json"))
        return {"id": self.cfg.mannequin_id, "canvas": [1080, 1920], "displayScale": DISPLAY_SCALE,
                "plate": self.mannequin_prefix + "plate-display.webp", "landmarks": lm}

    # -- sessions -------------------------------------------------------------------------------

    def create_session(self) -> dict:
        """An anonymous device account. The raw token is returned once; only its hash is stored."""
        token = secrets.token_urlsafe(32)
        user_id = _id()
        self.db.run("INSERT INTO users (id, token_hash, credits, created_at) VALUES (?, ?, ?, ?)",
                    user_id, _sha(token.encode()), self.cfg.limits.starting_credits, now())
        self.db.run("INSERT INTO credit_events (user_id, delta, reason, created_at) VALUES (?, ?, 'starting credits', ?)",
                    user_id, self.cfg.limits.starting_credits, now())
        return {"userId": user_id, "token": token}

    def user_for_token(self, token: str) -> str | None:
        row = self.db.one("SELECT id FROM users WHERE token_hash = ?", _sha(token.encode()))
        return row["id"] if row else None

    # -- photos ---------------------------------------------------------------------------------

    def add_photo(self, user_id: str, item_id: str, kind: str, data: bytes) -> dict:
        if kind not in ("garment", "worn"):
            raise BadRequest("kind must be garment or worn")
        try:
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        except Exception as err:
            raise BadRequest("not an image") from err
        sha = _sha(data)
        existing = self.db.one("SELECT * FROM photos WHERE user_id = ? AND item_id = ? AND sha256 = ?", user_id, item_id, sha)
        if existing:
            return self._photo_out(existing)
        im.thumbnail((1600, 1600))
        pid = _id()
        key = f"users/{user_id}/items/{item_id}/source/{'worn/' if kind == 'worn' else ''}{sha[:20]}.jpg"
        self.storage.put_image(key, im, quality=88)
        self.db.run("INSERT INTO photos (id, user_id, item_id, kind, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    pid, user_id, item_id, kind, sha, key, now())
        return self._photo_out(self.db.one("SELECT * FROM photos WHERE id = ?", pid))

    def delete_worn_photos(self, user_id: str, item_id: str) -> int:
        rows = self.db.all("SELECT * FROM photos WHERE user_id = ? AND item_id = ? AND kind = 'worn'", user_id, item_id)
        for r in rows:
            path = self.storage.path(r["storage_key"])
            if path.exists():
                path.unlink()
        self.db.run("DELETE FROM photos WHERE user_id = ? AND item_id = ? AND kind = 'worn'", user_id, item_id)
        return len(rows)

    @staticmethod
    def _photo_out(r) -> dict:
        return {"id": r["id"], "itemId": r["item_id"], "kind": r["kind"], "sha256": r["sha256"]}

    def _main_photo(self, user_id: str, item_id: str):
        row = self.db.one("SELECT * FROM photos WHERE user_id = ? AND item_id = ? AND kind = 'garment' ORDER BY created_at DESC LIMIT 1",
                          user_id, item_id)
        if not row:
            raise BadRequest("upload a garment photo first")
        return row

    # -- analysis -------------------------------------------------------------------------------

    def analyze(self, user_id: str, item_id: str, category: str) -> dict:
        if category not in CATEGORIES:
            raise BadRequest(f"category must be one of {CATEGORIES}")
        photo = self._main_photo(user_id, item_id)
        photo_set = f"{category}:{photo['sha256']}"
        cached = self.db.one("SELECT result FROM analyses WHERE user_id = ? AND item_id = ? AND photo_set = ?", user_id, item_id, photo_set)
        if cached:
            return loads(cached["result"])
        if category == "shoes":
            result = {"category": "shoes", "fit": {}, "ask": [], "defaultDrape": None, "needsAnotherPhoto": None, "observed": {}}
        else:
            self.guard.check_rate(user_id, "analyze")
            image = self.storage.get_image(photo["storage_key"]).convert("RGB")
            ctx = pipeline.Ctx(self.client, user_id, None, perceptual_hash(image))
            result = pipeline.analyze(image, category, ctx)
        self.db.run("INSERT OR REPLACE INTO analyses (id, user_id, item_id, photo_set, result, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    _id(), user_id, item_id, photo_set, dumps(result), now())
        return result

    # -- jobs -----------------------------------------------------------------------------------

    def request_job(self, user_id: str, item_id: str, category: str, corrections: dict | None = None,
                    styling: dict | None = None, correction_note: str | None = None, nonce: str | None = None) -> dict:
        """Queue a preparation (or return the identical one already queued or done)."""
        if category not in CATEGORIES:
            raise BadRequest(f"category must be one of {CATEGORIES}")
        photo = self._main_photo(user_id, item_id)
        analysis = self.db.one("SELECT result FROM analyses WHERE user_id = ? AND item_id = ? AND photo_set = ?",
                               user_id, item_id, f"{category}:{photo['sha256']}")
        if not analysis:
            raise BadRequest("analyze the photo first")
        analysis = loads(analysis["result"])
        if analysis.get("needsAnotherPhoto") and not (corrections or {}).get("acceptPhoto"):
            raise BadRequest("this photo needs to be retaken: " + analysis["needsAnotherPhoto"])
        styling = styling or {}
        observed = pipeline.apply_corrections(analysis.get("observed", {}), category, corrections or {})
        request: dict = {"observed": observed}
        if category in ("top", "outerwear"):
            request["drape"] = styling.get("drape") or pipeline.default_drape(observed)
            request["closure"] = styling.get("closure")
            variant_key = f"drape={request['drape']}" + (f";closure={request['closure']}" if request["closure"] else "")
        elif category == "bottom":
            request["override"] = {k: v for k, v in {"leg_shape": (corrections or {}).get("legShape")}.items() if v}
            variant_key = "legs=follow"
        else:
            variant_key = "pair"
        if correction_note:
            request["correction"] = correction_note[:300]
        idem = _sha(dumps([user_id, item_id, category, variant_key, photo["sha256"], corrections or {}, correction_note or "", nonce or ""]).encode())

        existing = self.db.one("SELECT * FROM jobs WHERE idem_key = ?", idem)
        if existing:
            return self.job_out(existing)
        extra = self.db.one("SELECT COUNT(DISTINCT variant_key) AS n FROM variants WHERE user_id = ? AND item_id = ? AND variant_key != ?",
                            user_id, item_id, variant_key)["n"]
        if extra > self.cfg.limits.extra_variants_per_item:
            raise BadRequest("this garment already has the maximum number of styles")
        self.guard.check_rate(user_id, "job")
        job_id = _id()
        self.guard.hold_credit(user_id, job_id)
        t = now()
        try:
            self.db.run(
                "INSERT INTO jobs (id, user_id, item_id, category, variant_key, request, idem_key, state, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)",
                job_id, user_id, item_id, category, variant_key, dumps(request), idem, t, t)
        except Exception:
            self.guard.refund_credit(user_id, job_id, "duplicate request")
            existing = self.db.one("SELECT * FROM jobs WHERE idem_key = ?", idem)
            if existing:
                return self.job_out(existing)
            raise
        return self.job_out(self.db.one("SELECT * FROM jobs WHERE id = ?", job_id))

    def job_out(self, r) -> dict:
        out = {"id": r["id"], "itemId": r["item_id"], "category": r["category"], "variantKey": r["variant_key"], "state": r["state"],
               "attempts": r["attempts"], "message": r["message"], "variantId": r["variant_id"], "updatedAt": r["updated_at"]}
        if r["variant_id"]:
            out["variant"] = self.variant_out(self.db.one("SELECT * FROM variants WHERE id = ?", r["variant_id"]))
        return out

    def jobs(self, user_id: str, since: float = 0) -> list[dict]:
        return [self.job_out(r) for r in self.db.all("SELECT * FROM jobs WHERE user_id = ? AND updated_at > ? ORDER BY updated_at", user_id, since)]

    def get_job(self, user_id: str, job_id: str) -> dict:
        r = self.db.one("SELECT * FROM jobs WHERE id = ? AND user_id = ?", job_id, user_id)
        if not r:
            raise NotFound("job")
        return self.job_out(r)

    # -- worker ---------------------------------------------------------------------------------

    def claim(self) -> dict | None:
        """Lease the oldest waiting job (or one whose worker died)."""
        t = now()
        with self.db.tx():
            r = self.db.one("SELECT * FROM jobs WHERE state = 'waiting' OR (state = 'preparing' AND lease_until < ?) ORDER BY created_at LIMIT 1", t)
            if not r:
                return None
            self.db.run("UPDATE jobs SET state = 'preparing', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ?",
                        t + LEASE_SECONDS, t, r["id"])
            return dict(self.db.one("SELECT * FROM jobs WHERE id = ?", r["id"]))

    def _job_cost(self, job_id: str) -> float:
        return float(self.db.one("SELECT COALESCE(SUM(COALESCE(cost_usd, reserved_usd)), 0) AS s FROM model_calls WHERE job_id = ?", job_id)["s"])

    def run_job(self, job: dict) -> None:
        user_id, job_id = job["user_id"], job["id"]
        req = loads(job["request"])
        photo = self._main_photo(user_id, job["item_id"])
        image = self.storage.get_image(photo["storage_key"]).convert("RGB")
        ctx = pipeline.Ctx(self.client, user_id, job_id, perceptual_hash(image))

        def finish(state: str, message: str | None = None, variant_id: str | None = None):
            self.db.run("UPDATE jobs SET state = ?, message = ?, variant_id = ?, cost_usd = ?, lease_until = NULL, updated_at = ? WHERE id = ?",
                        state, message, variant_id, round(self._job_cost(job_id), 4), now(), job_id)

        try:
            prepared = pipeline.PREPARERS[job["category"]](image, req["observed"], req, self.mannequin(), ctx)
        except pipeline.NeedsPhoto as err:
            self.guard.refund_credit(user_id, job_id, "needs another photo")
            return finish("failed", f"Please add a clearer photo: {err}")
        except (pipeline.Unusable, ModelError) as err:
            if job["attempts"] < self.cfg.limits.max_attempts:
                return finish("waiting", f"Retrying: {err}")
            self.guard.refund_credit(user_id, job_id, "attempts used up")
            return finish("failed", f"Couldn't prepare an accurate version: {err}. Try a flatter, well-lit photo.")
        except SpendLimit as err:
            self.guard.refund_credit(user_id, job_id, "spend limit")
            return finish("failed", f"Paused: {err}.")
        variant_id = self._store_variant(user_id, job, prepared)
        finish("ready_for_review", None, variant_id)

    def work_once(self) -> bool:
        job = self.claim()
        if not job:
            return False
        self.run_job(job)
        return True

    # -- variants -------------------------------------------------------------------------------

    def _store_variant(self, user_id: str, job: dict, prepared: pipeline.Prepared) -> str:
        item_id, key = job["item_id"], job["variant_key"]
        version = 1 + (self.db.one("SELECT COALESCE(MAX(version), 0) AS v FROM variants WHERE user_id = ? AND item_id = ? AND variant_key = ?",
                                   user_id, item_id, key)["v"])
        vid = _id()
        base = f"users/{user_id}/items/{item_id}/variants/{key.replace(';', '_')}/v{version}/"
        layer = prepared.layer
        bbox = layer.getbbox()
        crop = layer.crop(bbox)
        self.storage.put_image(base + "master.webp", crop, lossless=True)
        small = crop.resize((max(1, round(crop.width * DISPLAY_SCALE)), max(1, round(crop.height * DISPLAY_SCALE))), Image.LANCZOS)
        self.storage.put_image(base + "display.webp", small, quality=86)
        styling = dict(prepared.styling)
        if job["category"] == "shoes":
            back, toe = pipeline.split_shoe(layer, styling["feet"])
            for name, im in (("back", back), ("toe", toe)):
                b = im.getbbox()
                c = im.crop(b)
                k = base + f"{name}.webp"
                self.storage.put_image(k, c.resize((max(1, round(c.width * DISPLAY_SCALE)), max(1, round(c.height * DISPLAY_SCALE))), Image.LANCZOS), quality=86)
                styling[name] = {"key": k, "x": b[0], "y": b[1], "w": c.width, "h": c.height}
        self.db.run(
            "INSERT INTO variants (id, user_id, item_id, category, variant_key, version, status, mannequin_id, master_key, display_key, placement, "
            "styling, checks, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?, ?)",
            vid, user_id, item_id, job["category"], key, version, self.cfg.mannequin_id, base + "master.webp", base + "display.webp",
            dumps({"x": bbox[0], "y": bbox[1], "w": crop.width, "h": crop.height}), dumps(styling), dumps(prepared.checks), job["id"], now())
        return vid

    def variant_out(self, r) -> dict:
        return {"id": r["id"], "itemId": r["item_id"], "category": r["category"], "key": r["variant_key"], "version": r["version"],
                "status": r["status"], "mannequinId": r["mannequin_id"], "display": r["display_key"], "master": r["master_key"],
                "placement": loads(r["placement"]), "styling": loads(r["styling"]), "checks": loads(r["checks"]),
                "displayScale": DISPLAY_SCALE}

    def review(self, user_id: str, variant_id: str, approve: bool) -> dict:
        r = self.db.one("SELECT * FROM variants WHERE id = ? AND user_id = ?", variant_id, user_id)
        if not r:
            raise NotFound("variant")
        t = now()
        with self.db.tx():
            if approve:
                self.db.run("UPDATE variants SET status = 'superseded' WHERE user_id = ? AND item_id = ? AND variant_key = ? AND status = 'approved'",
                            user_id, r["item_id"], r["variant_key"])
            self.db.run("UPDATE variants SET status = ?, reviewed_at = ? WHERE id = ?", "approved" if approve else "rejected", t, variant_id)
            if r["job_id"]:
                self.db.run("UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?", "approved" if approve else "rejected", t, r["job_id"])
        if approve and r["category"] in ("bottom", "shoes"):
            self._derive_for(user_id, variant_id)
        return self.variant_out(self.db.one("SELECT * FROM variants WHERE id = ?", variant_id))

    def _derive_for(self, user_id: str, variant_id: str) -> None:
        """Stack every approved pants against every approved shoe the user has (free, deterministic)."""
        v = self.db.one("SELECT * FROM variants WHERE id = ?", variant_id)
        other = "shoes" if v["category"] == "bottom" else "bottom"
        partners = self.db.all("SELECT * FROM variants WHERE user_id = ? AND category = ? AND status = 'approved'", user_id, other)
        for p in partners:
            pants, shoes = (v, p) if v["category"] == "bottom" else (p, v)
            self._derive_pair(user_id, pants, shoes)

    def _full_layer(self, row) -> Image.Image:
        place = loads(row["placement"])
        frame = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
        frame.alpha_composite(self.storage.get_image(row["master_key"]).convert("RGBA"), (place["x"], place["y"]))
        return frame

    def _derive_pair(self, user_id: str, pants, shoes) -> None:
        feet = loads(shoes["styling"])["feet"]
        stacks = pipeline.derive_stacks(self._full_layer(pants), self._full_layer(shoes), feet, self.mannequin().landmarks["cx"])
        for lvl, im in stacks.items():
            b = im.getbbox()
            c = im.crop(b)
            key = f"users/{user_id}/derived/{pants['id']}/{shoes['id']}/{lvl}.webp"
            self.storage.put_image(key, c.resize((max(1, round(c.width * DISPLAY_SCALE)), max(1, round(c.height * DISPLAY_SCALE))), Image.LANCZOS), quality=86)
            self.db.run("INSERT OR REPLACE INTO derived (user_id, pants_variant_id, shoes_variant_id, stacking, display_key, placement) VALUES (?, ?, ?, ?, ?, ?)",
                        user_id, pants["id"], shoes["id"], lvl, key, dumps({"x": b[0], "y": b[1], "w": c.width, "h": c.height}))

    def wardrobe_assets(self, user_id: str) -> dict:
        """Everything Build Outfit needs, in one call the app caches: approved layers and stacked pairs."""
        variants = [self.variant_out(r) for r in self.db.all(
            "SELECT * FROM variants WHERE user_id = ? AND status = 'approved' ORDER BY created_at", user_id)]
        derived = [{"pantsVariantId": r["pants_variant_id"], "shoesVariantId": r["shoes_variant_id"], "stacking": r["stacking"],
                    "display": r["display_key"], "placement": loads(r["placement"])}
                   for r in self.db.all("SELECT * FROM derived WHERE user_id = ?", user_id)]
        return {"mannequin": self.mannequin_info(), "variants": variants, "derived": derived}

    def delete_item(self, user_id: str, item_id: str) -> None:
        """Removes every photo, asset and record for one garment."""
        self.storage.delete_prefix(f"users/{user_id}/items/{item_id}/")
        vids = [r["id"] for r in self.db.all("SELECT id FROM variants WHERE user_id = ? AND item_id = ?", user_id, item_id)]
        for vid in vids:
            for r in self.db.all("SELECT display_key FROM derived WHERE pants_variant_id = ? OR shoes_variant_id = ?", vid, vid):
                path = self.storage.path(r["display_key"])
                if path.exists():
                    path.unlink()
            self.db.run("DELETE FROM derived WHERE pants_variant_id = ? OR shoes_variant_id = ?", vid, vid)
        for table in ("photos", "analyses", "variants"):
            self.db.run(f"DELETE FROM {table} WHERE user_id = ? AND item_id = ?", user_id, item_id)
        self.db.run("UPDATE jobs SET state = 'failed', message = 'garment deleted' WHERE user_id = ? AND item_id = ? AND state IN ('waiting', 'preparing')",
                    user_id, item_id)

    def file_for(self, user_id: str, key: str) -> Path:
        if not self.storage.readable_by(key, user_id) or not self.storage.exists(key):
            raise NotFound("file")
        return self.storage.path(key)


__all__ = ["Service", "NotFound", "BadRequest", "OutOfCredits", "RateLimited", "SpendLimit"]
