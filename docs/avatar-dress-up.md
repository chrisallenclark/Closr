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

## Status (vertical slice, November 2026)

Works end to end against the local backend with the replay provider (recorded, already-paid model
outputs; $0): add or open a garment → upload → read category and fit → visual fit confirmation only
where unsure → queued job → prepared layer → review against the original photo → approve, request a
correction (fit picks and a note), or replace the photo → Build Outfit draws approved layers on the
mannequin; switching, shuffling, the stacking choice and reopening a saved look make no backend calls.
Jobs persist on the server and the device, survive restarts and lost connections, and never duplicate.

Verified: backend unit and HTTP tests (`server/tests`), app unit tests (`tests/avatar.test.ts`),
typecheck and lint, and a browser run of the app (Expo web) through the whole flow for a tee, cargos
and sneakers. Not yet verified on an iPhone; no real model calls have been made through the backend.

Mocked or interim: the replay model provider; anonymous device accounts (no Sign in with Apple, so a
reinstall starts a new account); local disk and SQLite in place of a private bucket and Postgres; the
worker runs inside the API process.

Still to develop: worn photos in the app (the backend accepts them), extra styling variants on
request (drape and closure; the backend supports them), outer layers beyond open shirts, one-pieces
and accessories on the mannequin, tucks, buttoned variants from busy closet photos, a blue backdrop
for light pants, and re-preparation when the canonical mannequin changes.
