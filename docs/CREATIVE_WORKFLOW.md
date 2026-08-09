# Client media workflow

The client-media path is intentionally separate from social posting and growth
automation. It is designed for Fiverr and direct orders where a human reviews
both the client conversation and every credit-consuming production decision.

## Operating sequence

1. Create a request in **Work** and select `Fiverr` or `Direct`.
2. Log the buyer's messages and attach their product/reference image. The app
   does not auto-message any marketplace buyer.
3. Run **Assess intake**. The assistant identifies only the production facts
   still required: goal, audience, benefit, delivery format, and reference.
4. Generate a plan. It persists a versioned narrative, storyboard, and exact
   provider policy before a render can be admitted.
5. Approve that plan. A version mismatch blocks dispatch.
6. Render a draft, review it, then render the final. The durable render ledger
   prevents duplicate-click charges, records the Trigger run and Higgsfield
   credits used, and supports an eligible retry after a provider failure.
7. Deliver the final manually after review.

## Generation policy

- Provider: Higgsfield
- Model: Seedance 2.0 (`seedance_2_0`)
- Credit source: the linked Higgsfield subscription only
- Inputs: a client-approved image is required for every non-card video beat
- Fallback: fail closed; no FAL, OpenAI image, ElevenLabs voice, or alternate
  video-model fallback is available to this workflow

The renderer re-signs the stored R2 reference image immediately before dispatch
so client approval does not expire with a temporary upload URL. It quotes the
Higgsfield credit cost and checks the balance before each video job.

## One-time connection setup

### Codex Desktop MCP

The project MCP configuration is in `.codex/config.toml`. In Codex Desktop,
open **Settings → MCP servers → Higgsfield → Authenticate**, then approve the
browser flow. The official provider page is <https://higgsfield.ai/mcp>.

That OAuth grant is persistent for this Codex Desktop installation and normally
refreshes itself. It can still require consent again if Higgsfield revokes or
invalidates the grant; no OAuth integration can safely promise otherwise.

### Deployed renderer

Desktop OAuth is intentionally not copied into Vercel or Trigger. The deployed
renderer needs its own `higgsfield` vault entry with both
`HIGGSFIELD_ACCESS_TOKEN` and `HIGGSFIELD_REFRESH_TOKEN`. The refresh token is
rotated and persisted by `src/lib/higgsfield.ts` after it is used. On the first
successful refresh, the app stores the rotating pair together as
`HIGGSFIELD_SESSION`; that prevents a cold worker from reading a mismatched
pair. Do not overwrite that generated session value.

The Vercel and Trigger runtimes also need `VAULT_ACCESS_TOKEN` with permission
to read and update that `higgsfield` vault entry; without it, rendering fails
closed instead of falling back to another paid provider.

Before enabling the private workspace in production, configure these shared
secrets without committing them to source:

- `MEDIA_ENGINE_OPERATOR_PASSWORD` and `MEDIA_ENGINE_SESSION_SECRET` in the
  hosting environment
- `MEDIA_ENGINE_CONVEX_SERVICE_TOKEN` in the hosting environment or the
  `media-engine` vault service, and the identical value in the media-engine
  Convex environment
- `MEDIA_ENGINE_CRON_SECRET` where the internal campaign heartbeat is invoked
- `VAULT_ACCESS_TOKEN` in both the hosting and Trigger environments so the
  renderer can rotate its Higgsfield session

Every private route and the Convex creative gateway fail closed when these are
missing. The System page reports configuration state only; it never exposes a
credential or starts a billable test render.

## Retired paths

`/clients`, `/studio`, `/api/clients`, and `/api/studio` no longer start an
unreviewed paid render. The UI pages redirect to Work and the APIs return 410.
The public lead form also no longer launches an AI reply automatically; drafting
occurs only from the private Leads workspace.
