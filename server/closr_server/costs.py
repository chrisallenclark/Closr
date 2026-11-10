"""Spend control: every model call reserves its worst-case cost first and is refused if any cap
(per user per day, per user per month, global per day) would be exceeded. The real cost replaces
the reservation when the call returns, so the ledger is the source of truth for spend.

Credits are separate from dollars: one credit per preparation job, held when the job is queued,
charged when it produces a reviewable asset, refunded when it fails.
"""

from __future__ import annotations

import time

from .config import PRICES, Config
from .db import DB, now


class SpendLimit(RuntimeError):
    """A cap would be exceeded; the call is not made."""


class OutOfCredits(RuntimeError):
    pass


class RateLimited(RuntimeError):
    pass


def _day_start(t: float) -> float:
    g = time.gmtime(t)
    return time.mktime((g.tm_year, g.tm_mon, g.tm_mday, 0, 0, 0, 0, 0, -1)) - time.timezone


def _month_start(t: float) -> float:
    g = time.gmtime(t)
    return time.mktime((g.tm_year, g.tm_mon, 1, 0, 0, 0, 0, 0, -1)) - time.timezone


class CostGuard:
    def __init__(self, db: DB, cfg: Config):
        self.db, self.cfg = db, cfg

    def _spent(self, since: float, user_id: str | None = None) -> float:
        # Pending calls count at their reservation, finished ones at their real cost.
        sql = "SELECT COALESCE(SUM(COALESCE(cost_usd, reserved_usd)), 0) AS s FROM model_calls WHERE created_at >= ?"
        args: list = [since]
        if user_id:
            sql += " AND user_id = ?"
            args.append(user_id)
        return float(self.db.one(sql, *args)["s"])

    def reserve(self, user_id: str | None, job_id: str | None, purpose: str, model: str) -> int:
        """Reserve budget for one call, or raise SpendLimit. Returns the ledger row id."""
        worst = PRICES.get(model, (0, 0, 1.0))[2]
        lim = self.cfg.limits
        t = now()
        with self.db.tx():
            if lim.global_total_usd and self._spent(0) + worst > lim.global_total_usd:
                raise SpendLimit("total budget reached")
            if self._spent(_day_start(t)) + worst > lim.global_daily_usd:
                raise SpendLimit("global daily budget reached")
            if user_id and self._spent(_day_start(t), user_id) + worst > lim.user_daily_usd:
                raise SpendLimit("daily limit for this account reached")
            if user_id and self._spent(_month_start(t), user_id) + worst > lim.user_monthly_usd:
                raise SpendLimit("monthly limit for this account reached")
            row = self.db.one(
                "INSERT INTO model_calls (user_id, job_id, purpose, model, reserved_usd, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
                user_id, job_id, purpose, model, worst, t,
            )
            return int(row["id"])

    def settle(self, call_id: int, model: str, usage: dict | None, ok: bool) -> float:
        rin, rout, _ = PRICES.get(model, (0, 0, 0))
        tin = int((usage or {}).get("promptTokenCount", 0))
        # Thinking tokens are billed as output too (Gemini 3 models think before answering).
        tout = int((usage or {}).get("candidatesTokenCount", 0)) + int((usage or {}).get("thoughtsTokenCount", 0))
        usd = tin / 1e6 * rin + tout / 1e6 * rout
        self.db.run("UPDATE model_calls SET cost_usd = ?, ok = ?, in_tokens = ?, out_tokens = ? WHERE id = ?",
                    round(usd, 6), int(ok), tin, tout, call_id)
        return usd

    # -- rate limits and credits ---------------------------------------------------------------

    def check_rate(self, user_id: str, kind: str) -> None:
        lim = self.cfg.limits
        since = now() - 3600
        if kind == "job":
            n = self.db.one("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND created_at >= ?", user_id, since)["n"]
            if n >= lim.jobs_per_hour:
                raise RateLimited("Too many garments prepared in the last hour. Try again later.")
        else:
            n = self.db.one("SELECT COUNT(*) AS n FROM model_calls WHERE user_id = ? AND purpose = 'analyze' AND created_at >= ?",
                            user_id, since)["n"]
            if n >= lim.analyses_per_hour:
                raise RateLimited("Too many photos checked in the last hour. Try again later.")

    def hold_credit(self, user_id: str, job_id: str) -> None:
        with self.db.tx():
            row = self.db.one("SELECT credits FROM users WHERE id = ?", user_id)
            if not row or row["credits"] < 1:
                raise OutOfCredits("No preparation credits left.")
            self.db.run("UPDATE users SET credits = credits - 1 WHERE id = ?", user_id)
            self.db.run("INSERT INTO credit_events (user_id, job_id, delta, reason, created_at) VALUES (?, ?, -1, 'hold', ?)",
                        user_id, job_id, now())

    def refund_credit(self, user_id: str, job_id: str, reason: str) -> None:
        with self.db.tx():
            held = self.db.one("SELECT COALESCE(SUM(delta), 0) AS d FROM credit_events WHERE job_id = ?", job_id)["d"]
            if held < 0:  # only refund what this job still holds
                self.db.run("UPDATE users SET credits = credits + 1 WHERE id = ?", user_id)
                self.db.run("INSERT INTO credit_events (user_id, job_id, delta, reason, created_at) VALUES (?, ?, 1, ?, ?)",
                            user_id, job_id, f"refund: {reason}", now())

    def usage(self, user_id: str) -> dict:
        t = now()
        row = self.db.one("SELECT credits FROM users WHERE id = ?", user_id)
        good = self.db.one(
            "SELECT COUNT(*) AS n FROM variants WHERE user_id = ? AND status IN ('approved', 'superseded')", user_id)
        spent = self._spent(0, user_id)
        return {
            "credits": row["credits"] if row else 0,
            "spent_today_usd": round(self._spent(_day_start(t), user_id), 4),
            "spent_month_usd": round(self._spent(_month_start(t), user_id), 4),
            "spent_total_usd": round(spent, 4),
            "usable_assets": good["n"],  # versions the person approved; rejected ones still count as spend
            "cost_per_usable_asset_usd": round(spent / good["n"], 4) if good["n"] else None,
        }
