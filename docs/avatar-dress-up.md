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

`asset_store.py` defines the layout; the same keys work in a cloud bucket:

```
mannequins/<mannequin_id>/{plate.webp, landmarks.json, manifest.json}
garments/<item_id>/item.json                    fit (value, confidence, source), default variant
garments/<item_id>/source/<sha>.jpg             original photo, 1600 px
garments/<item_id>/source/worn/<sha>.jpg        optional worn photos, deletable on their own
garments/<item_id>/variants/<key>/master.webp   lossless layer (cropped) on the mannequin canvas
garments/<item_id>/variants/<key>/display.webp  phone-size layer
garments/<item_id>/variants/<key>/variant.json  placement, styling, checks, status, provenance
```

Variant keys name styling, never outfits (`drape=natural`, `drape=crisp;closure=open`,
`legs=follow`). Pairings that depend on two garments, such as a pants hem stacked against a specific
shoe, are derived on the device at compose time and only cached.

Production needs a small backend: the image model key cannot ship in the app, jobs need retries and
cost limits, and assets must survive reinstalls and sync across devices. The app keeps its existing
local-first model (`PhotoRef.remoteUrl` is already reserved for sync).

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

## Status

Ready to build on: the canonical mannequin and plate, landmark-aligned layers, leg following and
shoe-aware stacking, drape-in-context for tops with fit-based defaults, the automatic checks, and the
store layout.

Still to develop: the backend job service and storage, the in-app upload → confirm → review flow,
buttoned variants from busy closet photos (the model pulled in the background twice; ask for a flat
photo instead), tucks, jackets and other outer layers beyond open shirts, a blue backdrop for light
pants (residual green cast), and a re-preparation path when the canonical mannequin changes.
