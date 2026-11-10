# Deploying Closr's backend and a TestFlight build

The backend is one Docker image (`server/Dockerfile`) that runs as two processes, the HTTPS API and
the preparation worker. Production needs three services: the app host, Postgres, and a private
S3-compatible bucket. `fly.toml` sets this up on Fly.io, which provides all three (Fly Machines,
Managed Postgres, and Tigris storage). The image runs anywhere else just as well: set the
environment variables below.

## 0. Private beta (lowest cost): `fly.beta.toml`

Costs and tradeoffs are in `docs/beta-hosting.md`. Every secret is entered by you, in your own
terminal or the provider's dashboard. None of them goes into chat, the repo or the app.

1. **Neon** (neon.com, Free plan): create a project in **AWS us-east-1**. Copy its connection
   string; it includes `sslmode=require`.
2. **Fly.io**: create an account and add a card. Then, from a clone of this branch:
   ```bash
   brew install flyctl && fly auth login
   fly launch --no-deploy -c fly.beta.toml --copy-config   # rename the app if "closr-api" is taken
   fly storage create                                      # private Tigris bucket; sets AWS_* secrets, prints BUCKET_NAME
   fly secrets set -c fly.beta.toml \
       DATABASE_URL='<Neon connection string>' \
       CLOSR_S3_BUCKET='<BUCKET_NAME>' \
       CLOSR_SIGNING_SECRET="$(openssl rand -hex 32)" \
       GEMINI_API_KEY='<your key>'
   fly deploy -c fly.beta.toml
   fly scale count 1 -c fly.beta.toml
   fly ips list -c fly.beta.toml             # want a shared IPv4 + IPv6 only (no $2/month dedicated IPv4)
   curl https://closr-api.fly.dev/healthz    # {"ok":true}
   ```
3. **Mannequin**: download the five files listed in the private backup page's "Mannequin kit"
   into a folder `closr-backup`, then copy them to the machine and install:
   ```bash
   fly ssh console -c fly.beta.toml -C "mkdir -p /tmp/closr-backup"
   fly ssh sftp shell -c fly.beta.toml        # put each file into /tmp/closr-backup/
   fly ssh console -c fly.beta.toml -C "python -m closr_server.admin restore-backup --mannequin-only --from /tmp/closr-backup"
   ```
4. **TestFlight**: section 3 below.

## 1. Scaled backend on Fly.io (`fly.toml`, later)

```bash
brew install flyctl && fly auth login
fly launch --no-deploy --copy-config          # keeps fly.toml; rename the app if "closr-api" is taken
fly mpg create                                # Managed Postgres; then attach it, which sets DATABASE_URL
fly storage create                            # private Tigris bucket; sets AWS_* secrets and BUCKET_NAME
fly secrets set CLOSR_S3_BUCKET=<BUCKET_NAME from the previous step> \
                CLOSR_SIGNING_SECRET=$(openssl rand -hex 32) \
                GEMINI_API_KEY=<your key>     # stays on the server, never in the app
fly deploy
fly scale count app=1 worker=1
curl https://closr-api.fly.dev/healthz        # {"ok": true}
```

If the app name differs from `closr-api`, change `EXPO_PUBLIC_CLOSR_API_URL` in `eas.json` (the
`testflight` profile) to match.

**Install the mannequin into the bucket** (once, from a computer with the private backup):

```bash
# Download the backup files (names in closr-backup-index.json) into ./closr-backup, then:
export CLOSR_S3_BUCKET=<bucket> AWS_ACCESS_KEY_ID=<...> AWS_SECRET_ACCESS_KEY=<...> \
       AWS_ENDPOINT_URL_S3=https://fly.storage.tigris.dev AWS_REGION=auto
python -m closr_server.admin restore-backup --from ./closr-backup   # mannequin + replay fixtures
```

Spending limits are in `fly.toml` (`CLOSR_GLOBAL_DAILY_USD` and the rest). The service-wide daily
cap starts at $3. Raise it on purpose with `fly deploy` after editing, or with `fly secrets set`.
`python -m closr_server.admin spend` (run with `fly ssh console`) prints spend per model, per user,
and per usable asset.

### Environment variables

| Variable | Production value |
|---|---|
| `DATABASE_URL` | Postgres URL (set by `fly mpg attach`) |
| `CLOSR_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` | private bucket (set by `fly storage create`) |
| `GEMINI_API_KEY` | secret; server only |
| `CLOSR_SIGNING_SECRET` | random secret |
| `CLOSR_MODEL_PROVIDER` | `gemini` (`replay` serves recorded outputs at $0) |
| `CLOSR_ALLOW_ANONYMOUS` | `0`: Sign in with Apple required |
| `CLOSR_APPLE_AUDIENCES` | `com.chrisallenclark.closr` |
| `CLOSR_RUN_WORKER` | `0` on the API (the worker runs as its own process) |

## 2. Apple Developer

- Sign in with Apple: `app.json` sets `ios.usesAppleSignIn`. With EAS-managed credentials, the
  build turns the capability on for `com.chrisallenclark.closr` itself. If you manage the App ID
  yourself, enable **Sign in with Apple** for it under Certificates, Identifiers & Profiles.
- App Review requires account deletion for apps with sign-in. It's in Profile → Delete account
  (removes every file and record on the server). Revoking the Apple token on deletion (Apple's REST
  API, using a Sign in with Apple key) is not wired up yet; it's needed before App Store release,
  not for TestFlight.

## 3. TestFlight build

```bash
npx eas-cli build --platform ios --profile testflight
npx eas-cli submit --platform ios --profile testflight --latest
```

The `testflight` profile points the app at the hosted API and turns on device diagnostics: Profile
shows how fast mannequin layers load on the phone and how many came from the on-device cache. In
App Store Connect → TestFlight, add yourself as an internal tester.

## 4. What to try on the iPhone

1. Profile → Continue with Apple. The wardrobe already on the phone is backed up.
2. Add a garment (top, pants, or shoes). The app opens the mannequin screen. Confirm the fit if asked.
3. Leave the screen and use Closr; the item page shows the status. Force-quit and reopen mid-way: it continues.
4. Review: compare your photo with the mannequin, read anything listed under "Closr noticed",
   then approve or request a correction.
5. Build Outfit: switch tops, pants, shoes and stacking. Switching makes no server or AI calls.
6. Save a look, close the app, reopen it: the look comes back from the cache.
7. Optional: install on a second iPhone, sign in, and check that the wardrobe and looks appear.
8. Profile → the diagnostics line gives layer load times (median and p90) and the cache share.

## 5. Local regression testing (no spending)

`CLOSR_MODEL_PROVIDER=replay` with the replay fixtures from the backup runs the whole pipeline at
$0. Tests: `pytest server/tests` (SQLite), with `CLOSR_TEST_DATABASE_URL=postgresql://...` for
Postgres, `CLOSR_TEST_S3=1` for a bucket (moto), and the `CLOSR_TEST_*` replay variables for the
HTTP end-to-end test.
