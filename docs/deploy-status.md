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

## Verified on 2026-11-12 (no live changes)
- Memory: the deployment image under a hard 2 GB limit, 3 garments prepared plus 6 concurrent
  full-size uploads: peak 1,224 MiB, no OOM (1.5 GB would leave ~300 MiB; 1 GB can't run it).
- Auto-stop safety: server stopped mid-job with SIGINT (as Fly does) and restarted: the job resumed at
  once, finished as 1 job / 1 layer / 1 credit; the app's resubmission returned the same job.
  Worst case: one interrupted real render paid twice, bounded by the attempt limit (2) and the $1.80 cap.
- Health check: `/healthz` (200); `/` returns 404 by design.
- No GitHub Actions workflows in the repo: any automatic deploy would come from Fly's GitHub link.
- Owner is on Windows: use the Fly dashboard or PowerShell flyctl.

## Secrets (names verified against server/closr_server/config.py)
- Set by the owner (staged with `fly secrets import --stage`, so nothing restarts):
  `DATABASE_URL` (Neon **direct** connection string, pooling OFF: the server takes a session-level
  advisory lock during migrations, which a transaction pooler breaks), `GEMINI_API_KEY`, `CLOSR_ADMIN_TOKEN`.
- Set automatically by `fly storage create`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `BUCKET_NAME`. Either Tigris endpoint (t3.storage.dev or
  fly.storage.tigris.dev) works: the code uses whatever is set.
- Not needed: `CLOSR_SIGNING_SECRET` (bucket storage uses its own presigned URLs).

## Next (each needs the owner's approval)
1. Read-only check of the live app: machines, IPs, checks, logs, secret names.
2. Destroy the two AMS trial machines (they hold no data: no database or bucket was attached).
3. `fly storage create` (Tigris, free tier) and three secrets set in the dashboard.
4. `fly deploy --ha=false` from `claude/loving-feynman-e27jo0`: one 2 GB machine in iad.
5. Claude installs the mannequin through the operator token and verifies the API.
6. EAS TestFlight build (`--profile testflight`, URL https://closr.fly.dev).
