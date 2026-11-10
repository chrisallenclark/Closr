"""Database schema and helpers: SQLite in development, Postgres in production, same SQL.

Tables
  users          one per person: credits balance, Sign in with Apple identity (once linked)
  sessions       bearer tokens (stored hashed): anonymous device sessions or Apple sign-ins
  records        the synced wardrobe (items, outfits, profile) as JSON, last write wins
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
  credits INTEGER NOT NULL,
  apple_sub TEXT UNIQUE,
  email TEXT,
  created_at {real} NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('device', 'apple')),
  created_at {real} NOT NULL,
  last_used_at {real} NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at {real} NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (user_id, seq);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('garment', 'worn')),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at {real} NOT NULL,
  UNIQUE (user_id, item_id, sha256)
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  photo_set TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at {real} NOT NULL,
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
  cost_usd {real} NOT NULL DEFAULT 0,
  lease_until {real},
  created_at {real} NOT NULL,
  updated_at {real} NOT NULL
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
  created_at {real} NOT NULL,
  reviewed_at {real}
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
  id {autoid},
  user_id TEXT,
  job_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  reserved_usd {real} NOT NULL,
  cost_usd {real},
  ok INTEGER,
  in_tokens INTEGER,
  out_tokens INTEGER,
  created_at {real} NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_user_time ON model_calls (user_id, created_at);
CREATE INDEX IF NOT EXISTS calls_time ON model_calls (created_at);
CREATE TABLE IF NOT EXISTS credit_events (
  id {autoid},
  user_id TEXT NOT NULL,
  job_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at {real} NOT NULL
);
"""


# Schema changes after the base schema, applied once each, in order, on every backend. Never edit
# or reorder an entry that has shipped; append a new one. Write SQL both SQLite and Postgres accept.
MIGRATIONS: list[tuple[int, str]] = [
    # (2, "ALTER TABLE variants ADD COLUMN body_profile TEXT"),  # example of the form
]


def connect(target: str | Path) -> "DB":
    """`postgres://...` (production) or a SQLite file path (development and tests)."""
    t = str(target)
    return PgDB(t) if t.startswith(("postgres://", "postgresql://")) else DB(Path(t))


class DB:
    """SQLite. One shared connection, serialised by a lock (the API and worker share a process)."""

    dialect = "sqlite"

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._migrate_v1()
        self.conn.executescript(SCHEMA.format(real="REAL", autoid="INTEGER PRIMARY KEY AUTOINCREMENT"))
        self.lock = threading.RLock()
        self.migrate()

    def migrate(self, migrations: list[tuple[int, str]] | None = None) -> list[int]:
        """Applies pending MIGRATIONS (each in its own transaction) and returns their versions."""
        self.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
        if not self.one("SELECT version FROM schema_migrations WHERE version = 1"):
            self.run("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)", time.time())  # the base schema
        done = {r["version"] for r in self.all("SELECT version FROM schema_migrations")}
        applied = []
        for version, sql in sorted(MIGRATIONS if migrations is None else migrations):
            if version in done:
                continue
            with self.tx():
                self.run(sql)
                self.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", version, time.time())
            applied.append(version)
        return applied

    def _migrate_v1(self) -> None:
        """Development databases from before Sign in with Apple kept one device token per user."""
        cols = [r[1] for r in self.conn.execute("PRAGMA table_info(users)")]
        if "token_hash" not in cols:
            return
        self.conn.execute("BEGIN")
        self.conn.execute("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, created_at REAL NOT NULL, last_used_at REAL NOT NULL)")
        self.conn.execute("INSERT OR IGNORE INTO sessions SELECT token_hash, id, 'device', created_at, created_at FROM users")
        self.conn.execute("CREATE TABLE users_v2 (id TEXT PRIMARY KEY, credits INTEGER NOT NULL, apple_sub TEXT UNIQUE, email TEXT, created_at REAL NOT NULL)")
        self.conn.execute("INSERT INTO users_v2 (id, credits, created_at) SELECT id, credits, created_at FROM users")
        self.conn.execute("DROP TABLE users")
        self.conn.execute("ALTER TABLE users_v2 RENAME TO users")
        self.conn.execute("COMMIT")

    def _sql(self, sql: str) -> str:
        return sql

    def one(self, sql: str, *args):
        with self.lock:
            return self.conn.execute(self._sql(sql), args).fetchone()

    def all(self, sql: str, *args) -> list:
        with self.lock:
            return self.conn.execute(self._sql(sql), args).fetchall()

    def run(self, sql: str, *args):
        with self.lock:
            return self.conn.execute(self._sql(sql), args)

    def tx(self):
        """`with db.tx():` runs the block in one transaction that serialises writers, across processes too."""
        return _Tx(self)

    def _begin(self):
        self.conn.execute("BEGIN IMMEDIATE")

    def _end(self, ok: bool):
        self.conn.execute("COMMIT" if ok else "ROLLBACK")


class PgDB(DB):
    """Postgres, for production: the API and the worker run as separate processes on one database."""

    dialect = "postgres"

    def __init__(self, url: str):
        self.url = url
        self.lock = threading.RLock()
        self.in_tx = False
        self._connect()
        with self.lock:
            self.conn.execute("SELECT pg_advisory_lock(7101)")  # one process migrates at a time
            try:
                for stmt in SCHEMA.format(real="DOUBLE PRECISION", autoid="BIGSERIAL PRIMARY KEY").split(";"):
                    if stmt.strip():
                        self.conn.execute(stmt)
                self.migrate()
            finally:
                self.conn.execute("SELECT pg_advisory_unlock(7101)")

    def _connect(self):
        import psycopg
        from psycopg.rows import dict_row

        self.conn = psycopg.connect(self.url, autocommit=True, row_factory=dict_row)

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s")

    def _retry(self, fn):
        """Hosted Postgres closes connections (idle suspend, restarts, failover): reconnect once and
        retry a single statement. Inside a transaction the error propagates and it rolls back."""
        import psycopg

        try:
            return fn()
        except psycopg.OperationalError:
            if self.in_tx:
                raise
            self._connect()
            return fn()

    def one(self, sql: str, *args):
        with self.lock:
            return self._retry(lambda: self.conn.execute(self._sql(sql), args).fetchone())

    def all(self, sql: str, *args) -> list:
        with self.lock:
            return self._retry(lambda: self.conn.execute(self._sql(sql), args).fetchall())

    def run(self, sql: str, *args):
        with self.lock:
            return self._retry(lambda: self.conn.execute(self._sql(sql), args))

    def _begin(self):
        if self.conn.closed or self.conn.broken:
            self._connect()
        try:
            self.conn.execute("BEGIN")
        except Exception:
            self._connect()
            self.conn.execute("BEGIN")
        self.in_tx = True
        # Same guarantee as SQLite's IMMEDIATE: spending checks and credit changes never interleave.
        self.conn.execute("SELECT pg_advisory_xact_lock(7102)")

    def _end(self, ok: bool):
        self.in_tx = False
        if self.conn.broken:
            return  # the server already dropped the transaction
        self.conn.execute("COMMIT" if ok else "ROLLBACK")


class _Tx:
    def __init__(self, db: DB):
        self.db = db

    def __enter__(self):
        self.db.lock.acquire()
        self.db._begin()
        return self.db

    def __exit__(self, exc_type, *_):
        try:
            self.db._end(exc_type is None)
        finally:
            self.db.lock.release()


def now() -> float:
    return time.time()


def dumps(obj) -> str:
    return json.dumps(obj, default=str, separators=(",", ":"))


def loads(s: str | None):
    return json.loads(s) if s else None
