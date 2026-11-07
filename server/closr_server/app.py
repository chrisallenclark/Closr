"""HTTP API for the Closr app.

All routes except POST /v1/session need `Authorization: Bearer <device token>`. Every record and
file is scoped to the caller; there is no route that lists or serves another user's data.
"""

from __future__ import annotations

import threading
import time

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import Config
from .service import BadRequest, NotFound, OutOfCredits, RateLimited, Service, SpendLimit

MAX_UPLOAD = 15 * 1024 * 1024


class AnalyzeIn(BaseModel):
    category: str


class JobIn(BaseModel):
    category: str
    corrections: dict | None = None
    styling: dict | None = None
    correctionNote: str | None = None
    # Lets the app ask for a fresh attempt at the same request (e.g. after rejecting a result).
    attempt: str | None = None


class ReviewIn(BaseModel):
    approve: bool


def create_app(cfg: Config | None = None, run_worker: bool = True) -> FastAPI:
    svc = Service(cfg or Config())
    app = FastAPI(title="Closr garment preparation", version="0.1")
    app.state.svc = svc

    def user(authorization: str = Header(default="")) -> str:
        token = authorization.removeprefix("Bearer ").strip()
        uid = svc.user_for_token(token) if token else None
        if not uid:
            raise HTTPException(401, "sign in again")
        return uid

    def guarded(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except NotFound as err:
            raise HTTPException(404, f"{err} not found") from err
        except BadRequest as err:
            raise HTTPException(400, str(err)) from err
        except OutOfCredits as err:
            raise HTTPException(402, str(err)) from err
        except RateLimited as err:
            raise HTTPException(429, str(err)) from err
        except SpendLimit as err:
            raise HTTPException(503, f"Garment preparation is paused: {err}") from err

    @app.post("/v1/session")
    def session():
        return svc.create_session()

    @app.get("/v1/me")
    def me(uid: str = Depends(user)):
        return {"userId": uid, "usage": svc.guard.usage(uid)}

    @app.post("/v1/items/{item_id}/photos")
    async def upload(item_id: str, kind: str = Form("garment"), file: UploadFile = File(...), uid: str = Depends(user)):
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "photo too large")
        return guarded(svc.add_photo, uid, item_id, kind, data)

    @app.delete("/v1/items/{item_id}/photos/worn")
    def delete_worn(item_id: str, uid: str = Depends(user)):
        return {"deleted": guarded(svc.delete_worn_photos, uid, item_id)}

    @app.post("/v1/items/{item_id}/analyze")
    def analyze(item_id: str, body: AnalyzeIn, uid: str = Depends(user)):
        return guarded(svc.analyze, uid, item_id, body.category)

    @app.post("/v1/items/{item_id}/jobs")
    def request_job(item_id: str, body: JobIn, uid: str = Depends(user)):
        return guarded(svc.request_job, uid, item_id, body.category, body.corrections, body.styling, body.correctionNote, body.attempt)

    @app.get("/v1/jobs")
    def jobs(since: float = 0, uid: str = Depends(user)):
        return {"jobs": svc.jobs(uid, since), "serverTime": time.time()}

    @app.get("/v1/jobs/{job_id}")
    def job(job_id: str, uid: str = Depends(user)):
        return guarded(svc.get_job, uid, job_id)

    @app.post("/v1/variants/{variant_id}/review")
    def review(variant_id: str, body: ReviewIn, uid: str = Depends(user)):
        return guarded(svc.review, uid, variant_id, body.approve)

    @app.get("/v1/wardrobe/assets")
    def assets(uid: str = Depends(user)):
        return svc.wardrobe_assets(uid)

    @app.delete("/v1/items/{item_id}")
    def delete_item(item_id: str, uid: str = Depends(user)):
        guarded(svc.delete_item, uid, item_id)
        return {"ok": True}

    @app.get("/v1/files/{key:path}")
    def file(key: str, uid: str = Depends(user)):
        path = guarded(svc.file_for, uid, key)
        # Content-addressed or versioned keys never change, so the app may cache them forever.
        return FileResponse(path, headers={"Cache-Control": "private, max-age=31536000, immutable"})

    if run_worker:
        def loop():
            while True:
                try:
                    if not svc.work_once():
                        time.sleep(1.0)
                except Exception as err:  # keep the worker alive; the job's lease will expire and retry
                    print("worker error:", repr(err), flush=True)
                    time.sleep(2.0)

        threading.Thread(target=loop, name="prep-worker", daemon=True).start()
    return app
