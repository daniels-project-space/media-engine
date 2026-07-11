# Media Engine → Autonomous Ad Agency — Master Plan

_Last updated: 2026-07-11. Owner: Daniel. Status: in progress (spine build)._

## 0. One-line vision
A dynamic, multi-project AI ad agency. Jarvis (or a search bar) says _"promote my new app X, free mode, £50 cap"_ and the engine **researches, plans, builds a funnel, schedules content, emails, hands assets to influencers, posts to communities, and runs the whole campaign autonomously** — adjusting spend within a limit, validating as it goes. **This build adds the reasoning + infra spine only. No new assets are rendered via Higgs/fal here** (generation tasks stay untouched and gated; the orchestrator only *plans* and *references* existing models/assets).

## 1. What the engine already is (audit 2026-07-11)
Next.js (App Router) + Convex (`blissful-sardine-231`) + Trigger.dev (`proj_snvnjoxqowcfsutewkzz`) + Cloudflare R2, on Vercel. Secrets live in an **external Convex vault** (`fantastic-roadrunner-485`) read via `src/lib/vault.ts`.

**Real today:** asset-gen pipeline (carousel/ad/short — GATED, untouched here), vision QC, LLM planning (`plan-week`, `plan-ad-script` via OpenRouter deepseek/gemini flash), 30-min autopilot `schedule-tick`, soft daily spend cap, `aiEnabled` kill switch, R2 storage, services landing pages + SEO (ISR, JSON-LD), client-order CRUD, Ad Studio pipeline, lead CRUD + AI-drafted replies. Instagram publish code is real but **no linked token**; Resend email real but sandbox-limited.

**Fake / missing:** analytics = deterministic hash likes (not real); no campaign orchestration from a brief; no cold-email prospecting; no influencer model; no funnel+discount system; no SEO/market intel; spend has no free/paid mode; no LoRA/model registry UI; only Instagram of all platforms.

## 2. Chosen minimal-code integration stack
Prefer one aggregator / OSS repo per job; every adapter reads keys from the vault and is **dry-run by default** (flips live only when key present AND `liveMode` on).

| Job | Pick | Backend(s) | Notes |
|-----|------|-----------|-------|
| Social posting (all platforms) | **Swappable `SocialProvider`** | `ayrshare` (hosted, 1 key) · `postiz` (OSS self-host, MCP-native) · `graph` (existing IG) | Interface so we don't hard-commit. Default `ayrshare` (least infra); Postiz when self-host stood up. |
| Cold email | **Smartlead** | smartlead API | Sequencing + deliverability. |
| Transactional email | **Resend** | existing | Confirmations, receipts. |
| SEO / market intel | **DataForSEO** (+ Serper fallback) | fetch | Keywords, SERP, competitors. Cheapest at volume. |
| Funnel / landing page | **Native Next.js `/f/[slug]`** (Convex-driven) | in-app | Zero vendor cost; agent writes a DB row, page renders. |
| Discount codes | **Stripe `promotion_codes`** | fetch | Trivial POST; Shopify optional later. |
| Brand asset / "understand the app" | **Microlink** | fetch | Pull OG image, screenshot, logo, colors, description from product URL → R2. No rendering. |
| Influencer discovery | **Modash** (later) | fetch | Sales-gated; manual/CSV fallback meanwhile. |
| Community | Reddit API (low volume) | fetch | FB Groups API dead — skip. |

## 3. New data model (Convex tables added)
- **campaigns** — the core object: `productUrl`, `productName`, `brief`, `category`, `mode`(free|paid), `budgetPence`, `spentPence`, `status`, `autonomy`(manual|assist|auto), `plan`(strategy JSON), `funnelSlug`, `discountCode`, `personaId`. Index `by_status`.
- **campaignSteps** — the action DAG: `campaignId`, `kind`(research|funnel|schedule_posts|cold_email|influencer_brief|community_post|analytics_check…), `channel`, `status`, `payload`, `result`, `scheduledAt`, `costPence`, `order`. Index `by_campaign`, `by_status`.
- **funnels** — landing pages driven from DB: slug, headline, subhead, valueProps, cta, discountCode, referenceImageKeys, sections, published, views, conversions. Index `by_slug`, `by_campaign`.
- **discountCodes** — code, provider(stripe|shopify|manual), percentOff/amountOffPence, externalId, maxRedemptions, expiresAt, redemptions. Index `by_code`, `by_campaign`.
- **influencers** — handle, platform, niche, followers, engagementRate, email, contactStatus, campaignId, briefKey, rateNote. Index `by_niche`, `by_campaign`.
- **models** — model/LoRA registry: name, kind(lora|checkpoint|base), provider, url, trigger, baseModel, personaId, previewKeys, tags, status. Index `by_kind`, `by_persona`.
- **playbooks** — marketing know-how: category(cold_email|fiverr_niche|branding|ig_influencer_funnel|app_launch|community|seo), title, channel, structure, templates, bestPractices, kpis, defaultBudgetSplit. Index `by_category`.
- **intelReports** — campaignId, kind(seo|competitor|positioning|trend|audience), query, data, source. Index `by_campaign`.
- **engagement** — real analytics: postId/campaignId, platform, externalId, impressions/reach/likes/comments/shares/saves/clicks/followersDelta, ts. Index `by_post`, `by_campaign`, `by_platform`. Replaces fake hash counts.

## 4. The Brain — campaign orchestrator
`brief → understand → research → strategise → persist plan+steps → (gated) execute → learn`.
1. **Understand** (`lib/orchestrator/understand.ts`): Microlink + page fetch on `productUrl` → LLM → `ProductProfile` (positioning, ICP, category, value props, tone, competitors, reference image keys).
2. **Research** (`lib/integrations/seo.ts`): keywords + SERP + competitor scan → `intelReports`.
3. **Strategise** (`lib/orchestrator/strategy.ts`): profile + intel + mode + budget → `CampaignPlan` = channel mix, content calendar (what content is *needed*, referencing existing personas/models — NOT rendered), playbook selection, budget split, funnel spec, messaging angles, KPIs.
4. **Persist**: `campaigns` row + `campaignSteps` DAG + `funnels` spec + `discountCodes` (gated).
5. **Execute** (`trigger/launch-campaign.ts` + `campaign-tick.ts`): advance due steps within budget, respecting `mode` (free skips paid channels), `autonomy` (auto vs awaiting_approval), `liveMode` (dry-run default). Auto-adjust: pause paid steps and prefer free channels when cap approached.
6. **Learn**: `campaign-tick` ingests `engagement` snapshots → feeds the variantTag loop.

## 5. Jarvis intake + surfaces
- `POST /api/campaign` `{ brief, productUrl?, mode?, budgetPence?, autonomy? }` → creates draft + runs dry-run orchestration → returns `{ campaignId, plan, steps, estimate }`. GET for status. **This is Jarvis's single door.**
- Home **search bar** → same endpoint → renders plan, funnel preview, schedule, spend estimate, "Go live" gate.
- `/campaigns` (list) + `/campaigns/[id]` (plan, step timeline, spend, funnel link, live analytics).
- `/models` — LoRA/model registry (view + add).
- `/f/[slug]` — the live, DB-driven funnel landing page with discount + email capture.

## 6. Spend governor v2
`mode` free|paid + per-campaign `budgetPence`; steps carry `costPence`; `campaign-tick` reserves before running, commits after, and **auto-downgrades to free channels** when `spentPence` nears `budgetPence`. Global `aiEnabled` + new `liveMode` gate remain the master switches.

## 7. Safety gates (non-negotiable)
- **No asset rendering in this workstream.** Orchestrator plans/labels content; it never calls generate-*.
- **Dry-run default.** Every external side-effect (post, email, discount, DM) is simulated and logged unless `liveMode` AND the relevant key exist AND (for auto) autonomy allows.
- **Human approval** on `assist`/`manual`; only `auto` streams self-publish, mirroring existing `schedule-tick` autonomy.
- Keys by name only; never printed.

## 8. Build sequence (this session)
1. Schema additions ✅ spine
2. `lib/integrations/gate.ts` + `lib/llm.ts` (DRY OpenRouter)
3. Adapters: assets(Microlink), seo(DataForSEO/Serper), social(interface+ayrshare+postiz+graph), email(resend+smartlead), discounts(stripe)
4. Convex modules: campaigns, funnels, discounts, influencers, models, playbooks, intel, engagement
5. Orchestrator libs: understand, strategy
6. Triggers: launch-campaign, campaign-tick (+engagement ingest)
7. `/api/campaign` + home search bar + `/campaigns` + `/models` + `/f/[slug]`
8. Seeds: playbooks (4 categories) + models (from persona LoRAs)
9. Validate: `tsc --noEmit`, `next build`, dry-run a campaign
