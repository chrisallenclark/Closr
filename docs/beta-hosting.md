# Private beta hosting: configuration and costs (November 2026)

Prices were checked on 2026-11-10 against the providers' pricing pages and docs (sources at the end).
Estimates assume US East.

## Recommended beta configuration (`fly.toml`)

| Piece | Choice | Runs continuously? |
|---|---|---|
| API + worker | **one** Fly Machine, shared-cpu-1x, 2 GB, auto-stop / auto-start | No. It stops a few minutes after the last request and keeps itself awake only while a preparation is queued or running. |
| Database | **Neon Postgres, Free plan** (1 GB, 100 CU-hours/month, TLS) | No. It suspends after 5 minutes idle; the server reconnects. |
| Images | **Tigris** private bucket (via `fly storage create`): free 5 GB, no egress fees | Storage only |
| Builds | EAS Free plan: up to 15 iOS builds a month, low-priority queue | — |

This needs no architecture change. It's the existing image with the worker inside the API process
(`CLOSR_RUN_WORKER=1`), which the code already supported. Code changes made for it:
- **Database reconnects** after the host drops the connection (Neon suspend, restarts). Before this,
  every query failed until a restart.
- **The worker keeps the machine awake** while jobs are pending, so auto-stop never interrupts a paid render.
- **Peak memory per preparation went from 2.0 GB to 1.15 GB** (the segmentation model's memory
  arena is off). A 2 GB machine now has headroom; 1 GB is not enough.
- **All-time spending cap** `CLOSR_GLOBAL_TOTAL_USD`, set to $1.80: the rest of the approved $3
  integration-test budget ($1.16 is already spent). The daily and monthly caps stay on as well.

The scaled configuration (`fly.scaled.toml`: separate always-on API and worker, Fly Managed Postgres) is
for later. Moving to it is a config and secrets change, not a code change.

## Unit prices used

| Item | Price |
|---|---|
| Fly shared-cpu-1x, 256 MB | $2.19/month at 100% uptime; extra RAM $6.00/GB-month (raised from $5 on 2026-10-01) |
| Fly shared-cpu-1x, **2 GB** | ≈ $12.69/month if always on ≈ $0.0174 per running hour |
| Fly stopped machine | rootfs only: $0.15/GB-month (this image ≈ 2 GB ≈ $0.30/month) |
| Fly outbound bandwidth | $0.02/GB (North America and Europe); images don't pass through Fly |
| Fly Managed Postgres, Basic | **$38/month** + $0.28/GB storage (smallest managed plan) |
| Neon Free | $0: 1 GB storage per project, 100 CU-hours/month, 5 GB transfer; never bills overages (writes fail at the cap) |
| Neon Launch (if needed) | $0.106 per CU-hour; storage $0.35/GB-month |
| Tigris | $0.02/GB-month after 5 GB free; $0.005 per 1,000 writes (10,000 free), $0.0005 per 1,000 reads (100,000 free); **no egress fees** |
| Apple Developer Program | $99/year (already paid for TestFlight) |

## Estimated monthly cost by active users (hosting only)

Assumptions:
- Each opening of Closr wakes the machine for about 10 minutes, three opens per active user a day.
- Each garment stores about 4 MB: photo, layers and the raw renders kept for free reprocessing.
- A wardrobe has about 30 garments.
- Neon stays awake whenever the machine runs.

| Active users | Fly machine | Database | Images | **Hosting total** |
|---|---|---|---|---|
| 1 | ~15 h running ≈ $0.26 + $0.30 stopped rootfs | Neon Free $0 | 0.1 GB, free | **≈ $0.60** |
| 10 | ~180–300 h ≈ $3–5 | Neon Free (≈ 45–75 of 100 CU-h) | 1.2 GB, free | **≈ $3–6** |
| 100 | effectively always on ≈ $12.69 | ≈ 180 CU-h, over free: Neon Launch ≈ $19, or stay free with tighter use | 12 GB ≈ $0.15 | **≈ $15–35** |
| 1,000 | move to `fly.scaled.toml`: 2 API (1 GB) + 2–3 workers (2 GB) ≈ $45–55 | Neon Launch ≈ $40–75, or Fly MPG Basic $38 + storage | 120 GB ≈ $2.30 + writes ≈ $1 | **≈ $90–135** |

Why 1,000 users means more machines: one in-process worker prepares one garment at a time (about
30–80 s each, mostly waiting on Gemini), so roughly 45–100 garments an hour. That's fine for a beta;
a launch wave needs separate workers.

**AI is the real variable cost.** Hosting is small next to it. In the live test it came to about
$0.39 per approved garment, retries and rejected versions included, paid once per garment. A
30-garment wardrobe costs about $12 once, then nothing per outfit. Server-side credits and caps
bound it per user (beta: 10 credits, $1.50/day, $1.80/month) and in total (beta: $1.80 all-time).

## Avoiding charges from unused resources

- **One machine:** `fly scale count 1`. Check with `fly machines list`.
- **No dedicated IPv4** ($2/month): `fly ips list`. If one was allocated, run
  `fly ips allocate-v4 --shared` and `fly ips release <dedicated ip>`.
- **No volumes and no Fly Postgres** in this configuration: `fly volumes list` should be empty.
- **Neon Free and Tigris's free tier** never bill unless you upgrade.
- **Pausing the beta:** `fly scale count 0` leaves only the rootfs charge (≈ $0.30/month).
- **Ending the beta:** `fly apps destroy closr`, delete the Tigris bucket, and delete the Neon project.
- **Watch Gemini spend:** `fly ssh console -C "python -m closr_server.admin spend"`. Fly has no hard spending cap; check the Fly billing page.

## Tradeoffs of the cheaper beta configuration

- **Cold starts:** the first request after idle waits a few seconds while the machine starts. The
  app retries uploads, sync and polling, so nothing is lost, just slower the first time.
- **No redundancy:** one machine. A host problem means downtime until Fly restarts it elsewhere.
  It holds no data (database and images are external), so recovery is automatic.
- **One job at a time.** A deploy or crash in the middle of a job retries it, which can pay for one
  render twice. That's limited by the attempt cap and the total budget.
- **Neon Free limits:** a 1 GB cap (writes fail beyond it), a short point-in-time restore window on
  the free plan (check Neon's current plan page), and data with a second provider. Connections are
  TLS-only and the URL is stored as a Fly secret.
- **No security reduction.** These stay the same as in the scaled setup: private bucket, presigned
  URLs, Sign in with Apple only (`CLOSR_ALLOW_ANONYMOUS=0`), the Gemini key only in Fly secrets,
  and per-user and global spend caps.

## Sources

- Fly.io pricing: https://fly.io/docs/about/pricing/ and https://fly.io/pricing
- Fly stopped-machine rootfs billing: https://community.fly.io/t/we-are-going-to-start-collecting-charges-for-stopped-machines-rootfs-starting-april-25th/17825
- Fly bandwidth: https://fly.io/blog/we-cut-bandwidth-prices-go-nuts/
- Fly Managed Postgres: https://fly.io/docs/mpg
- Neon plans and free limits: https://neon.com/docs/introduction/plans and https://neon.com/faqs/free-plan-limits-and-quotas
- Tigris pricing: https://tigrisdata.com/docs/pricing
- EAS Free plan limits: https://expo.dev/pricing and https://expo.dev/changelog/2023-08-01-eas-free-plan-limits
