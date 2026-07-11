# Media Engine v2 — Full Media Service on Mastra

_2026-07-11. Builds on `AD_ENGINE_MASTER_PLAN.md`. Reasoning/infra only — no assets rendered._

## What this pass added

### 1. Product-aware context (Shopify)
- `src/lib/integrations/shopify.ts` — Admin GraphQL (`2026-01`, `X-Shopify-Access-Token`): `getProducts()` (real catalogue), `createDiscount()` (`discountCodeBasicCreate`, gated). Creds in vault service **`shopify`** (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`) — **not yet added** (only `cj` exists).
- `src/lib/product-channels.ts` — deterministic **product→channel mapping**: price→AOV band (impulse/considered/premium) + category detection → ranked channels + creative formats + angle. Store rollup = dominant channels across the catalogue.
- Convex `stores` + `products` (each product stores its `channelPlan`). `campaigns.storeId` links a campaign to a store.
- `src/lib/orchestrator/store.ts` — `syncStore()` pulls the catalogue + computes channel plans; `productContextFor()` builds the strategist's product block. `run.ts` passes it so **a store-targeted campaign plans for the real products on the channels each one fits.**
- `POST /api/store` connect+sync; `GET` lists stores. `/stores` UI page. Trigger `sync-store`.

### 2. Everything on Mastra
- `src/mastra/` — `tools.ts` (12 tools wrapping adapters+Convex), `agents.ts` (5 agents: strategist, product_analyst, distribution, asset_librarian, cross_marketer), `index.ts` (`getMastra()` lazy instance + `capabilityManifest()`), `brain.ts` (`agentJson`/`agentText`).
- Model = **Claude Sonnet via the subscription**: `createAnthropic({ baseURL, fetch: authedFetch })` where `authedFetch` injects `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20`, deletes `x-api-key`, and re-resolves the token per request (rotation-safe). Reuses `llm.ts` `anthropicCreds()`.
- Defensive (mirrors youtube-studio-ai): Mastra loads via **dynamic import**, latches **disabled** on any failure, and `agentJson` falls back to the proven `llm.ts`. `understand.ts` → `product_analyst`, `strategy.ts` → `strategist` — the brain runs on Mastra with a safety net.

### 3. Capability manifest (interface knows what it can do)
- `capabilityManifest()` (built from config, always works even if Mastra fails) → `GET /api/capabilities` → `/capabilities` UI. Lists agents+tools+workflows+channels+capability areas. **This is the surface Jarvis introspects before launching work.**

### 4. Asset-reuse graph + repurposing
- Convex `assets` (nodes), `assetDerivations` (DERIVED_FROM edges: reframe/recaption/cameo_insert/repurpose), `placements` (asset → platform/brand + tracking/discount code). `assets.lineage` returns the full chain.
- `src/lib/integrations/repurpose.ts` — `repurposeAsset({assetId, platform, mode})`:
  - `influencer` → brief pack (hooks, caption, asset URL, code, do/don'ts) + `handed_off` placement.
  - `cameo` / `reframe` → registers a **derived** asset (plan; pixels rendered later by the gated pipeline — Higgsfield Soul-ID / fal face-swap for cameo, ffmpeg/AutoFlip for reframe) + lineage edge + gated post to TikTok/Reels.
  - LLM drafts platform-native hook/caption; **FTC/AI disclosure applied**.
- `POST /api/repurpose`, Trigger `repurpose-asset`. `run.ts` auto-registers pulled reference stills into the graph on launch.

### 5. Cross-marketing
- Convex `crossPromotions` (bundle/shoutout_swap/referral/retarget/syndication). `src/lib/orchestrator/crossmarket.ts` `findCrossPromos()` — `cross_marketer` agent proposes moves across the portfolio, avoiding cannibalization. `POST /api/crossmarket` runs it; `GET` lists.

### 6. Gaps closed / flagged
- **FTC/AI disclosure gate** (`src/lib/integrations/disclosure.ts`) — hard, deterministic; applied in the repurpose/placement path.
- Documented gaps (from research) still open: competitor ad-spy, synthetic focus groups, dynamic pricing, LTV-based prioritization, trend-jacking, dual attribution (MTA+MMM), GEO/AIO for AI search. Repurposing **renders** (cameo/reframe pixels) remain gated to Higgsfield/fal per the no-render rule.

## To go live
- Add vault `shopify` (domain + admin token) → connect on `/stores`.
- Subscription contention/429 (shared with interactive Claude) still applies to the Mastra brain; `llm.ts` fallback also hits the subscription.
- Live posting/discounts need the per-channel keys + `liveMode` on (see master plan §7).
- TikTok/Reels posting: via the social provider (Ayrshare/Postiz) or the platform Content Posting APIs (need app review).
