# Closr

Your wardrobe. A higher standard.

Closr is an iOS app for organizing the clothes you own, building better outfits from them, and checking whether something new is worth buying. It's built with Expo (SDK 58), React Native and TypeScript.

## What works today

| Feature | Status |
| --- | --- |
| Onboarding and style profile (name, style tags, favourite and avoided colours) | Working |
| Wardrobe: add with camera or library (square crop), categories, types, colours, seasons, dress level, brand, favourites, search, filters | Working |
| Item detail: wear tracking, "pairs well with", edit, replace photo, delete | Working |
| Outfit builder: slot rail, swap pieces, lock slots, Smart Shuffle, save with name and occasion | Working |
| Today's Outfit on Home: picked once a day from your closet and stays the same until you shuffle it | Working |
| Will It Match?: describe an item you're thinking of buying and see what it pairs with, which outfits it makes possible, and anything similar you already own | Working (you tag it by hand) |
| Shop: wardrobe gap insights | Working |
| Shop: curated product recommendations | Not live yet (marked "In development") |
| Virtual try-on | Not live yet. You can save a reference photo now (marked "Coming soon") |

**Smart Shuffle is rule-based, not AI.** It scores combinations on colour harmony, how dressed-up each piece is, your colour preferences and what you wore recently (`src/features/outfits/`). AI features come in later phases (see below), and the app never labels anything as AI until it really is.

## Run it on your iPhone (no Apple account needed)

Every native module the app uses ships with Expo Go, so you can try it right away:

1. Install **Expo Go** from the App Store. It needs to support SDK 58.
2. On a Mac or PC with Node 20+:
   ```bash
   git clone https://github.com/chrisallenclark/Closr.git
   cd Closr
   git checkout claude/loving-feynman-e27jo0   # until this is merged
   npm install
   npx expo start
   ```
3. Scan the QR code with the iPhone Camera app. The phone and computer must be on the same Wi-Fi network. If they can't be, use `npx expo start --tunnel`.

Data lives only on the device. Photos are saved in the app's Documents folder, which is included in iPhone backups.

## TestFlight

You need:
- An Apple Developer Program membership ($99/year) at developer.apple.com.
- A free Expo account at expo.dev.

Then:
```bash
npm install -g eas-cli
eas login
eas init                         # links the project to your Expo account (adds projectId to app.json)
eas build -p ios --profile production
eas submit -p ios --latest       # uploads to App Store Connect, then shows up in TestFlight
```
EAS creates and stores the signing certificates and provisioning profiles. When it asks, sign in with your Apple ID. The bundle identifier is `com.chrisallenclark.closr`. Change it in `app.json` before your first build if you want a different one. Build numbers auto-increment remotely.

Build profiles in `eas.json`:
- `development`: dev client, for when we add native modules that Expo Go doesn't include (e.g. on-device background removal)
- `preview`: internal ad-hoc install, no TestFlight
- `production`: App Store / TestFlight

## Project structure

```
src/app/            Expo Router screens (tabs, item, outfit, match, try-on, onboarding)
src/components/     ui/ design-system primitives; wardrobe/, outfits/, navigation/
src/features/       domain logic and stores: wardrobe, outfits (generator, harmony), matching, insights, profile
src/services/       photo pipeline, persistence, AI contracts (interfaces only)
src/theme/          colours, type, spacing
tests/              unit tests for the domain logic
```

### Data and sync readiness
- Records use UUID ids and `createdAt`/`updatedAt` timestamps. Each store is versioned so it can be migrated later.
- Photos are stored as paths *relative* to the app container, because iOS changes the absolute container path between updates. They're downscaled to 1400px JPEG. `PhotoRef` already has `remoteUrl` (for cloud sync) and `cutoutPath` (for background removal) fields.
- Item tiles render on a shared cream backdrop, so mixed user photos look consistent. When a cutout exists it's shown contained on that backdrop as a product shot.

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest (domain logic)
```

## Roadmap

1. **AI** (via a small backend so no API keys ship in the app): auto-tagging from photos, AI Will It Match?, natural-language outfit requests, weather-aware Today's Outfit, background removal.
2. **Accounts and sync**: Sign in with Apple, cloud backup and multi-device.
3. **Try-on and shopping**: virtual try-on on your saved photo, plus partner product feeds filtered by wardrobe gaps.
