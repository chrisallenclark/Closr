"""Server configuration, all from environment variables.

Every spending limit lives here so free/premium decisions can be made later without code changes.
Secrets (the Gemini key) are only ever read from the environment on the server.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Limits:
    # Credits: one credit = one preparation job (a default asset, a correction or a new variant).
    starting_credits: int = int(_env("CLOSR_STARTING_CREDITS", "25"))
    # Rate limits.
    jobs_per_hour: int = int(_env("CLOSR_JOBS_PER_HOUR", "10"))
    analyses_per_hour: int = int(_env("CLOSR_ANALYSES_PER_HOUR", "30"))
    # Model attempts per job (the first render plus automatic retries).
    max_attempts: int = int(_env("CLOSR_MAX_ATTEMPTS", "2"))
    # Spending caps in USD, checked before every model call against the worst case of that call.
    user_daily_usd: float = float(_env("CLOSR_USER_DAILY_USD", "1.50"))
    user_monthly_usd: float = float(_env("CLOSR_USER_MONTHLY_USD", "10.00"))
    global_daily_usd: float = float(_env("CLOSR_GLOBAL_DAILY_USD", "5.00"))
    # Variants a user may request beyond the default, per garment.
    extra_variants_per_item: int = int(_env("CLOSR_EXTRA_VARIANTS_PER_ITEM", "3"))


# USD per 1M tokens (input, output) and the worst case of one call, used to reserve budget first.
PRICES = {
    "gemini-3-pro-image": (2.00, 120.0, 0.30),
    "gemini-3.5-flash": (0.50, 3.0, 0.02),
    "replay": (0.0, 0.0, 0.0),
}


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(default_factory=lambda: Path(_env("CLOSR_DATA_DIR", "./closr-data")).resolve())
    # "replay" serves recorded model outputs (no spend); "gemini" calls the real API.
    provider: str = _env("CLOSR_MODEL_PROVIDER", "replay")
    replay_dir: Path = field(default_factory=lambda: Path(_env("CLOSR_REPLAY_DIR", "./closr-replay")).resolve())
    render_model: str = _env("CLOSR_RENDER_MODEL", "gemini-3-pro-image")
    vision_model: str = _env("CLOSR_VISION_MODEL", "gemini-3.5-flash")
    mannequin_id: str = _env("CLOSR_MANNEQUIN_ID", "closr-v3")
    limits: Limits = field(default_factory=Limits)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "closr.db"

    @property
    def storage_dir(self) -> Path:
        return self.data_dir / "storage"

    def signing_secret(self) -> bytes:
        """Signs short-lived file URLs. Set CLOSR_SIGNING_SECRET in production; dev keeps one in data_dir."""
        env = os.environ.get("CLOSR_SIGNING_SECRET")
        if env:
            return env.encode()
        path = self.data_dir / "signing.key"
        if not path.exists():
            import secrets

            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(secrets.token_hex(32))
            path.chmod(0o600)
        return path.read_text().strip().encode()

    def gemini_key(self) -> str:
        key = os.environ.get("GEMINI_API_KEY", "")
        if self.provider == "gemini" and not key:
            raise RuntimeError("GEMINI_API_KEY is not set on the server")
        return key
