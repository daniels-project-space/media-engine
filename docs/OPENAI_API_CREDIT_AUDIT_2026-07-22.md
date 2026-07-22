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

## Follow-up route and alias check

At 2026-07-22T15:41Z, a new read-only request to the canonical production
`/api/health` and `/api/capabilities` endpoints still returned the pre-cutover
`apiToken`/`anthropic (Claude subscription)` response shape. No mutating route,
Trigger task endpoint, Vercel alias, or provider endpoint was invoked for this
check. The public deployment therefore remains an old build and is still the
only observed live OpenAI-key exposure risk for this repository.

The current source prevents the old aliases from dispatching work:

- `POST /api/trigger` with `action: "generate"` returns 503 before its first
  vault lookup; it cannot call Trigger's `generate-carousel` endpoint.
- `POST /api/clients` with `action: "generate"` returns 503 before any vault,
  storage, or Trigger call.
- In current source, a direct Trigger invocation of `generate-carousel` reaches
  only its explicit `AbortTaskRunError`; the task has no payload processing, vault
  access, provider HTTP request, storage write, Convex mutation, or spend write.

There is no committed Vercel alias, rewrite, redirect, `vercel.json`, `.vercel`
metadata, Supabase function, or Supabase SDK to disable from this checkout.
Trigger's deployed revision and Vercel aliases remain controller-only provider
state and must be disabled/replaced by deploying this branch; no credential was
read or used to attempt that operation.

## Continuation verification

At 2026-07-22T15:46:14Z, repeat read-only requests still showed that production
is the old build: `/api/health` contained `brain.apiToken: true`, while
`/api/capabilities` reported `provider: "anthropic (Claude subscription)"`.
Neither value exists in this branch's corresponding route output, so this is
deployment-version evidence, not a credential inspection. No dispatch-capable
endpoint was requested.

On the supplied branch at `54298a5`, `npx tsc --noEmit` and
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build`
passed. A source scan for an OpenAI host, image-generation endpoint/model,
`vaultService("openai")`, and OpenAI SDK import returned no matches; `npm ls
openai @ai-sdk/openai @ai-sdk/anthropic @mastra/core --depth=0` returned an
empty dependency tree. `git diff --check` also passed.

## Final live recheck and controller action

At 2026-07-22T15:49:33Z, read-only `GET`
`https://media-engine-seven.vercel.app/api/health` again returned
`brain: { cli: false, apiToken: true, ready: true }`. At 15:49:37Z,
read-only `GET /api/capabilities` again returned
`provider: "anthropic (Claude subscription)"`. Both responses were HTTP 200
from Vercel and neither matches this branch (`Trigger Codex CLI` / `Codex CLI
(ChatGPT subscription)`). These requests did not send a body or invoke a
mutating route, Trigger task, vault, or provider API.

Therefore source containment is verified but **live containment is not yet
complete**: the canonical production alias is still routed to a prior Vercel
deployment. This checkout has no committed alias configuration or provider
authority to replace that deployment. The delivery controller must deploy this
branch (which also synchronizes Trigger's removed `schedule-tick` cron), then
repeat only these two read-only checks and verify Trigger's production task
revision before removing the unused central-vault `openai` service. Do not
invoke the legacy image routes or any task to perform that verification.

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

## Session 4 live-alias recheck

At 2026-07-22T15:53:48Z, read-only `GET` requests to the canonical hostname
again returned HTTP 200 from Vercel. `/api/health` still contained
`brain: { cli: false, apiToken: true, ready: true }`; `/api/capabilities`
still reported `model: "claude-sonnet-5"` and
`provider: "anthropic (Claude subscription)"`. The current source cannot
produce any of those fields: its health route reports
`brain.runtime: "Trigger Codex CLI"`, and its capability manifest reports
`provider: "Codex CLI (ChatGPT subscription)"`.

This proves the canonical production alias has not yet moved to the contained
revision. The check sent no request body and did not request an image route,
legacy dispatch route, Trigger endpoint, vault, or OpenAI endpoint. A source
inventory also found no committed Vercel alias/rewrite configuration and only
three generated-image dispatch references: the guarded scheduler call and the
two `generate-ad` calls in `/api/studio`; the scheduler is fail-closed and all
studio calls reject missing/generated frames before dispatch. Controller
deployment plus Trigger revision/schedule verification remains the sole live
containment action.

On this checkpoint, `npx tsc --noEmit` and
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build`
passed. The exact source scan for an OpenAI host, images-generation endpoint,
`gpt-image-*` model, `vaultService("openai")`, or direct OpenAI SDK import had
no matches; `npm ls openai @ai-sdk/openai @ai-sdk/anthropic @mastra/core
--depth=0` returned an empty tree, and `git diff --check` passed. `npm run lint`
still exits 1 on the pre-existing `react-hooks/set-state-in-effect` findings in
`src/app/settings/page.tsx:28` and `src/app/stores/page.tsx:22`; it reports no
OpenAI-containment finding.

## Session 4 alias-closure evidence

At 2026-07-22T15:57:45Z and `15:57:46Z`, further bodyless, read-only GETs to
the canonical Vercel hostname returned HTTP 200 with `server: Vercel` and
matched paths `/api/health` and `/api/capabilities`, respectively. Health still
reported `brain: { cli: false, apiToken: true, ready: true }`; capabilities
still reported `model: "claude-sonnet-5"` and `provider: "anthropic (Claude
subscription)"`. Neither response can be produced by this branch, whose
equivalent route values are `brain.runtime: "Trigger Codex CLI"` and
`provider: "Codex CLI (ChatGPT subscription)"`.

This is direct, current evidence that the canonical alias remains on an older
deployment. It also reported `aiEnabled: false`, but that setting cannot
contain the stale build because the old build's source has not been proven to
enforce the current pre-vault guards. The requests had no body and did not call
an image/dispatch route, Trigger task, vault, OpenAI endpoint, or any other
provider operation.

At the time of the live check, the supplied branch and its origin both resolved
to `609bfe8638f983dc434e60d6df6b97f2cd0305e0`; therefore the blocker is not an
unpublished source containment commit. No committed Vercel project metadata, alias,
rewrite, redirect, or provider-management capability exists in this checkout.
Replacing or disabling that deployed alias is an external Vercel state change,
and this runner is expressly not authorized to deploy or exercise provider
credentials. The delivery controller must atomically promote this branch to the
canonical alias, sync the Trigger revision (removing `schedule-tick`'s cron),
then repeat only the two safe GET checks before deleting the now-unused central
vault `openai` service. Do not validate by invoking any legacy route or task.

## Session 4 canonical-alias closure confirmation

At `2026-07-22T16:02:42Z`, bodyless read-only GETs to the same canonical Vercel
hostname returned HTTP 200 with `server: Vercel` and `x-matched-path` set to
`/api/health` and `/api/capabilities`. This time the response shapes match the
contained source: health reported `brain: { runtime: "Trigger Codex CLI",
ready: false }`, `aiEnabled: false`, and `liveMode: false`; capabilities reported
both `model` and `provider` as `Codex CLI (ChatGPT subscription)`. The former
`apiToken` / Anthropic / Claude fields were absent.

This is direct public evidence that the canonical alias has been promoted away
from the prior OpenAI-capable deployment, without invoking an image route,
legacy dispatch route, Trigger task, vault, or provider API. The source route
handlers behind that alias have no OpenAI SDK, HTTP endpoint, vault service
lookup, or inherited API-key path. The alias-closure concern is therefore
resolved.

Two provider-side checks remain controller-only and must not be substituted with
a task invocation: verify that Trigger production has synchronized the contained
`schedule-tick` revision (which has no declarative cron and fails closed before
any vault read), then delete the unused central-vault `openai` service by name.
Neither provider state can be read or changed from this scoped checkout without
the delivery controller's authority.

Current local verification at this checkpoint: `npx tsc --noEmit` passed, and
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build`
completed successfully. A runtime-source scan (excluding audit prose and lock
metadata) for the OpenAI host, `/v1/images/generations`, `gpt-image-*`,
`vaultService("openai")`, and direct OpenAI SDK imports produced no matches.
`npm ls openai @ai-sdk/openai @ai-sdk/anthropic @mastra/core --depth=0` reported
an empty tree and `git diff --check` passed. `npm run lint` still fails only on
the existing `react-hooks/set-state-in-effect` errors at
`src/app/settings/page.tsx:28` and `src/app/stores/page.tsx:22` (plus warnings);
it reports no containment error.

## Session 4 supervisor follow-up — deployed schedule and vault boundary

At `2026-07-22T16:07:01Z`, bodyless, read-only GETs to the canonical hostname
again returned `HTTP 200`, `server: Vercel`, and `x-matched-path` values
`/api/health` and `/api/capabilities`. The health response reported
`brain.runtime: "Trigger Codex CLI"`, `aiEnabled: false`, and `liveMode: false`.
The capabilities response identified both its model and provider as `Codex CLI
(ChatGPT subscription)` and its safety capabilities explicitly say image
generation is paused. This confirms the canonical alias is still on the
contained Vercel deployment; no image, dispatch, Trigger, vault, or provider
route was invoked by these checks.

The current source leaves no caller able to dispatch an OpenAI image run:
`schedule-tick` has no `cron`, first checks the fail-closed setting before any
Convex or vault work, and its sole `generate-carousel` dispatch reaches a task
that immediately throws the paused error. `generate-ad` similarly rejects a
generated or missing frame before its first vault access. A full runtime-source
scan (excluding documentation and lock metadata) found no OpenAI host,
`/v1/images/generations`, `gpt-image-*`, `vaultService("openai")`, direct OpenAI
SDK import, or OpenAI package dependency.

The Trigger production revision/schedule inventory and the central-vault
service inventory are authenticated provider state. This checkout has no
Vercel, Trigger, Convex, or vault management capability, and credentials were
not read or exercised. Consequently it cannot honestly prove the removed
`schedule-tick` cron has synchronized, nor delete/re-read the unused central
vault service named `openai`. Do not use a task invocation as a substitute for
that proof. The delivery controller must make these two provider-side changes
and retain its name/status-only receipts: verify the deployed `schedule-tick`
revision has no declarative schedule, then delete the `openai` vault service.
