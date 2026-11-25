This repo is Closr, an AI virtual wardrobe and outfit-building app. It is NOT Macrova, Mealixr, Aulorvy.com, Keepr, Remli, or Hybrid Performance.

Read `docs/AULORVY_PROFILE.md` first for owner context and never-do rules.

Facts below are from this repo at commit `0fea1b0` (2026-11-17), "Link the app to the existing EAS project @base-zero/closr". Anything not verified here is marked TBD.

## Purpose and audience

Closr is an iOS app for organizing the clothes you own, building outfits from them, and checking whether something new is worth buying. Tagline in `README.md`: "Your wardrobe. A higher standard."

The on-device app works in Expo Go. When a build sets `EXPO_PUBLIC_CLOSR_API_URL`, it also talks to a garment-preparation backend so a canonical mannequin can wear approved layers. Without that variable the mannequin feature stays hidden (`src/services/avatarApi.ts`).

TBD (Chris to confirm): Who is the audience beyond someone organizing the clothes they own on an iPhone? No persona or market is written down.

## Brand and UI rules

Dark-only. `src/theme/colors.ts` says the palette is the brand: dark espresso surfaces, warm taupe, cream accent. `app.json` sets `userInterfaceStyle` to `dark` and background `#14100D`. Status bar is light (`src/components/ui/Screen.tsx`).

| Token | Value |
| --- | --- |
| Background | `#14100D` |
| Elevated / surface | `#1B1612`, `#211B16`, `#2A231D` |
| Cream accent | `#EFE4D2` |
| Text | `#F3EADC` (muted `#A99A8A`, faint `#6F6358`) |
| Success / warning / danger | `#9AA67A` / `#D2A65E` / `#C77B6A` |
| Item-tile studio gradient | `#F1E8D9` → `#E3D6C2` |

Fonts, loaded in `src/app/_layout.tsx`: Cormorant Garamond (wordmark and display) and Inter (UI body). The wordmark component renders the word "Closr".

Use `src/theme` (`colors`, `type`, `space`, `gutter` 20, `radii`, `motion`) and `src/components/ui` rather than one-off styles. Shared pieces: `Screen`, `Text` (variant from the type scale), `Button` (`primary` cream pill, `secondary`, `ghost`, `danger`), `Card`, `Chip`, `Badge`, `Sheet`, `Header`, `PressableScale`, `Wordmark`. Icons are `lucide-react-native`.

Copy on screen is short and second person. Do not label Smart Shuffle as AI. `README.md` and `src/services/ai/types.ts` say it is rule-based (colour harmony, dress level, colour preferences, recent wears). The app must not call something AI until it is.

Item photos render on the shared cream backdrop. A cutout, when one exists, is shown contained on that backdrop (`README.md`).

## Stack

App (`package.json`, lockfile is `package-lock.json`; there is no `bun.lock`):

- TypeScript `~6.0.3` (`strict`, `noUncheckedIndexedAccess`, `@/*` → `src/*`)
- Expo `~58.0.20`, Expo Router `~58.0.27`, React `19.3.0`, React Native `0.88.0`
- Zustand `^5.0.16` for stores
- On device: `@react-native-async-storage/async-storage` `2.2.0`, `expo-secure-store` (session token on iOS), `expo-file-system` and `expo-image*` for photos
- UI: `expo-image`, `react-native-reanimated` `4.7.1`, `react-native-gesture-handler`, `lucide-react-native`
- Sign in with Apple: `expo-apple-authentication` (iOS capability `usesAppleSignIn` in `app.json`)
- App version `1.0.0`. Bundle id and Android package: `com.chrisallenclark.closr`
- `README.md` says Node 20+ to run it. `package.json` has no `engines` field.

Backend (`server/`, image `python:3.12-slim` in `server/Dockerfile`):

- FastAPI, uvicorn, Pillow, numpy, scipy, scikit-image, rembg (CPU), httpx, psycopg, boto3, PyJWT (`server/requirements.txt`, minimum versions, not pins)
- Tests: pytest and moto (`server/requirements-dev.txt`)
- Local data: SQLite and disk. Production config in `fly.toml`: Postgres via `DATABASE_URL`, private S3-compatible bucket, Gemini only on the server
- Documented hosts (`docs/deploy-status.md`, `docs/beta-hosting.md`, `fly.toml`): Fly app `closr` at `https://closr.fly.dev`, Neon Postgres (direct connection, not the transaction pooler), Tigris bucket, Google Gemini

`ios/` and `android/` are not in the repo. Native projects are generated (see `AGENTS.md`). `app.json` `extra.eas.projectId` is `9f3b2f32-fcf9-41de-bef7-591b0343c127`, owner `base-zero`.

## Build, run, and test commands

These scripts exist in `package.json`. This repo uses npm (`package-lock.json`), not Bun.

```bash
npm install
npx expo start                  # npm start. Same Wi-Fi, or: npx expo start --tunnel
npm run ios                     # expo start --ios
npm run web                     # expo start --web
npm run lint                    # expo lint
npm run typecheck               # tsc --noEmit
npm test                        # jest, tests/**/*.test.ts, preset jest-expo
npm run format                  # prettier --write .
npm run doctor                  # expo-doctor
npx expo install <package>      # SDK-compatible versions (see AGENTS.md)
```

`README.md` says Expo Go can run the app when every native module is one Expo Go already ships, and that Expo Go must support SDK 58.

Backend, from `server/README.md` (no model spend when the provider is `replay`):

```bash
python -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server && ../.venv/bin/python -m pytest -q tests
```

`server/DEPLOY.md` also documents Postgres (`CLOSR_TEST_DATABASE_URL`), S3 (`CLOSR_TEST_S3=1`), and replay HTTP end-to-end (`CLOSR_TEST_*`). Point the app at a local API with `EXPO_PUBLIC_CLOSR_API_URL`.

There is no `bun.lock`, so do not use `bunx` here. `AGENTS.md` only switches to `bunx` when that lockfile exists.

## Deploy target and release process

No `.github/` workflows exist. Nothing in this repo deploys on push by itself.

What the repo says is manual:

- Private beta API: `fly deploy --ha=false` using `fly.toml` (one shared-cpu 2 GB machine, region `iad`, auto-stop, worker inside the API process, health check `GET /healthz`). Scaled shape later is `fly.scaled.toml` (separate API and worker). Steps and secrets are in `server/DEPLOY.md` and `docs/beta-hosting.md`. Enter secrets in the provider dashboard. Do not put them in the repo, chat, or shell history.
- iOS: EAS. `eas.json` profiles are `development` (dev client), `preview` (internal), `production` (auto-increment), and `testflight` (extends production, store distribution, `EXPO_PUBLIC_CLOSR_API_URL=https://closr.fly.dev`, diagnostics on). Submit profile uses App Store Connect app id `6827766770`. `README.md` shows `eas build -p ios --profile production` and `eas submit`. `server/DEPLOY.md` shows `npx eas-cli build --platform ios --profile testflight` and a matching submit.
- `docs/beta-hosting.md` (prices checked 2026-11-10) says the Apple Developer Program fee is already paid, and names the EAS free plan as the build queue. This file does not re-check billing.

`docs/deploy-status.md` (2026-11-12) says Fly's GitHub launch pushed branch `flyio-new-files` (still on the remote, not merged) and that any automatic deploy would come from Fly's GitHub link, not from GitHub Actions.

TBD (Chris to confirm): Does a Fly GitHub connection still auto-deploy this repo?
TBD (Chris to confirm): Is Expo owner `base-zero` (project id above) the account agents should use?

## Current status

Default branch in this clone is `claude/loving-feynman-e27jo0` (`origin/HEAD`). There is no `main` branch on the remote. `README.md` was last committed on 2026-10-27 (`1fa33ad`) and still says to check out `claude/loving-feynman-e27jo0` until it is merged.

**On-device product, as `README.md` (2026-10-27) and the screens still describe it.** Working: onboarding and style profile; wardrobe add (camera or library, square crop), categories, colours, seasons, dress level, brand, favourites, search, filters; item detail (wear tracking, pairs well with, edit, replace photo, delete); outfit builder (slot rail, swap, lock, Smart Shuffle, save with name and occasion); Today's Outfit on Home; Will It Match? (you tag the item by hand); Shop wardrobe-gap insights. Not live: Shop curated products (`Badge` "In development" in `src/app/(tabs)/shop.tsx`); virtual try-on (`Badge` "Coming soon" in `src/app/try-on.tsx` and Profile). Smart Shuffle is rule-based. `src/services/ai/types.ts` still has unimplemented contracts for auto-tagging, background removal, and natural-language styling.

**Added after that README, through 2026-11-17.** Garment preparation and mannequin dress-up (`dce5b82`, 2026-11-07, and the avatar commits from 2026-11-03). Sign in with Apple, wardrobe sync, account deletion, Postgres, private bucket (`cd77a54` and `641fd44`, 2026-11-08). Photos stay on the phone; Profile says a signed-in wardrobe is also backed up to the account (`src/app/(tabs)/profile.tsx`). `README.md`'s line "Data lives only on the device" does not mention that backup.

**Backend, as `docs/deploy-status.md` last updated 2026-11-17 (`08eae0b`).** Documented live: Fly app `closr`, one machine in `iad`, shared-cpu 2 GB, `/healthz` ok, anonymous sign-up refused, mannequin `closr-v3` installed, provider gemini, spend $0.00, all-time cap $1.80, 0 accounts. Same file, still listed as left to do that day: destroy the empty Fly-provisioned `closr-images` bucket, re-check `fly secrets list`, and a TestFlight build. Earlier the same month the file records a Tigris key that was pasted into chat, then rotated by the owner (2026-11-13).

`docs/avatar-dress-up.md` was last committed 2026-11-10 (`e221820`). It still says the production backend was not deployed yet and the app had not been run on an iPhone. That is older than the 2026-11-17 deploy-status note. Treat 2026-11-17 as the later written status, and do not assume an iPhone run happened after it.

Gaps still visible in code or in that 2026-11-10 design note: one-pieces are not worn on the mannequin (`src/features/avatar/useStageLayers.ts`); worn photos and extra styles in the app, outer layers beyond open shirts, accessories, and tucks are still to build; Apple token revocation on account deletion is named in `server/DEPLOY.md` as not wired (no revocation code in this repo). `server/README.md` default caps (25 starting credits, $10 user monthly, no all-time cap in that table) differ from `fly.toml` (10 credits, $1.50 user daily, $1.80 user monthly, $1.80 global daily and all-time).

Jest tests are 7 files under `tests/`. Pytest tests are `server/tests/test_accounts.py` and `server/tests/test_service.py`. They were not re-run for this file. `docs/avatar-dress-up.md` says a check on 2026-11-10 included 46 unit tests.

TBD (Chris to confirm): Is https://closr.fly.dev still up, and is the 2026-11-17 snapshot (one iad machine, mannequin `closr-v3`, $0 spend, 0 accounts, $1.80 cap) still true?
TBD (Chris to confirm): Has a TestFlight build been submitted since 2026-11-17, and has Closr been run on an iPhone?
TBD (Chris to confirm): Were the leftover steps done (destroy empty `closr-images`, re-check Fly secret names)?
TBD (Chris to confirm): Which spend numbers are policy, the `fly.toml` beta caps or the `server/README.md` defaults?
TBD (Chris to confirm): Should the 2026-10-27 `README.md` "What works today" table still be the status agents trust, given sign-in, sync, and the mannequin?
TBD (Chris to confirm): Is Android a product target? `app.json` has an Android package, but the documented run and ship path is iPhone, Expo Go, and TestFlight.
TBD (Chris to confirm): Should `claude/loving-feynman-e27jo0` stay the default branch until you create or restore `main`?

## Repo-specific rules

- Read `docs/AULORVY_PROFILE.md` and follow it. Keep Closr separate from Macrova, Mealixr, Aulorvy.com, Keepr, Remli, and Hybrid Performance. Do not share their data, customers, branding, or accounts.
- Branch and open a pull request. Do not push to `main`, merge, or deploy unless Chris says so. This clone has no `main`; do not push the default branch either.
- Do not add or change secrets, API keys, hosting env vars, or new integrations or services without Chris's OK. Never commit secret files (`.env`, key files, `FirebaseOptions.plist`, or anything under `server/data/`, `closr-data/`, `closr-replay/`). `GEMINI_API_KEY` stays on the server. The app never ships a model key.
- Do not hand-edit `ios/` or `android/` if they are generated. Configure native behavior in `app.json` and config plugins (`AGENTS.md`).
- Routes live in `src/app/`. Keep components, features, and services outside it. Import navigation from `expo-router`.
- Add Expo libraries with `npx expo install`, not a bare package-manager add.
- Before code that uses an Expo, EAS, or React Native API, read the Expo SDK 58 docs. Do not trust memory of older SDKs (`AGENTS.md`).
- Run lint and typecheck before calling app work done (`AGENTS.md`).
- Mannequin files, replay fixtures, and wardrobe photos stay out of git. This repository is public (`server/README.md`).
- Separate verified facts from assumptions. If it is not in the repo, mark it TBD. Do not invent numbers, dates, or names.

## Key paths

| Path | What it is |
| --- | --- |
| `src/app/` | Expo Router screens: tabs (Home, wardrobe, outfits, shop, profile), item, outfit builder, match, try-on, onboarding |
| `src/components/ui/` | Design-system primitives (text, buttons, screen, sheets) |
| `src/theme/` | Colours, type, spacing, radii, motion |
| `src/features/wardrobe/` | Wardrobe types, catalog, store, selectors |
| `src/features/outfits/` | Rule-based generator, colour harmony, Today's Outfit |
| `src/features/avatar/`, `src/services/avatarApi.ts` | Mannequin client, prep state, sync. Hidden unless the API URL is set |
| `src/features/matching/`, `src/features/insights/` | Will It Match? and wardrobe-gap insights |
| `src/services/ai/types.ts` | Phase-2 AI interfaces. Not implemented |
| `src/services/photos.ts`, `src/services/storage.ts` | On-device photo pipeline and persistence |
| `server/closr_server/` | FastAPI app, worker, auth, pipeline, storage, spend caps |
| `server/Dockerfile`, `fly.toml`, `fly.scaled.toml` | Image and Fly configs (beta vs later scaled) |
| `app.json`, `eas.json` | Expo config, bundle id, EAS project, TestFlight profile |
| `docs/deploy-status.md`, `docs/beta-hosting.md`, `docs/avatar-dress-up.md`, `server/DEPLOY.md` | Status, cost, design, and deploy steps |
| `tests/`, `server/tests/` | Jest domain tests and pytest API tests |
| `scripts/avatar-prototype/` | Earlier prototype pipeline. Production path is `server/` |
| `docs/AULORVY_PROFILE.md` | Shared owner profile. Do not edit it in this repo; the Aulorvy.com copy wins if they differ |
