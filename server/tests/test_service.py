"""Backend tests. Unit tests need nothing private; the end-to-end test runs only when replay
fixtures and the mannequin are available (CLOSR_TEST_DATA_DIR + CLOSR_TEST_REPLAY_DIR + CLOSR_TEST_PHOTOS)."""

from __future__ import annotations

import io
import os
import time
from pathlib import Path

import pytest
from PIL import Image

from closr_server import pipeline
from closr_server.config import Config, Limits
from closr_server.costs import OutOfCredits, RateLimited, SpendLimit
from closr_server.db import dumps, now
from closr_server.service import BadRequest, NotFound, Service


def photo_bytes(color=(120, 90, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 600), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def svc(tmp_path, monkeypatch, backend):
    cfg = Config(data_dir=tmp_path, provider="replay", replay_dir=tmp_path / "replay", **backend,
                 limits=Limits(starting_credits=3, jobs_per_hour=5, max_attempts=2, global_daily_usd=1.0, user_daily_usd=0.5))
    s = Service(cfg)
    monkeypatch.setattr(s, "mannequin", lambda: None)
    return s


def seed_analysis(svc: Service, uid: str, item: str, category: str = "top"):
    p = svc.add_photo(uid, item, "garment", photo_bytes())
    result = {"category": category, "fit": {}, "ask": [], "needsAnotherPhoto": None,
              "observed": {"construction": "crew-neck t-shirt", "attributes": {"fit": {"value": "oversized", "confidence": 0.9}}}}
    svc.db.run("INSERT INTO analyses (id, user_id, item_id, photo_set, result, created_at) VALUES (?, ?, ?, ?, ?, ?)",
               item + "a", uid, item, f"{category}:{p['sha256']}", dumps(result), now())


def ok_preparer(photo, observed, request, mq, ctx):
    layer = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
    layer.paste((200, 190, 170, 255), (300, 350, 800, 1000))
    return pipeline.Prepared(layer, {"drape": request.get("drape")}, {"framing": {"ok": True}})


def test_spend_caps_block_before_the_call(svc):
    svc.guard.reserve("u1", None, "render", "gemini-3-pro-image")  # 0.30 reserved
    with pytest.raises(SpendLimit):
        svc.guard.reserve("u1", None, "render", "gemini-3-pro-image")  # would pass the 0.50 user cap
    svc.guard.reserve("u2", None, "render", "gemini-3-pro-image")
    svc.guard.reserve("u3", None, "render", "gemini-3-pro-image")
    with pytest.raises(SpendLimit):
        svc.guard.reserve("u4", None, "render", "gemini-3-pro-image")  # would pass the 1.00 global cap


def test_settled_cost_replaces_the_reservation(svc):
    call = svc.guard.reserve("u1", None, "render", "gemini-3-pro-image")
    usd = svc.guard.settle(call, "gemini-3-pro-image", {"promptTokenCount": 1000, "candidatesTokenCount": 1290}, True)
    assert abs(usd - (0.002 + 0.1548)) < 1e-6
    svc.guard.reserve("u1", None, "render", "gemini-3-pro-image")  # 0.157 + 0.30 fits under 0.50 now


def test_job_is_idempotent_and_holds_one_credit(svc, monkeypatch):
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    a = svc.request_job(uid, "tee", "top")
    b = svc.request_job(uid, "tee", "top")
    assert a["id"] == b["id"] and a["state"] == "waiting"
    assert svc.guard.usage(uid)["credits"] == 2


def test_successful_job_reaches_review_and_approval(svc, monkeypatch):
    monkeypatch.setitem(pipeline.PREPARERS, "top", ok_preparer)
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    job = svc.request_job(uid, "tee", "top")
    assert svc.work_once()
    done = svc.get_job(uid, job["id"])
    assert done["state"] == "ready_for_review" and done["variant"]["status"] == "needs_review"
    v = svc.review(uid, done["variantId"], approve=True)
    assert v["status"] == "approved"
    assert svc.get_job(uid, job["id"])["state"] == "approved"
    assert svc.guard.usage(uid)["credits"] == 2  # charged, not refunded


def test_failed_attempts_stop_and_refund(svc, monkeypatch):
    def bad(*_):
        raise pipeline.Unusable("print changed")

    monkeypatch.setitem(pipeline.PREPARERS, "top", bad)
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    job = svc.request_job(uid, "tee", "top")
    assert svc.work_once() and svc.get_job(uid, job["id"])["state"] == "waiting"  # one automatic retry
    assert svc.work_once() and svc.get_job(uid, job["id"])["state"] == "failed"
    assert not svc.work_once()  # nothing left to run: no endless retries
    assert svc.guard.usage(uid)["credits"] == 3  # refunded


def test_jobs_survive_a_crashed_worker(svc, monkeypatch):
    monkeypatch.setitem(pipeline.PREPARERS, "top", ok_preparer)
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    job = svc.request_job(uid, "tee", "top")
    claimed = svc.claim()  # worker takes it, then "crashes"
    assert claimed and claimed["id"] == job["id"]
    assert svc.claim() is None  # leased: nobody else runs it meanwhile
    svc.db.run("UPDATE jobs SET lease_until = ? WHERE id = ?", time.time() - 1, job["id"])
    restarted = Service(svc.cfg)  # a new process with the same database
    restarted.mannequin = lambda: None
    assert restarted.work_once()
    assert restarted.get_job(uid, job["id"])["state"] == "ready_for_review"


def test_credits_and_rate_limits(svc, monkeypatch):
    uid = svc.create_session()["userId"]
    for i in range(3):
        seed_analysis(svc, uid, f"t{i}")
        svc.request_job(uid, f"t{i}", "top")
    seed_analysis(svc, uid, "t3")
    with pytest.raises(OutOfCredits):
        svc.request_job(uid, "t3", "top")
    svc.db.run("UPDATE users SET credits = 100 WHERE id = ?", uid)
    seed_analysis(svc, uid, "t4")
    svc.request_job(uid, "t4", "top")  # 4th job this hour (the refused one inserted none)
    seed_analysis(svc, uid, "t4b")
    svc.request_job(uid, "t4b", "top")  # 5th job this hour
    seed_analysis(svc, uid, "t5")
    with pytest.raises(RateLimited):
        svc.request_job(uid, "t5", "top")


def test_users_cannot_reach_each_others_data(svc, monkeypatch):
    monkeypatch.setitem(pipeline.PREPARERS, "top", ok_preparer)
    a = svc.create_session()["userId"]
    b = svc.create_session()["userId"]
    seed_analysis(svc, a, "tee")
    job = svc.request_job(a, "tee", "top")
    svc.work_once()
    key = svc.get_job(a, job["id"])["variant"]["display"]
    assert svc.storage.exists(key) and svc.storage.readable_by(key, a)
    assert not svc.storage.readable_by(key, b)
    with pytest.raises(NotFound):
        svc.get_job(b, job["id"])
    with pytest.raises(NotFound):
        svc.review(b, svc.get_job(a, job["id"])["variantId"], True)


def test_job_needs_an_analysis_first(svc):
    uid = svc.create_session()["userId"]
    svc.add_photo(uid, "tee", "garment", photo_bytes())
    with pytest.raises(BadRequest):
        svc.request_job(uid, "tee", "top")


# --------------------------------------------------------------------------- end to end (replay)

E2E = all(os.environ.get(k) for k in ("CLOSR_TEST_DATA_DIR", "CLOSR_TEST_REPLAY_DIR", "CLOSR_TEST_PHOTOS"))


@pytest.mark.skipif(not E2E, reason="needs private replay fixtures")
def test_end_to_end_over_http(tmp_path):
    import shutil

    from fastapi.testclient import TestClient

    from closr_server.app import create_app

    src = Path(os.environ["CLOSR_TEST_DATA_DIR"])
    shutil.copytree(src / "storage" / "shared", tmp_path / "storage" / "shared")
    cfg = Config(data_dir=tmp_path, provider="replay", replay_dir=Path(os.environ["CLOSR_TEST_REPLAY_DIR"]), limits=Limits())
    app = create_app(cfg, run_worker=False)
    svc: Service = app.state.svc
    http = TestClient(app)
    token = http.post("/v1/session").json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    photos = Path(os.environ["CLOSR_TEST_PHOTOS"])

    def prepare(item, filename, category, corrections=None):
        r = http.post(f"/v1/items/{item}/photos", headers=h, files={"file": (filename, (photos / filename).read_bytes(), "image/jpeg")})
        assert r.status_code == 200, r.text
        reading = http.post(f"/v1/items/{item}/analyze", headers=h, json={"category": category}).json()
        job = http.post(f"/v1/items/{item}/jobs", headers=h, json={"category": category, "corrections": corrections}).json()
        again = http.post(f"/v1/items/{item}/jobs", headers=h, json={"category": category, "corrections": corrections}).json()
        assert again["id"] == job["id"]
        while svc.work_once():
            pass
        done = http.get(f"/v1/jobs/{job['id']}", headers=h).json()
        assert done["state"] == "ready_for_review", done
        v = http.post(f"/v1/variants/{done['variantId']}/review", headers=h, json={"approve": True}).json()
        assert v["status"] == "approved"
        return reading, done

    reading, tee = prepare("tee", "stone-tee.jpg", "top", {"width": "boxy"})
    assert tee["variant"]["checks"]["waist"]["exposed"] < 0.03
    _, pants = prepare("pants", "brown-carpenter-pants.jpg", "bottom")
    _, shoes = prepare("shoes", "reebok-classic.jpg", "shoes")
    assets = http.get("/v1/wardrobe/assets", headers=h).json()
    assert len(assets["variants"]) == 3 and len(assets["derived"]) == 4
    assert http.get("/v1/files/" + assets["mannequin"]["plate"], headers=h).status_code == 200
    assert http.get("/v1/files/" + tee["variant"]["display"], headers=h).status_code == 200
    other = {"Authorization": f"Bearer {http.post('/v1/session').json()['token']}"}
    assert http.get("/v1/files/" + tee["variant"]["display"], headers=other).status_code == 404
    signed = http.get("/v1/wardrobe/assets", headers=h).json()["urls"][tee["variant"]["display"]]
    assert http.get(signed).status_code == 200  # signed URL works without the token
    assert http.get(signed.replace("sig=", "sig=0")).status_code == 404
    usage = http.get("/v1/me", headers=h).json()["usage"]
    assert usage["usable_assets"] == 3 and usage["spent_total_usd"] == 0


def test_signed_file_urls_grant_one_file_until_they_expire(svc, monkeypatch):
    if svc.cfg.s3_bucket:
        pytest.skip("bucket files use the bucket's own presigned URLs")
    monkeypatch.setitem(pipeline.PREPARERS, "top", ok_preparer)
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    job = svc.request_job(uid, "tee", "top")
    svc.work_once()
    key = svc.get_job(uid, job["id"])["variant"]["display"]
    url = svc.sign(key)
    q = dict(p.split("=") for p in url.split("?")[1].split("&"))
    assert svc.file_for_signature(key, int(q["exp"]), q["sig"]).exists()
    other = svc.get_job(uid, job["id"])["variant"]["master"]
    with pytest.raises(NotFound):
        svc.file_for_signature(other, int(q["exp"]), q["sig"])  # signature is bound to the key
    with pytest.raises(NotFound):
        svc.file_for_signature(key, int(time.time()) - 10, svc._sig(key, int(time.time()) - 10))  # expired


def test_gemini_client_refuses_before_any_network_call_when_a_cap_is_reached(tmp_path, monkeypatch, backend):
    from closr_server.models import GeminiClient

    cfg = Config(data_dir=tmp_path, provider="gemini", **backend, limits=Limits(global_daily_usd=0.25, user_daily_usd=0.25))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-used")
    s = Service(cfg)
    assert isinstance(s.client, GeminiClient)

    def no_network(*_a, **_k):
        raise AssertionError("the model was called despite the spending cap")

    monkeypatch.setattr(s.client, "_post", no_network)
    with pytest.raises(SpendLimit):
        s.client.image(user_id="u1", job_id=None, purpose="render:top", fingerprint="x", parts=[])  # worst case $0.30 > $0.25
    assert s.db.one("SELECT COUNT(*) AS n FROM model_calls")["n"] == 0  # nothing reserved, nothing spent


def test_thinking_tokens_are_billed(svc):
    call = svc.guard.reserve("u1", None, "render", "gemini-3-pro-image")
    usd = svc.guard.settle(call, "gemini-3-pro-image", {"promptTokenCount": 0, "candidatesTokenCount": 1000, "thoughtsTokenCount": 500}, True)
    assert abs(usd - 1500 * 120 / 1e6) < 1e-9


def test_total_budget_stops_spending_across_days(tmp_path, backend):
    cfg = Config(data_dir=tmp_path, provider="replay", **backend, limits=Limits(global_total_usd=0.50, global_daily_usd=5, user_daily_usd=5))
    s = Service(cfg)
    s.guard.reserve("u1", None, "render", "gemini-3-pro-image")  # 0.30
    s.db.run("UPDATE model_calls SET created_at = created_at - 3 * 86400")  # spent days ago
    with pytest.raises(SpendLimit):
        s.guard.reserve("u1", None, "render", "gemini-3-pro-image")  # 0.60 > 0.50 total, though today is empty


def test_a_restarted_single_worker_resumes_interrupted_jobs_at_once(svc, monkeypatch):
    monkeypatch.setitem(pipeline.PREPARERS, "top", ok_preparer)
    uid = svc.create_session()["userId"]
    seed_analysis(svc, uid, "tee")
    job = svc.request_job(uid, "tee", "top")
    assert svc.claim()["id"] == job["id"]  # the machine stops mid-job (lease still running)
    restarted = Service(svc.cfg)
    restarted.mannequin = lambda: None
    assert restarted.claim() is None  # without recovery it would wait for the lease
    restarted.recover_interrupted()
    assert restarted.work_once()
    done = restarted.get_job(uid, job["id"])
    assert done["state"] == "ready_for_review" and done["attempts"] == 2  # the interruption counted
    assert svc.guard.usage(uid)["credits"] == 2  # still one credit for one garment
