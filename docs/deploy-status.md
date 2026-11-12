# Beta deployment status (progress record)

Keep this short and current, so later sessions don't redo finished work. Never put secrets here.

## Done (verified)
- Backend: FastAPI API + in-process worker (`server/`), Docker image `server/Dockerfile`; tests pass
  on SQLite, Postgres and S3 (moto); replay end-to-end test passes.
- Real Gemini integration test: $1.16 spent of the approved $3. The hosted cap is $1.80 all-time
  (`CLOSR_GLOBAL_TOTAL_USD`).
- Private backup of the mannequin, layers, replay fixtures and ledger:
  https://claude.ai/artifact/GbwWXsajNMBALmg8Lgw5ec ("Mannequin kit" section).
- Neon project created (by the owner).
- Fly app `closr` created (Personal org) via Fly's GitHub launch; URL https://closr.fly.dev.

## Found on 2026-11-12 (audit)
- Fly's launch pushed branch `flyio-new-files` (one commit: its own `fly.toml`). Not merged: it set
  region AMS, added `memory_mb = 256` (overriding 2 GB), and kept `kill_timeout` inside `[env]`
  (our bug, fixed in `fly.toml`). It deployed two 256 MB machines in AMS, with no secrets.
- `GET /` returns 404 by design (the API has no root route); the health check is `/healthz`.

## Next (each needs the owner's approval)
1. Read-only check of the live app: machines, IPs, checks, logs, secret names.
2. Destroy the two AMS trial machines (they hold no data: no database or bucket was attached).
3. `fly storage create` (Tigris, free tier) and three secrets set in the dashboard.
4. `fly deploy --ha=false` from `claude/loving-feynman-e27jo0`: one 2 GB machine in iad.
5. Claude installs the mannequin through the operator token and verifies the API.
6. EAS TestFlight build (`--profile testflight`, URL https://closr.fly.dev).
