# Marketing MVP

This adds a project-oriented marketing surface at `/marketing` alongside the
existing client creative desk. It does not activate social publishing, paid
rendering or advertising merely by deploying the code.

## What was retained

The canonical release inspected on 28 October 2026 is main
`1f9d2d394e2b121bb52953c42dbb04add282647d`, deployed at
`https://media-engine-seven.vercel.app`. Production serves the client creative
workflow; the fuller creator-promotion interface/workers exist on another
branch. This change preserves that creative workflow and its approved Render
Engine route, Convex service gateway, Trigger project and Media Engine R2 bucket.
It does not revive the retired legacy distribution adapters.

## Operator workflow

1. Add a website URL. Import its bounded public metadata, then confirm the offer,
   audience, product facts, conversion goal, timezone and cadence. Metadata is
   untrusted input, not automatically certified product claims.
2. Set independent generation and advertising allowances in the project currency.
   Save the one-time conversion credential in that website's server secrets.
3. Connect owned accounts in Zernio, refresh the inventory and map connections to
   this project. Choose Off, Draft or Automatic. Automatic policies require an
   explicit authorisation, expire within 30 days and do not authorise individual
   paid campaigns. Reddit also requires an approved community.
4. Upload an original image with usage rights, or import a completed approved
   final video. Import runs in Trigger, checks the source approval and full R2
   hash, copies the original bytes into this project's prefix and verifies the
   copied hash. It launches no render. Existing approved video creation remains
   in `/work`, with its separate render approval and hosted-budget gates.
5. Prepare the first week. The initial generator is explicitly labelled **brand
   templates**, costs zero and uses confirmed facts. It is not an AI copy/image
   generator. Drafts can be edited and versioned before exact-version approval.
   Future weekly posts on an active Automatic channel use its authorised policy.
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
connections 3–10 cost $6 each, graduated. Ad connections count too. X URL posts
cost $0.20; resource reads cost $0.005. The implementation conservatively reserves
one cent per X analytics read and two cents per short new campaign for possible
managed-ad metering across billing periods. See [official pricing](https://docs.zernio.com/pricing).

| Example | Base connection estimate, before usage/tax |
| --- | ---: |
| Two connections | $0/month |
| Five connections: Instagram, X, Reddit, Google Ads, Meta Ads | $18/month |
| Two projects with five dedicated connections each | $48/month; exceeds target |

Two projects sharing those same five authorised connections, each posting about
13 X URL posts/month with up to five reads/post, reserve approximately $24.58
including four new short campaigns. This is an example, not the actual account
inventory or an invoice. Dedicated accounts for every future project cannot fit
an unlimited number of brands into $30.

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
  server environment. Do not create or subscribe to an account automatically.
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
where required. Universal automatic account creation is deferred.

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
