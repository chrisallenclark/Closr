"""Accounts, Sign in with Apple, deletion and wardrobe sync (no network: Apple's keys are faked)."""

from __future__ import annotations

import hashlib
import io
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from PIL import Image

from closr_server.config import Config, Limits
from closr_server.service import Service, Unauthorized

BUNDLE = "com.chrisallenclark.closr"


class FakeAppleKeys:
    """Stands in for Apple's JWKS endpoint."""

    def __init__(self):
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def get_signing_key_from_jwt(self, _token):
        return type("K", (), {"key": self.private.public_key()})()

    def token(self, sub="apple-user-1", nonce="n0nce", aud=BUNDLE, iss="https://appleid.apple.com", exp=600, key=None):
        claims = {"iss": iss, "aud": aud, "sub": sub, "iat": int(time.time()), "exp": int(time.time()) + exp,
                  "nonce": hashlib.sha256(nonce.encode()).hexdigest(), "email": "x@privaterelay.appleid.com"}
        return jwt.encode(claims, key or self.private, algorithm="RS256")


@pytest.fixture
def apple():
    return FakeAppleKeys()


def make(tmp_path, backend, **kw):
    return Service(Config(data_dir=tmp_path, provider="replay", replay_dir=tmp_path / "r", limits=Limits(starting_credits=3), **backend, **kw))


def photo() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), (90, 80, 70)).save(buf, "JPEG")
    return buf.getvalue()


def test_sign_in_with_apple_keeps_this_devices_wardrobe(tmp_path, backend, apple):
    svc = make(tmp_path, backend)
    anon = svc.create_session()
    svc.add_photo(anon["userId"], "tee", "garment", photo())
    signed = svc.sign_in_apple(apple.token(), "n0nce", anon["userId"], keys=apple)
    assert signed["userId"] == anon["userId"] and signed["signedIn"] and not signed["newAccount"]
    # Another device signing in with the same Apple ID reaches the same wardrobe.
    other = svc.sign_in_apple(apple.token(), "n0nce", None, keys=apple)
    assert other["userId"] == anon["userId"]
    assert svc.user_for_token(other["token"]) == anon["userId"]
    assert svc.account(anon["userId"])["signedIn"]


def test_apple_tokens_are_checked(tmp_path, backend, apple):
    svc = make(tmp_path, backend)
    for bad in (
        apple.token(nonce="other"),                                   # replayed with another nonce
        apple.token(aud="com.someone.else"),                          # issued for another app
        apple.token(iss="https://evil.example"),                      # not Apple
        apple.token(exp=-10),                                         # expired
        apple.token(key=rsa.generate_private_key(public_exponent=65537, key_size=2048)),  # not signed by Apple
    ):
        with pytest.raises(Unauthorized):
            svc.sign_in_apple(bad, "n0nce", None, keys=apple)


def test_production_requires_sign_in_with_apple(tmp_path, backend, apple):
    dev = make(tmp_path, backend)
    anon = dev.create_session()
    prod = make(tmp_path, backend, allow_anonymous=False)
    with pytest.raises(Unauthorized):
        prod.create_session()
    assert prod.user_for_token(anon["token"]) is None  # old device tokens stop working
    signed = prod.sign_in_apple(apple.token(sub="new"), "n0nce", None, keys=apple)
    assert prod.user_for_token(signed["token"]) == signed["userId"] and signed["newAccount"]


def test_deleting_the_account_removes_every_file_and_record(tmp_path, backend, apple):
    svc = make(tmp_path, backend)
    me = svc.sign_in_apple(apple.token(), "n0nce", None, keys=apple)
    uid = me["userId"]
    key = svc.add_photo(uid, "tee", "garment", photo())["storageKey"]
    svc.sync(uid, 0, [{"kind": "item", "id": "tee", "data": {"name": "Tee"}, "updatedAt": 1}])
    other = svc.create_session()["userId"]
    other_key = svc.add_photo(other, "tee", "garment", photo())["storageKey"]
    assert svc.storage.exists(key)
    svc.delete_account(uid)
    assert not svc.storage.exists(key)
    assert svc.user_for_token(me["token"]) is None
    for table in ("users", "sessions", "records", "photos"):
        col = "id" if table == "users" else "user_id"
        assert svc.db.one(f"SELECT COUNT(*) AS n FROM {table} WHERE {col} = ?", uid)["n"] == 0
    assert svc.storage.exists(other_key)  # nobody else is touched
    # Signing in again with the same Apple ID starts a fresh, empty account.
    again = svc.sign_in_apple(apple.token(), "n0nce", None, keys=apple)
    assert again["newAccount"] and again["userId"] != uid


def test_sync_is_last_write_wins_and_reaches_other_devices(tmp_path, backend):
    svc = make(tmp_path, backend)
    uid = svc.create_session()["userId"]
    a = svc.sync(uid, 0, [{"kind": "item", "id": "tee", "data": {"name": "Tee"}, "updatedAt": 10},
                          {"kind": "outfit", "id": "o1", "data": {"pieces": {"top": "tee"}}, "updatedAt": 10}])
    assert a["cursor"] == 2
    stale = svc.sync(uid, a["cursor"], [{"kind": "item", "id": "tee", "data": {"name": "Old"}, "updatedAt": 5}])
    assert stale["changes"] == []  # an older edit never overwrites a newer one
    newer = svc.sync(uid, a["cursor"], [{"kind": "item", "id": "tee", "data": {"name": "Stone tee"}, "updatedAt": 20}])
    assert [c["data"]["name"] for c in newer["changes"]] == ["Stone tee"]
    fresh_device = svc.sync(uid, 0, [])
    assert {c["id"]: c["data"] for c in fresh_device["changes"]}["tee"] == {"name": "Stone tee"}
    other = svc.create_session()["userId"]
    assert svc.sync(other, 0, [])["changes"] == []  # wardrobes are private


def test_deleting_an_item_through_sync_removes_its_files(tmp_path, backend):
    svc = make(tmp_path, backend)
    uid = svc.create_session()["userId"]
    key = svc.add_photo(uid, "tee", "garment", photo())["storageKey"]
    svc.sync(uid, 0, [{"kind": "item", "id": "tee", "data": {"name": "Tee"}, "updatedAt": 1}])
    out = svc.sync(uid, 0, [{"kind": "item", "id": "tee", "deleted": True, "updatedAt": 2}])
    assert out["changes"][-1]["deleted"] and not svc.storage.exists(key)


def test_bucket_urls_are_presigned_and_expire(tmp_path, backend):
    if not backend.get("s3_bucket"):
        pytest.skip("runs with CLOSR_TEST_S3=1")
    svc = make(tmp_path, backend)
    uid = svc.create_session()["userId"]
    key = svc.add_photo(uid, "tee", "garment", photo())["storageKey"]
    url = svc.sign(key)
    assert url.startswith("https://") and "X-Amz-Expires=604800" in url and "X-Amz-Signature=" in url


def test_postgres_reconnects_after_the_server_drops_the_connection(tmp_path, backend):
    if not backend.get("database_url"):
        pytest.skip("runs with CLOSR_TEST_DATABASE_URL")
    import psycopg

    svc = make(tmp_path, backend)
    uid = svc.create_session()["userId"]
    with psycopg.connect(backend["database_url"], autocommit=True) as admin:  # e.g. Neon suspending when idle
        admin.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")
    assert svc.account(uid)["userId"] == uid  # plain query: reconnects
    with psycopg.connect(backend["database_url"], autocommit=True) as admin:
        admin.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")
    svc.guard.reserve(uid, None, "render", "replay")  # transaction: reconnects before BEGIN
