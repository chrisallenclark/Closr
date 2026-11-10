# Deploying Closr's backend and a TestFlight build

The backend is one Docker image (`server/Dockerfile`) that runs as two processes, the HTTPS API and
the preparation worker. Production needs three services: the app host, Postgres, and a private
S3-compatible bucket. `fly.toml` sets this up on Fly.io, which provides all three (Fly Machines,
Managed Postgres, and Tigris storage). The image runs anywhere else just as well: set the
environment variables below.

## 0. Private beta (lowest cost): `fly.toml`

Costs and tradeoffs are in `docs/beta-hosting.md`. You enter every secret yourself, in the
provider's dashboard. None of them goes into chat, the repo, your shell history or the app.

**A. Neon (database), about 3 minutes**
1. Sign up at https://neon.com (Free plan, no card). Create a project named `closr`, region
   **AWS US East (N. Virginia)**.
2. On the project dashboard, choose **Connect** and copy the connection string (starts
   `postgresql://`, ends `sslmode=require`). Keep the tab open for step B5.

**B. Fly.io (server and private image storage), about 10 minutes**
1. Sign up at https://fly.io and add a card (billing is per use; see the cost table).
2. In Terminal on your Mac:
   ```bash
   brew install flyctl
   git clone -b claude/loving-feynman-e27jo0 https://github.com/chrisallenclark/Closr.git && cd Closr
   fly auth login
   fly launch --no-deploy --copy-config --name closr-api   # "No" to databases or Redis if asked
   fly storage create --name closr-images                   # private Tigris bucket; adds its keys to the app itself
   openssl rand -hex 24 | pbcopy                            # an operator token, now on your clipboard
   ```
   If `closr-api` is taken, pick another name and tell Claude (the app's server address uses it).
3. Open https://fly.io/dashboard → **closr-api** → **Secrets** and add three secrets:
   - `CLOSR_ADMIN_TOKEN`: paste from the clipboard (step 2). Keep it there for the next step.
   - `DATABASE_URL`: the Neon connection string (step A2).
   - `GEMINI_API_KEY`: your Gemini key.
4. Claude then asks for the operator token through a secure form (not chat). Paste the same value.
   It's used only to install the mannequin and read the spend report.
5. Back in Terminal: `fly deploy` (about 5 minutes the first time), then `fly scale count 1`.

Claude then installs the mannequin through the operator token and verifies the hosted API.

**C. TestFlight, about 5 minutes of your time plus a ~20-minute cloud build**

In the same folder:
```bash
npx eas-cli build --platform ios --profile testflight --auto-submit
```
Sign in with your Apple ID when asked. This first build adds the Sign in with Apple capability to
the app's provisioning profile, which needs your Apple login; later builds can run without you.
When it finishes, the build shows up in TestFlight on your iPhone after Apple's processing (about
10–30 minutes).

## 1. Scaled backend on Fly.io (`fly.scaled.toml`, later)

```bash
brew install flyctl && fly auth login
fly launch --no-deploy -c fly.scaled.toml --copy-config  # keeps the config; rename the app if "closr-api" is taken
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
