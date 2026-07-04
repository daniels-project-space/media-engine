# Multi-service AI creative agency — strategy (2026-07-04)

Synthesised from 4 deep-research passes: 13 Fiverr sellers Daniel linked, service-vs-stack ranking,
marketplace expansion, funnel/landing-page/avatar playbook.

## The reframe (most important finding)
The sellers Daniel linked are NOT cheap AI-UGC gigs — they're premium Fiverr Pro sellers at $250–$844+.
The money is in **premium "HumanXAI" positioning + a monthly retainer ladder**, not $10 AI gigs.
- madridny: one $330 catalog gig → $1.1M / 5,596 orders. Productize ONE outcome, not a skill menu.
- Filmito (shivamsuthar): Fiverr $250–597 entry → own-site retainers **$2,497–$9,997/mo**. Fiverr is the
  funnel; the retainer is the business. "Directed, not generated" = 10–40× the pure-AI gig price.
- Every winner: Fiverr Pro badge + high anchor price + named-logo/number proof + scarcity discount.

## Services to launch (profit × how much pipeline we already own)
1. **Faceless YouTube/TikTok channel-in-a-box** — own the whole YSA pipeline; market is 90% slop; best recurring ($150+/mo managed).
2. **AI product photography + e-commerce bundle** — Nano Banana product-accurate in minutes; images + product video $70–350 pack.
3. **AI social content packs / monthly calendars** — own content + posting service; $90–400/mo retainer.
4. **AI UGC ad packs** — core pipeline; sell 10-variant test batches, not single ads.
5. **AI music / jingles** — music-house pipeline; thinner competition; $200–500 brand-audio packages.
- SKIP as engine service: n8n/AI-automation (highest ticket but bespoke per client — separate consulting line).
- One engine, ~7 Fiverr gigs: these are mostly repackaging existing pipeline outputs, not new builds.

## Marketplaces — expansion order
1. Instagram/TikTok organic (factory output IS the ad, ~£0)  2. Own site + Stripe (home base, ~97% kept)
3. Contra (0% commission, AI-welcomed)  4. Upwork (biggest B2B pool, ~10% fee, AI allowed w/ disclosure)
5. Cold email + manual LinkedIn (legal B2B, personalised demos)  6. Payhip/Gumroad (packaged digital goods)
7. PeoplePerHour  8. Product Hunt (one-time spike). SKIP: Toptal, Creative Market, Freelancer, PromptBase.

## Funnel — the hard ToS constraint
Full "AI talks to & closes the client" is legal ONLY on OUR surfaces (landing page, our email, IG auto-reply
to inbound via official API). On EVERY marketplace the bot is a DRAFTING copilot with a **human send-click** —
auto-messaging buyers = ban (Fiverr/Upwork/Contra/PPH all). Off-platform contact before an Upwork contract =
permanent ban. Mechanism: Trigger.dev `wait.forToken()` waitpoint pauses at zero compute, surfaces the drafted
reply in a Next.js approval UI, human approves → resumes.
- Free sample as closer: 1 concept, 5–8s, low-res, watermarked, gated behind qualified intake, best-of-N, "demo not licensed". Rate-limit per email+IP.

## Landing pages (home base, reusable across every channel, ZERO render cost)
- Use-case pages (3.5% CVR) beat generic service pages (2.7%). Single CTA (+29%). Speed-to-lead <5min = 21× qualify.
- Section order: navbar(1 CTA) → hero(descriptive headline + muted autoplay loop playsinline clip + CTA) →
  proof strip → how-it-works → **before/after sample gallery** (thumbnails w/ play buttons, NOT autoplay) →
  value/objections → pricing (3 tiers, "Most Popular", risk-reducers) → mini-case → FAQ → intake form → footer.
- Intake: 3–5 fields (Name, Email, Service pre-filled, Brand/link, Budget dropdown, Timeline).
- Build: `app/services/[slug]/page.tsx` + Convex `services` table + ISR + `generateMetadata` + JSON-LD + sitemap.
  ~5 genuinely-distinct pages is safe (May-2026 core update demoted template-fill pSEO — keep unique substance).

## Founder "soul" avatar intro
Chain: ElevenLabs Professional Voice Clone → HeyGen Avatar IV/V (face from photo) → OmniHuman 1.5 (fal, gesture
intercuts) → Remotion finish (karaoke captions + 30–40% b-roll of real work + music). Fallback: Higgsfield Soul.
Script (30–60s): hook → who → what(one offer) → proof(a real number) → CTA.
**BLOCKED ON DANIEL:** headshot (or 10–30 photo set), 1–3 min voice sample (ideally 30min studio), script beats, brand kit, consent note.

## Build sequence
Phase 1 (no renders): services catalog + per-service landing pages + lead funnel (Convex leads + waitpoint approve UI).
Phase 2: wire marketplaces (own-site auto, marketplace draft-and-approve) + sample-generator gated behind intake.
Phase 3: founder avatar intro (once Daniel provides assets). Phase 4: retainer offer + upsell automation.
