# Avatar dress-up: prepared garment assets

How Closr turns a user's clothing photos into reusable, mannequin-ready layers and composes outfits
from them instantly. The prototype pipeline lives in `scripts/avatar-prototype/poc/`; the app-side
data model is `src/features/avatar/types.ts`. Neither is wired into the app yet.

## Principle

Each garment is prepared **once** per styling variant on one canonical mannequin and saved as a
transparent layer aligned to that mannequin. Build Outfit stacks approved layers (shoes, pants,
shoe toes, top, open outer shirt). Swapping never calls an image model; a swap is one screen frame.

## Preparation workflow

1. **Upload.** The user adds a garment photo (optionally photos of themselves wearing it).
2. **Read the garment.** One cheap vision call returns construction (tee, tank, camp shirt, cargo…),
   independent fit attributes with confidences, visible text and which side each logo is on, and
   anything to leave out (hangers, tags). Image processing measures scale-free proportions from the
   photo; worn photos add body-relative ratios (only numbers, never the person's pixels).
3. **Confirm the fit.** Values under the confidence threshold are shown as visual options (the same
   mannequin in each width, length, leg shape or stacking). Corrections are stored with
   `source: "user"` and always win. Partly hidden text stops the job and asks for another photo.
4. **Prepare the default variant.** One image call renders the garment on the canonical mannequin
   (tops over chroma-blue reference trousers so the hem rests on a real waistband). The default drape
   comes from the garment: Natural for oversized/boxy knits, Easy for relaxed non-boxy knits, Smooth
   for regular/fitted knits and tanks, Crisp for woven button-ups.
5. **Check automatically.** Alignment of the bare mannequin band against the canonical one (zoomed
   renders are rescaled and re-checked), waistband coverage and centre lift for untucked drapes,
   colour match to the photo, and a vision read-back of the print. Failures retry once, then go to
   the user with the reason.
6. **Review.** The user sees the original photo beside the prepared layer and approves or rejects.
   Only approved variants appear in Build Outfit.
7. **Save.** Source photo, fit metadata, master and display layers and the variant record go to the
   asset store (below), then to the device cache.
8. **More variants on request.** Relaxed drape, worn open/buttoned, and tucks are separate variants,
   prepared only when a user asks, and reused afterwards. Changing a garment's fit re-prepares only
   that garment.

## Storage

The backend (`server/`, see its README) keeps everything private, keyed by the owner's id:

```
shared/mannequins/<mannequin_id>/{canonical.png, plate.png, plate-display.webp, ref-trousers.png, landmarks.json}
users/<uid>/items/<item_id>/source/<sha>.jpg                     original photo, 1600 px
users/<uid>/items/<item_id>/source/worn/<sha>.jpg                optional worn photos, deletable on their own
users/<uid>/items/<item_id>/variants/<key>/v<n>/master.webp      lossless layer (cropped) on the mannequin canvas
users/<uid>/items/<item_id>/variants/<key>/v<n>/display.webp     phone-size layer (shoes also back/toe parts)
users/<uid>/derived/<pants_variant>/<shoes_variant>/<stacking>.webp   hem stacked on a specific shoe
```

Records (photos, readings, jobs, variants with version and review status, the cost ledger, credit
events) live in the database. Variant keys name styling, never outfits (`drape=natural`,
`drape=crisp;closure=open`, `legs=follow`). Keys are immutable, so the app caches each file forever
under its key; files are served only to their owner or through a short-lived signed URL.

The app keeps its local-first model: `ClothingItem.id` is the garment's id on the server too, so
there is no second garment record. The device stores its prep state and the manifest of approved
layers (`closr.avatar`), and the layers themselves sit in the image disk cache.

## Measured cost and size (prototype, November 2026)

| | |
|---|---|
| Image render | ~$0.16 each (`gemini-3-pro-image`, 2K) |
| Vision calls (read garment, verify print) | ~$0.002 each |
| Usable top variant, all retries and rejects included | **$0.30** average (1.8 renders each; 5 of 6 usable first time) |
| Shared, one-time: canonical mannequin + plate + reference trousers | ~$0.46 |
| Per garment stored: source photo + master + display | ~0.3 + ~0.5 + ~0.03–0.06 MB |
| 10 test garments + mannequin, exported | 6.3 MB |

A 50-garment wardrobe at one default variant each: about **$15** to prepare and **~40 MB** to store,
then nothing per outfit. Each requested extra variant is about $0.30 and ~0.5 MB.

## Status (November 2026)

**Real Gemini test** (approved budget $3, spent **$1.16**, 14 model calls; ledger in the private
backup). Through the same API the app uses, with photos downscaled exactly like the app does:
- tee: the printed Aetherium tee was refused before any render (folds hide part of the print) and
  the app asks for a better photo ($0.008). The flat-laid black tee rendered, but with keying holes
  and too fitted. That led to two fixes: an enclosed-holes check on every layer, and dark-fabric
  keying. Corrected to Boxy, it came out right.
- pants: black carpenter jeans. The first render added double-knee panels; a correction (Baggy +
  "no knee panels") fixed it.
- shoes: New Balance 550, right first time.
- spending limit: with the real client and the cap reached, a reading returned 503 and a queued
  job failed with its credit refunded. No network call was made and the ledger was unchanged.
- cost per approved asset in this run: $0.39, including the rejected versions and the refused photo.

**Production backend, built and tested; not deployed yet** (needs a Fly.io account; see
`server/DEPLOY.md`): Postgres, private S3 bucket with presigned URLs, separate worker, Sign in with
Apple, account deletion, wardrobe sync (items with photos, outfits, profile; last write wins).
Verified with the Docker image itself on Postgres plus an S3 emulator, and the test suite on
SQLite, Postgres and S3.

**App**: Sign in with Apple (Profile, and on the mannequin screen when the server requires it),
sync to the account, delete account, "Closr noticed" notes on review, and on-device layer timing
in TestFlight builds. Checked with typecheck, lint, 46 unit tests and a browser run of the whole
flow (replay). **Not yet run on an iPhone.**

Still to develop: worn photos and extra styles in the app (the backend supports both), outer
layers beyond open shirts, one-pieces and accessories on the mannequin, tucks, Apple token
revocation on account deletion (before App Store release), and re-preparation when the canonical
mannequin changes. Stored raw renders plus `admin reprocess` let keying and check improvements
reach existing garments at no render cost.

**On Me (later):** layers are keyed to a `mannequin_id`, and every source photo, worn photo and
raw render is kept per garment, so a personal body model can become another "mannequin" whose
layers are prepared on request from the same records. Nothing in Build Outfit assumes a single
mannequin.
