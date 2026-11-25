# Aulorvy: Owner Profile (shared context for every AI tool)

Canonical copy: `Aulorvy/Aulorvy.com` → `docs/AULORVY_PROFILE.md`. Every product repo carries an identical copy at `docs/AULORVY_PROFILE.md`; if they differ, the Aulorvy.com copy wins.
Last updated: 2026-11-25. Items marked TBD are unverified; never guess them.

## Who
- Christian "Chris" Clark. Handle and company: **Aulorvy**. GitHub: `chrisallenclark` (personal) and the `Aulorvy` org.
- Based in Delray Beach / Boca Raton, South Florida. Time zone: America/New_York (Eastern).
- Builds software with AI, mainly Claude Code, plus Cursor cloud agents and Grok Bot assistants. Works about 30 hours a week at Life Time, so his time is limited.
- Devices: a Windows PC and an iPhone. **He has no Mac**, so iOS builds go through GitHub Actions and TestFlight.

## Goal
Reach financial freedom through profitable, scalable businesses, especially B2B SaaS, and rely less on trading time for money by using AI and automation. He prefers existing tools over custom software, and real results over reports or dashboards.

## Businesses (keep them separate)
| Business | What it is | Status (as of 2026-11-25) |
|---|---|---|
| Aulorvy | Parent tech and SaaS company; site at aulorvy.com | Site repo `Aulorvy/Aulorvy.com`; Cloudflare Pages plan in progress (TBD confirm) |
| Macrova | Premium custom meal prep (about $30/meal, personalized portions and macros) for Delray Beach, Boca Raton and nearby South Florida | Operating. Site macrova.com is Next.js on Vercel (repo `chrisallenclark/Macrova`) |
| Mealixr | Multi-vendor meal-prep marketplace | In development (`chrisallenclark/mealixr`) |
| Closr | AI virtual wardrobe and outfit-building app | In development (`chrisallenclark/Closr`) |
| Keepr | Personal relationship and contact manager: who to reach out to and when | iOS in private TestFlight testing; Firebase backend (project `keepr-contacts`) live; Android in progress (`chrisallenclark/Keepr`) |
| Remli | Idea capture and organization, voice and text | iOS (Swift) in development (`chrisallenclark/Remli`) |
| Hybrid Performance | Chris's personal training business | Operating (no product repo in scope) |

Never share data, customers, branding or accounts between businesses unless Chris authorizes it.

## How to work with Chris
- Keep updates short and in plain English: what you found, why it matters, your recommendation, and the next action. Explain jargon.
- **Separate verified facts from assumptions.** Mark anything unverified as TBD; never invent facts, numbers or names.
- Be proactive and practical. Challenge his assumptions, and don't create extra management work.
- Minimize questions. Decide reversible things yourself and ask only when a wrong guess has real cost.

## Never do without Chris's explicit OK
- Push to `main`, merge pull requests, or deploy. Work on a branch and open a PR; Chris reviews and merges.
- Add or change secrets, API keys, env vars in hosting, or new integrations or services. Never commit secrets or config files that contain keys (for example `FirebaseOptions.plist`, `.env`).
- Send emails or messages to customers or prospects, spend money, or create accounts.
- Change live site behavior that customers see.
- Mix data or accounts between businesses.

## Tools in use (verified unless marked)
GitHub (PRs only), Claude Code, Cursor cloud agents, Grok Bot assistants, Vercel (Macrova), Firebase (Keepr), Postmark (Macrova email), MongoDB Atlas (Macrova), Cloudflare (Aulorvy.com, TBD), GitHub Actions + TestFlight (iOS).
