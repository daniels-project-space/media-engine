# OpenAI API-credit exposure audit — 2026-07-22

## Scope and immutable checkpoint

- Repository: `daniels-project-space/media-engine`.
- Canonical supplied branch: `jarvis/goal-make-daniel-s-entire-live-clou-rn8b1y61`.
- Audited head: `6de88578bc4ec91956087ddac5e096cff1b0be77`
  (`security: remove API image and provider paths`), whose remote branch head
  matched during this audit.
- This audit neither read, printed, exercised, nor changed a credential. It did
  not call an OpenAI endpoint or trigger any job.

## Checked-in execution graph

| Surface | Current status | Evidence |
| --- | --- | --- |
| OpenAI image generation | inert | `generate-carousel` keeps its existing task ID but immediately throws the explicit paused error; it has no vault, HTTP, R2, Convex mutation, or spend call. |
| Image-backed ad render | reachable only with an approved existing `imageUrl` and literal `aiEnabled === true` | `generate-ad` rejects generated/missing frames before its first vault read. Existing-image video rendering remains through Higgsfield/fal and its budget ledger. |
| Image route callers | inert for generated images | `/api/trigger` `generate` and `/api/clients` `generate` return 503; `/api/studio` rejects generated/missing-frame draft and final renders before Trigger dispatch. |
| Reasoning | reachable only through subscription Codex CLI | `src/lib/llm.ts` uses `codex exec --sandbox read-only`; `codexChildEnv()` clears `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, Anthropic variables, and `VAULT_ACCESS_TOKEN`. |
| Scheduler | fail-closed | `schedule-tick` has no `cron`, checks `aiEnabled()` before reading streams or the vault, and only then can enqueue the now-paused carousel task. |
| Campaign scheduler | reachable, separate | `campaign-tick` retains cron `7,22,37,52 * * * *`; it runs campaign orchestration, not an OpenAI client. |

`aiEnabled()` reads `settings.aiEnabled` from `https://blissful-sardine-231.convex.cloud` and returns true only for literal boolean `true`; Convex failures return false. The current production health read observed `aiEnabled: false` and `liveMode: false`.

## Deployment and provider mapping

| Provider/surface | Identifier or route | Retrieval/proxy status |
| --- | --- | --- |
| Vercel | `https://media-engine-seven.vercel.app` | Public canonical hostname is reachable. No `vercel.json`, `.vercel` project metadata, rewrites, redirects, or alias configuration is committed. |
| Current public deployment | `/api/health`, `/api/capabilities` | **Stale / not cut over.** Public reads at 2026-07-22T15:35Z returned the old `brain: {cli, apiToken, ready}` shape and `provider: "anthropic (Claude subscription)"`; the audited source returns `Trigger Codex CLI` and `Codex CLI (ChatGPT subscription)`. It therefore cannot include `6de8857`. |
| Convex application | `https://blissful-sardine-231.convex.cloud` | Reached indirectly by the public health route; source reads settings, posts, campaigns, and other application data through `ConvexHttpClient`. No source proxy aliases it. |
| Central vault | `https://fantastic-roadrunner-485.convex.cloud` | `vaultService()` is the only vault client and requires `VAULT_ACCESS_TOKEN`; it retrieves named services only. Current paths no longer request service `openai`. |
| Trigger.dev | project `proj_snvnjoxqowcfsutewkzz`; `https://api.trigger.dev/api/v1/tasks/<task>/trigger` | Vercel route bridges and Trigger tasks are reachable only if the Trigger vault key is present. `trigger.config.ts` syncs only `VAULT_ACCESS_TOKEN`; no OpenAI key is synced. Provider-side deployed task revision/schedules could not be inspected without controller access. |
| Cloudflare R2 | bucket `media-engine` | `storage.ts` uses the AWS S3 SDK plus vault `cloudflare` values. `/api/media/[...key]` is the sole committed R2 retrieval proxy: allowed prefixes redirect (302) to a one-hour presigned URL. |
| Supabase | none in the repository | No SDK, URL, function, manifest, or proxy reference was found, so no Media Engine Supabase function is deployable from this checkout. |
| Other external providers | fal, Higgsfield, ElevenLabs, Resend, Meta/Instagram, Shopify, Ayrshare/Postiz, Stripe, Microlink, DataForSEO/Serper, Smartlead, Modash | Some existing non-OpenAI integrations remain reachable behind their established vault and live/dry-run gates. They are not evidence of an OpenAI path. |

The only committed cross-project external browser asset is the JARVIS embed script at `jarvis-orcin-six.vercel.app`; it is not an API proxy or credential path in this application.

## API reachability map

- Read-only: `GET /api/health`, `/api/capabilities`, `/api/campaign`,
  `/api/client`, `/api/clients`, `/api/crossmarket`, `/api/services`,
  `/api/store`, and `/api/media/[...key]` (the last is an R2 redirect).
- Mutating/dispatch-capable: `POST /api/campaign`, `/api/client`,
  `/api/crossmarket`, `/api/repurpose`, `/api/store`, `/api/studio`,
  `/api/subscribe`, `/api/tick`, `/api/trigger`, and `/api/upload`.
- Explicitly paused: `POST /api/clients` image generation, `POST /api/leads`,
  and `/api/trigger` image generation. `POST /api/persona-plan` remains a
  direct reasoner caller only behind the false-by-default AI gate.

No endpoint in the current source calls an OpenAI HTTP host, imports an OpenAI
SDK, asks `vaultService("openai")`, or inherits an OpenAI API key into the
reasoning child process. Package dependencies contain no OpenAI, Anthropic, or
Mastra runtime SDK.

## Required controller handoff

The public deployment mismatch is the live blocker. The delivery controller
must deploy commit `6de8857` (including Trigger synchronization) and then
re-read `/api/health` and `/api/capabilities`; the expected post-deploy shapes
are `brain.runtime: "Trigger Codex CLI"` and provider `"Codex CLI (ChatGPT subscription)"`.
After deployment, the authorized controller must use its provider/vault audit
capability to remove the unused central-vault `openai` service and verify the
Trigger production schedule/task revision. No credential value is needed for
that verification.
