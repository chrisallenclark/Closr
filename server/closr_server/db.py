"""SQLite schema and helpers. Plain SQL so it ports to Postgres when the server is deployed.

Tables
  users          device sessions (token stored hashed); credits balance
  photos         uploaded source / worn photos, content-addressed per user
  analyses       one fit reading per (user, item, photo set), cached
  jobs           preparation jobs; `idem_key` is unique, so the same request never runs twice
  variants       prepared assets per item and styling key, with status and version history
  model_calls    every model call with its real cost (the spend ledger)
  credit_events  credit grants, holds, charges and refunds
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('garment', 'worn')),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at REAL NOT NULL,
  UNIQUE (user_id, item_id, sha256)
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  photo_set TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at REAL NOT NULL,
  UNIQUE (user_id, item_id, photo_set)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  request TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'preparing', 'ready_for_review', 'approved', 'rejected', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  variant_id TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  lease_until REAL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs (state, created_at);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs (user_id, updated_at);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('needs_review', 'approved', 'rejected', 'superseded')),
  mannequin_id TEXT NOT NULL,
  master_key TEXT NOT NULL,
  display_key TEXT NOT NULL,
  placement TEXT NOT NULL,
  styling TEXT NOT NULL,
  checks TEXT NOT NULL,
  job_id TEXT,
  created_at REAL NOT NULL,
  reviewed_at REAL
);
CREATE INDEX IF NOT EXISTS variants_item ON variants (user_id, item_id, variant_key, version);
CREATE TABLE IF NOT EXISTS derived (
  user_id TEXT NOT NULL,
  pants_variant_id TEXT NOT NULL,
  shoes_variant_id TEXT NOT NULL,
  stacking TEXT NOT NULL,
  display_key TEXT NOT NULL,
  placement TEXT NOT NULL,
  PRIMARY KEY (pants_variant_id, shoes_variant_id, stacking)
);
CREATE TABLE IF NOT EXISTS model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  job_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  cost_usd REAL,
  ok INTEGER,
  in_tokens INTEGER,
  out_tokens INTEGER,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_user_time ON model_calls (user_id, created_at);
CREATE TABLE IF NOT EXISTS credit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  job_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at REAL NOT NULL
);
"""


class DB:
    """A thread-safe SQLite connection (the API and the worker share one process in development)."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self.lock = threading.RLock()

    def one(self, sql: str, *args) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def all(self, sql: str, *args) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def run(self, sql: str, *args) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, args)

    def tx(self):
        """`with db.tx():` runs the block in one IMMEDIATE transaction (serialises writers)."""
        return _Tx(self)


class _Tx:
    def __init__(self, db: DB):
        self.db = db

    def __enter__(self):
        self.db.lock.acquire()
        self.db.conn.execute("BEGIN IMMEDIATE")
        return self.db

    def __exit__(self, exc_type, *_):
        try:
            self.db.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.db.lock.release()


def now() -> float:
    return time.time()


def dumps(obj) -> str:
    return json.dumps(obj, default=str, separators=(",", ":"))


def loads(s: str | None):
    return json.loads(s) if s else None
