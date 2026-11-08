"""Backends for the tests. By default SQLite + local disk. Set CLOSR_TEST_DATABASE_URL to run every
test on Postgres, and CLOSR_TEST_S3=1 to run them on an S3 bucket (moto, in-process)."""

from __future__ import annotations

import os

import pytest

PG = os.environ.get("CLOSR_TEST_DATABASE_URL", "")
S3 = os.environ.get("CLOSR_TEST_S3") == "1"


def reset_pg() -> None:
    import psycopg

    with psycopg.connect(PG, autocommit=True) as c:
        c.execute("DROP SCHEMA public CASCADE")
        c.execute("CREATE SCHEMA public")


@pytest.fixture
def backend(monkeypatch):
    """Extra Config fields for the selected backends."""
    extra = {}
    if PG:
        reset_pg()
        extra["database_url"] = PG
    if S3:
        from moto import mock_aws

        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
        monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
        m = mock_aws()
        m.start()
        import boto3

        boto3.client("s3").create_bucket(Bucket="closr-test")
        extra["s3_bucket"] = "closr-test"
        yield extra
        m.stop()
        return
    yield extra
