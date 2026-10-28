# Marketing MVP

This adds a project-oriented marketing surface at `/marketing` alongside the
existing client creative desk. It does not activate social publishing, paid
rendering or advertising merely by deploying the code.

## What was retained

The canonical release inspected on 28 October 2026 is main
`1f9d2d394e2b121bb52953c42dbb04add282647d`, deployed at
`https://media-engine-seven.vercel.app`. Production serves the client creative
workflow; the fuller creator-promotion interface/workers exist on another
branch. This change preserves that creative workflow, Convex service gateway,
Trigger project and Media Engine R2 bucket. Promotional image and video briefs
in `/marketing` use only the separate Hyper renderer; the legacy Render Engine
remains paused and is not a provider for this marketing brief workflow. The
retired distribution adapters remain inactive.

## Operator workflow

1. Add a website URL. Import its bounded public metadata, then confirm the offer,
   audience, product facts, conversion goal, timezone and cadence. Metadata is
   untrusted input, not automatically certified product claims.
2. Set independent generation and advertising allowances in the project currency.
   Save the one-time conversion credential in that website's server secrets.
3. Connect Instagram, X, Reddit, Meta Ads or Google Ads from this project's
   Channels page. The server creates or recovers a dedicated Zernio profile,
   then returns through a signed OAuth callback and verifies the account against
   the provider inventory. Accounts are scoped to one project. Platform consent
   remains owner-driven; connecting does not create a social identity, publish a
   post or launch an ad. Existing unassigned Zernio profiles can be adopted
   during onboarding. Choose Off, Draft or Automatic. Automatic policies require
   explicit authorisation, expire within 30 days and do not authorise individual
   paid campaigns. Reddit also requires an approved community.
4. Upload an original image with usage rights, or import a completed approved
   final image/video. Import runs in Trigger, checks the source approval and full
   R2 hash, copies the original bytes into this project's prefix and verifies the
   copied hash. The plan keeps a human-readable video script separate from the
   direct video-generation prompt, and gives image creatives their own direct
   prompt. Each calendar item has an editable proposed local time, CTA and
   confirmed promotion; creating its review draft preserves that local time and
   appends distinct CTA, promotion and hashtags to the draft copy. It remains a
   draft, not a scheduled or published post.

   `/marketing` routes H3 video and Qwen image requests only through the newer
   Hyper GPU service's live request guide and immutable quality profile. The
   worktree includes project-scoped idempotent job submission behind the live
   readiness gates, plus a durable Trigger watcher for jobs linked to a brief.
   The watcher records provider state and, when a completed output receipt is
   available, starts the existing hash-verified R2 import automatically. Its
   bounded backoff observation window uses Trigger durable waits; it never
   submits a render itself. Staging is always side-effect-free. A separate
   submit action rechecks readiness and requires one-time owner confirmations
   for the exact request hash, media rights, and configured generation
   allowance; the authorization is recorded with the brief. The live catalogue currently reports no qualified
   marketing model, and no project connection, capacity, enforceable spend
   control or verified delivery path is available, so production remains staged
   and no GPU job is submitted. H3 currently accepts
   prompt-only landscape video. Qwen accepts prompt-only PNG images with
   guide-approved 2K dimensions; the optional reference-image handoff is not
   wired yet. The separate `/work` creative tools do not provide the Media Engine
   marketing request path.

The new service catalogue reports the initial and future hardware profile and
model-specific qualified GPU types. As checked on 28 October 2026 it reported
`rtx3090` initially, `rtx5090` as future hardware, and no native-qualified model
routes. The UI reads that catalogue live; neither GPU name implies available
capacity or permission to render. Refresh and verify model qualification before
any pilot.
5. Generate a structured two-week strategy and calendar when the configured
   Codex subscription worker and owner AI gate are available. Items include
   channel copy, hashtags, proposed local times, CTAs, confirmed promotions,
   video scripts and direct Hyper prompts. The current production worker login
   and AI gate are not qualified; until they are, the app must report that
   limitation and must not present fallback brand templates as AI output.
   Drafts remain editable and versioned before exact-version approval. Future
   weekly posts on an active Automatic channel use its authorised policy.
6. Prepare a Search or Meta website campaign. Review the actual copy, account,
   destination, creative, countries, keywords, duration and maximum exposure.
   Approve its exact version separately. Google/Meta account currency, selected
   scope and Meta Page access are checked before dispatch.
7. Review native publication links, provider-reported metrics, first-party events
   and failures. Scheduling acceptance is never reported as publication.

The generation allowance is stored independently. The current marketing
generator consumes zero; it neither spends that allowance nor implicitly grants
the separate paid creative workflow permission to render.

## One provider and its cost boundary

Zernio is the sole implemented publisher and ad adapter. Its current official
contracts cover the required organic networks and Google/Meta ads. Buffer did
not cover the complete required network/reporting combination in the assessment.
Postiz Cloud is the organic fallback if real Zernio qualification fails; a second
publisher is not implemented. Self-hosting Postiz/Mixpost or adding n8n would add
operations and another scheduler to the existing Trigger stack.

Pricing checked on 28 October 2026: the first two active connections are free;
connections 3–10 cost $6 each, 11–100 cost $3 each, and later accounts cost $1
each; rates are graduated. Profiles are free and ad accounts count as connections.
The page refuses a new connection when its projected account base would exceed
the $30/month target. X API usage is separate: a regular post costs $0.015, a
post with a URL costs $0.20, and resource reads cost $0.005. The first 500 active
managed ads are free, then each running or in-review ad costs $0.01/month; Zernio
does not take a percentage of platform ad spend. The implementation reserves a
small amount for X reads and managed-ad usage before scheduling. See [official
pricing](https://docs.zernio.com/pricing).

| Example | Base connection estimate, before usage/tax |
| --- | ---: |
| Two connections | $0/month |
| Five connections: Instagram, X, Reddit, Google Ads, Meta Ads | $18/month |
| Two projects with five dedicated connections each | $48/month; exceeds target |

Dedicated accounts for each future project cannot fit an unlimited number of
brands into $30. These are base estimates, not a forecast or invoice. X API
activity, managed ads beyond the free allowance, tax and platform ad spend can
raise the realized total.

Account refresh reads the team's billing count and current-period usage, not
only a potentially scoped API key's visible connections. The app enforces its
$30 USD integration allowance and requires an appropriate provider X cap when
billing information is present. It never raises caps or upgrades a subscription.
Tax, advertising-platform spend, generation, existing hosting, Trigger and R2
usage are separate. Actual recurring cost remains unqualified until a real
provider account's inventory and billing snapshot are read.

## Reliability and financial state

- Convex owns project isolation, versioned content, immutable approval snapshots,
  action records, spend reservations and conversion deduplication. Marketing reads
  are indexed and bounded; the UI scopes content to the selected project.
- Trigger owns one optional five-minute controller and bounded item/import tasks.
  The schedule is absent until explicitly configured. Permanent planning errors
  stop automatic retries and are visible; the operator can correct setup and retry.
- Provider creates use the original idempotency key. Ambiguous creates may replay
  only inside the provider's documented 24-hour guarantee (23-hour local cutoff)
  against the same approved snapshot. Otherwise an operator must locate the
  original receipt; a new create is not silently issued.
- Ads are created PAUSED, their IDs are persisted, then authority and the approval
  hash are rechecked before activation. Fresh native switch reads are required to
  claim running/stopped status. Recently stopped ads remain under reconciliation.
- Pause cancels local queued work and requests remote cleanup for admitted work.
  Channel policy changes invalidate queued approvals. A near-due deleted schedule,
  ambiguous creation, expired access or failed cleanup remains unconfirmed.
- Unresolved ad exposure carries into a later month's admission check. A stopped
  campaign's unused hold is released only after an operator confirms its final
  platform invoice and a fresh native stopped-state read. This attestation remains
  distinct from API metrics. Later additional reported charges remain visible.
- Signed webhook deliveries are deduplicated by immutable event ID. Delayed
  authenticated retries are accepted. Events wake authoritative reconciliation;
  they do not overwrite state out of order. Provider sample events are inert.
- X insights refresh weekly to bound paid reads; other organic insights refresh
  daily. Active ads reconcile every five minutes, subject to reporting delays.
  Unavailable metrics display as unmeasured rather than invented zero results.

## First-party conversions

The website's trusted server sends `/api/marketing/conversions` a Bearer project
credential and `{ projectId, eventId, event, itemId?, valueMinor, currency,
occurredAt }`. Do not install the credential in browser code. Send the real
signup, lead or purchase event's stable ID and millisecond event timestamp.
Generated URLs use the marketing item ID as `utm_campaign` and the project ID as
`utm_content`; persist that attribution through the website's conversion flow
and send it back as `itemId`. No names, emails, IPs or browser credentials are
accepted. These are authenticated first-party events, not independent payment
settlement or cross-platform attribution claims.

## Rollout and exact activation requirements

Deploy the new Convex functions and web/Trigger code with all marketing dispatch
flags disabled. Keep the existing creative gateway service token and private
operator authentication. No schema reset or legacy-data rewrite is required.

Server credentials:

- `MEDIA_ENGINE_CONVEX_SERVICE_TOKEN`: shared server/Convex capability, existing
  media-engine vault fallback supported. Never expose it to the browser.
- `ZERNIO_API_KEY`: existing owned Zernio account key in the media-engine vault or
  server environment. OAuth buttons may create project profiles through this
  key; they never create a Zernio team, subscription or social identity.
- `MEDIA_ENGINE_PUBLIC_ORIGIN`: canonical bare HTTPS origin used by the signed
  provider callback. Do not build OAuth return URLs from request Host headers.
- `ZERNIO_WEBHOOK_SECRET`: Vercel server environment, at least 32 characters.
- Existing Media Engine Trigger credential and Cloudflare R2 credentials.

Dispatch configuration, disabled/absent initially:

- `MARKETING_ZERNIO_QUALIFIED=true` only after actual account/contract qualification.
- `MARKETING_AUTHORISED_ACCOUNT_IDS`: exact authorised connection IDs.
- `MARKETING_PUBLISH_ENABLED`, `MARKETING_ADS_ENABLED`,
  `MARKETING_METRICS_ENABLED`: enable only the specifically approved capabilities.
- `MARKETING_PRICING_VERIFIED_AT`: reviewed current pricing timestamp; expires
  after 30 days. Configure/read back the provider X cap within the remaining budget.
- `MARKETING_AUTOMATION_ENABLED=true`: deploy the single production controller
  only when the above configuration and the selected pilot are authorised.

Before any public/paid pilot, obtain its real project URL, account IDs, approved
copy/assets, permitted Reddit community and explicit content/ad allowances.
Human OAuth, business verification and platform billing setup remain necessary
where required. Creating social identities and ad accounts automatically is
not supported by the platforms; their existing accounts must be authorized by
the owner.

Live qualification must prove a native publication URL per required network;
actual Search/Meta paused creation, authorised activation, native pause and spend
reporting; signed webhook recovery; and private R2 delivery with auth, expiry,
CORS and video Range/seek behavior. Fixtures and scheduling receipts cannot prove
these. Account-level publishing/advertising remains gated until that approval.

## Validation

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run check:marketing-cost`,
`npm run build`, and actionlint for `.github/workflows/ci.yml`. Trigger bundles
can be checked with `npx trigger.dev deploy --dry-run --skip-sync-env-vars` without
deploying or executing tasks.

`scripts/verify-marketing-local.mts` exercises the real Next API and anonymous
local Convex backend using explicit local account/status/invoice fixtures. It
refuses cloud backends or enabled live flags. It verifies onboarding, website
inspection, draft editing/approval, campaign preview, billing recovery, two-project
isolation, conversion deduplication, access checks, mobile layout and local pause.
It never proves real provider publishing, spend or invoicing.

The workspace-wide cloud guard also reports pre-existing legacy full-table
readers. They were not hidden behind scan exceptions. The new marketing CI guard
enforces this change's query boundary; no production savings are claimed from
source checks alone.

## Personal workspace and overview

The new interface follows `docs/design/marketing-onboarding-reference.png`, generated
with the built-in GPT Image tool. A real three-step form imports website metadata,
selects connected accounts, and confirms facts, cadence and independent limits.
Onboarding retries use an immutable request key; the same server-derived conversion
credential and project are recovered instead of creating a duplicate. A saved brief
can be edited while automation is stopped, with optimistic version checking and
retirement of old drafts/approvals. Pending remote cleanup blocks an edit.

The overview at `/marketing#overview` shows a widget for each onboarded marketing
project. Transactional lifetime counters preserve publication, metrics, advertising
and first-party conversion totals across repeated deliveries. Active campaign counts
require a recent native status timestamp; old status is shown as needing attention.
The minute bucket prevents cached query results from keeping an old status current.

Actual subscription/provider, generation and hosting charges can be recorded with an
invoice/receipt reference. Immutable reference checks prevent duplicates. Voiding
retains the audit row and reverses its category total once. These are operator-recorded
costs, not payments or automatic invoice verification. Currencies stay separate;
unknown hosting, generation and historic costs are excluded and disclosed. Current
provider usage is shown separately until reconciled against a recorded charge.
The library paginates uploaded media, content and recorded charges with indexed,
organization-scoped reads. It never scans the full history for each widget.

Project Hub's Media Engine carousel entry opens its `/media-engine` owner handoff.
It uses the existing Hub vault-control login, an isolated shared server secret and a
60-second audience-bound fragment code. Media Engine mints its usual HttpOnly owner
session; the existing operator token and service/provider credentials are unchanged.
`MEDIA_ENGINE_HUB_HANDOFF_SECRET` is server-only in both projects and both scoped vault
services. No credential is embedded in the tile URL or public browser bundle.

The existing live website uses `blissful-sardine-231`, labelled a development deployment
by Convex. Its named default production deployment is `grand-ferret-295`; it is not
used for this rollout. Always scope deployment to the backend actually used by the
website, rather than relying on the CLI's default production selection. No indexes
are removed. The live marketing-project table was empty before this rollout, so
lifetime counters begin at project creation without migrating old marketing history.

An internal administrator-only empty-draft cleanup function is deliberately absent
from the operator/service gateway. It refuses projects with any content, media,
connections, conversions, imports, recorded costs or activity, and is used to clean
up the exact empty production onboarding verification record.
