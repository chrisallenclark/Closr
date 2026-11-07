# Closr garment preparation server

Prepares each wardrobe garment once into a layer aligned to Closr's canonical mannequin, so the app
can dress the mannequin instantly from cached layers. The image model runs here and only here: the
iOS app never holds a model key. See `docs/avatar-dress-up.md` for the design.

## What it enforces

Every limit is checked on the server before money is spent:

| Limit | Default | Env var |
|---|---|---|
| Preparations a new account can request | 25 | `CLOSR_STARTING_CREDITS` |
| Jobs per user per hour | 10 | `CLOSR_JOBS_PER_HOUR` |
| Photo readings per user per hour | 30 | `CLOSR_ANALYSES_PER_HOUR` |
| Attempts per job (one automatic retry) | 2 | `CLOSR_MAX_ATTEMPTS` |
| Spend per user per day / month | $1.50 / $10.00 | `CLOSR_USER_DAILY_USD`, `CLOSR_USER_MONTHLY_USD` |
| Spend for the whole service per day | $5.00 | `CLOSR_GLOBAL_DAILY_USD` |
| Extra styles per garment beyond the default | 3 | `CLOSR_EXTRA_VARIANTS_PER_ITEM` |

Each model call reserves its worst-case price in the ledger first (refused if it would cross a cap),
then records the real cost from the response's token counts. A job holds one credit, refunded if it
fails. Jobs are idempotent (same photo, same request → the same job) and leased, so a crashed worker's
job is picked up again rather than run twice. Free and premium tiers are a matter of these numbers;
there are no payments.

## Run locally (no spending)

```bash
python -m venv .venv && .venv/bin/pip install -r server/requirements.txt
export CLOSR_DATA_DIR=~/closr-data            # private: photos, layers, database
export CLOSR_MODEL_PROVIDER=replay            # recorded outputs only; never calls a model
export CLOSR_REPLAY_DIR=~/closr-replay
cd server
../.venv/bin/python -m closr_server.admin install-mannequin --from <mannequin folder>
../.venv/bin/python -m closr_server.admin build-replay --spec <spec.json>
CLOSR_CORS_ORIGINS=http://localhost:8081 ../.venv/bin/uvicorn closr_server.app:create_app --factory --port 8000
```

Point the app at it with `EXPO_PUBLIC_CLOSR_API_URL=http://<host>:8000`. Without that variable the
mannequin feature stays hidden. `python -m closr_server.admin spend` prints spend per model, per user
and per usable asset.

Mannequin files, replay fixtures and anything under the data directory are private wardrobe data:
keep them out of git (this repository is public).

## Tests

```bash
cd server && ../.venv/bin/python -m pytest -q tests
```

The HTTP end-to-end test also runs when `CLOSR_TEST_DATA_DIR`, `CLOSR_TEST_REPLAY_DIR` and
`CLOSR_TEST_PHOTOS` point at a private copy of the mannequin, fixtures and photos.

## Before real users

- Host the API and a separate worker process (the worker now runs as a thread in the API).
- Move storage to a private bucket (the `Storage` class is the only file-system code) and the
  database to Postgres (the SQL is portable; `BEGIN IMMEDIATE` becomes row locks).
- Set `CLOSR_SIGNING_SECRET`, `GEMINI_API_KEY` (server secret store only) and
  `CLOSR_MODEL_PROVIDER=gemini`.
- Replace anonymous device accounts with Sign in with Apple so wardrobes survive a reinstall.
- Agree an integration-test budget before the first real model call.
