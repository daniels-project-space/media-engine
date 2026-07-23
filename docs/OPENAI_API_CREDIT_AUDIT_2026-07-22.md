# OpenAI API-credit exposure audit — 2026-07-22

## Scope and immutable checkpoint

- Repository: `daniels-project-space/media-engine`.
- Canonical supplied branch: `jarvis/goal-make-daniel-s-entire-live-clou-rn8b1y61`.
- Original containment head: `6de88578bc4ec91956087ddac5e096cff1b0be77`
  (`security: remove API image and provider paths`). The latest source-verified
  head before this evidence-only checkpoint was `853432b security: scope media vault capabilities`, and it matched
  `origin/jarvis/goal-make-daniel-s-entire-live-clou-rn8b1y61` exactly.
- This audit neither read, printed, exercised, nor changed a credential. It did
  not call an OpenAI endpoint or trigger any job.

## Checked-in execution graph

| Surface | Current status | Evidence |
| --- | --- | --- |
| OpenAI image generation | inert | `generate-carousel` keeps its existing task ID but immediately throws the explicit paused error; it has no vault, HTTP, R2, Convex mutation, or spend call. |
| Image-backed ad render | reachable only with an approved existing `imageUrl` and literal `aiEnabled === true` | `generate-ad` rejects generated/missing frames before its first vault read. Existing-image video rendering remains through Higgsfield/fal and its budget ledger. |
| Image route callers | inert for generated images | `/api/trigger` `generate` and `/api/clients` `generate` return 503; `/api/studio` rejects generated/missing-frame draft and final renders before Trigger dispatch. |
| Reasoning | reachable only through subscription Codex CLI | `src/lib/llm.ts` uses `codex exec --sandbox read-only` with a fresh, mode-0700 `CODEX_HOME` created from the strict `CODEX_AUTH_JSON_B64` ChatGPT bundle; `codexChildEnv()` clears API, vault, access-token, and bundle variables. |
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
| Trigger.dev | project `proj_snvnjoxqowcfsutewkzz`; `https://api.trigger.dev/api/v1/tasks/<task>/trigger` | `trigger.config.ts` synchronizes only `CODEX_AUTH_JSON_B64`; it synchronizes no vault or OpenAI/API-key variable. The bundle is consumed only by the CLI launcher and never inherited by Codex. Provider-side deployed task revision/schedules could not be inspected without controller access. |
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

## Session 5 Codex authentication boundary

`src/lib/llm.ts` now treats `codex login status` as an authentication gate, not
merely an availability check. Trigger synchronizes only `CODEX_AUTH_JSON_B64`;
the decoded bundle must be an exact `auth_mode: "chatgpt"` envelope with the
expected ChatGPT token container. It rejects API-key, access-token, ambiguous,
or malformed bundles before creating files or spawning Codex. Each invocation
writes the validated CLI auth file and a ChatGPT-forcing config into a fresh
mode-0700 home, mode-0600 files, and removes that home afterward. The command
uses that home with an allowlisted child environment and accepts only its exact
successful stdout line, `Logged in using ChatGPT`; help text, diagnostics,
API-key, access-token, unknown, missing, and unreadable statuses fail closed.
The subsequent `codex exec` also passes the CLI's
`forced_login_method="chatgpt"` restriction as defense in depth, is ephemeral,
and passes `--ignore-rules`.

The child environment remains a fresh allowlist and explicitly blanks OpenAI,
Codex API/access-token, Anthropic, base-URL, and vault-token variables. No
fallback is attempted after an authentication failure; the caller gets the
explicit unavailable error.

Local verification at this checkpoint: `npx tsc --noEmit`, the production
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build`,
and `git diff --check` passed. Focused parser cases accepted only the exact
ChatGPT authenticated status and rejected API-key, access-token, ambiguous,
help, and arbitrary ChatGPT-containing status text.
`npm run lint` continues to fail solely on the existing
`react-hooks/set-state-in-effect` errors in Settings and Stores.

At this session's 2026-07-22 bodyless, read-only production recheck, both GETs
again returned HTTP 200 from Vercel: health reported `brain.runtime: "Trigger Codex CLI"`,
`aiEnabled: false`, and `liveMode: false`; capabilities reported both model and
provider as `Codex CLI (ChatGPT subscription)`. No provider task, vault,
credential, image, or dispatch route was invoked. The controller-only Trigger
revision/schedule and central-vault deletion checks above remain outstanding.

## Session 6 vault capability narrowing

The central-vault wrapper is now a Media Engine capability boundary rather than
a generic `listByService` client. `src/lib/vault.ts` accepts only the 16
explicit service names consumed by current Media Engine callers; `openai` is
not in that set and an unrecognised name throws before any vault request is
made. The generic vault writer was also reduced to the two Higgsfield token
rotation fields used by `src/lib/higgsfield.ts`.

The only formerly data-selected vault lookup was the social-account
`tokenService` field in `schedule-tick` and `publish-post`. It now accepts only
the dedicated `media-engine-accounts` bucket (or its legacy missing default),
and the Convex account mutation/schema enforce the same value. At
2026-07-22T16:23Z, a read-only live Convex inventory showed all four accounts
as unlinked, with no token key and no configured token service; the restriction
therefore preserves the active configuration while preventing a persisted edit
from selecting `openai` or any other cross-project vault service.

Focused runtime guard cases accepted permitted `fal`, `trigger`, and
`media-engine-accounts` names and rejected `openai`, `anthropic`,
`project-hub`, and an empty name; the account resolver likewise rejected
`openai`. `npx tsc --noEmit` passed and the production
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build`
completed successfully. A source scan found no OpenAI host, image-generation
endpoint, image model, or `vaultService("openai")`; the sole remaining
`OPENAI_API_KEY` text explicitly blanks that environment variable in the
Codex-child allowlist. `npm ls openai @ai-sdk/openai @ai-sdk/anthropic
@mastra/core --depth=0` returned an empty tree and `git diff --check` passed.

At the same time, bodyless public GETs to the canonical Vercel alias returned
HTTP 200 with `brain.runtime: "Trigger Codex CLI"`, provider/model `Codex CLI
(ChatGPT subscription)`, `aiEnabled: false`, and `liveMode: false`. No
provider task, image route, vault query, or credential was invoked by this
check. Provider-side least-privilege receipts remain controller-owned. This
source boundary neither synchronizes a vault capability to Trigger nor permits
an `openai` vault-service request.

## Session 7 exact-head and live recheck

At 2026-07-22T16:28Z, the supplied branch and its origin both resolved to
`853432b security: scope media vault capabilities`; the worktree was clean.
Bodyless, read-only GETs to the canonical Vercel alias returned HTTP 200 with
`server: Vercel` and matched paths `/api/health` and `/api/capabilities`.
Health reported `brain.runtime: "Trigger Codex CLI"`, `aiEnabled: false`, and
`liveMode: false`; capabilities reported model and provider `Codex CLI (ChatGPT
subscription)`. The legacy `apiToken`, Claude, and Anthropic response fields
were absent. The health inventory reports 29 retained posts, but no read or
request was made to a mutation, image, Trigger, vault, or provider endpoint.

The checkout was restored from its lockfile and `npx tsc --noEmit` passed.
The production build compiled and completed its TypeScript phase; the runner's
per-command limit interrupted the static-page tail before a final exit receipt,
so this session does not overstate it as a completed build. A runtime-source
scan found no OpenAI host, image-generation endpoint/model,
`vaultService("openai")`, or direct OpenAI import, and `npm ls openai
@ai-sdk/openai @ai-sdk/anthropic @mastra/core --depth=0` returned an empty
tree. `git diff --check` passed. Lint still fails only on the existing
`react-hooks/set-state-in-effect` errors in `src/app/settings/page.tsx:28` and
`src/app/stores/page.tsx:22`.

The remaining live work is authenticated provider state, not a source alias:
the delivery controller must retain name/status-only receipts that the deployed
Trigger `schedule-tick` revision has no declarative schedule, replace the
inherited vault capability with a Media-Engine-only capability, and delete then
re-read the unused central-vault `openai` service. This scoped checkout cannot
perform or observe those mutations without provider authority; no credential
was read, copied, retained, or exercised here.

## Session 8 negative probes and historical-spend reconciliation

At `2026-07-22T16:34:53Z` and `16:34:54Z`, bodyless public GETs to the
canonical Vercel alias again returned HTTP 200 with `server: Vercel` and the
contained response shapes: health reported `brain.runtime: "Trigger Codex
CLI"`, `aiEnabled: false`, and `liveMode: false`; capabilities reported model
and provider `Codex CLI (ChatGPT subscription)`. The old API-token, Claude,
and Anthropic fields were absent.

Two bounded negative probes followed, with no authentication material and no
provider invocation: `POST /api/trigger` with only `{"action":"generate"}`
returned HTTP 503 and the explicit image-workflow-paused response before any
vault or Trigger call. `POST /api/clients` with the same body returned HTTP 503
while the false AI gate was active; its source performs no task, vault, storage,
or provider operation on that branch. These probes did not create a task run,
image, post, spend row, or any external side effect.

The two cited historical ledger dates reconcile exactly through the public
read-only `spend:forDay` Convex query:

| UTC day | OpenAI pence | Other services pence | Daily total | Events |
| --- | ---: | ---: | ---: | ---: |
| 2026-07-03 | 16 | fal: 40 | 56 | 3 |
| 2026-07-04 | 392 | elevenlabs: 85; fal: 818; higgsfield: 0 | 1,295 | 125 |
| **combined** | **408** | **943** | **1,351** | **128** |

Thus `16p + 392p = 408p` is a historical OpenAI subtotal, not a new charge or
a current caller. The aggregate query exposes only totals, service buckets,
and event counts; it did not read any credential or mutate the ledger.

The source-side repair edges are closed: the canonical deployment serves the
contained revision, image routes reject before dispatch, `schedule-tick` has no
declarative cron and fails closed, `generate-carousel` aborts before I/O, and
the vault capability allowlist excludes `openai`. The remaining provider-side
repair edges are explicitly controller-owned: (1) retain a name/status-only
receipt that Trigger production has synchronized the no-cron `schedule-tick`
revision, (2) replace the inherited vault token with a Media-Engine-only
capability without exposing its value, and (3) delete and re-read the unused
central-vault service named `openai`. They must not be substituted with a task
or provider test invocation.

After a clean lockfile install restored this checkout's missing local toolchain,
`npx tsc --noEmit` and the production `NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run build` both passed to completion. The runtime-source scan again found no OpenAI host, image endpoint/model,
`vaultService("openai")`, or direct SDK import; the direct dependency audit was
empty and `git diff --check` passed. `npm run lint` remains independently
blocked by the two pre-existing `react-hooks/set-state-in-effect` errors in
`src/app/settings/page.tsx:28` and `src/app/stores/page.tsx:22` (plus warnings).

## Session 9 legacy Supabase and provider-account closure boundary

At 2026-07-22T18:34Z, a read-only GET to the canonical production alias
`https://media-engine-seven.vercel.app/api/health` returned HTTP 200 with
`server: Vercel`, `brain.runtime: "Trigger Codex CLI"`, `aiEnabled: false`,
and `liveMode: false`. The companion `/api/capabilities` response named only
`Codex CLI (ChatGPT subscription)` as its model and provider. These public
reads do not expose, inspect, or exercise credentials.

The complete tracked executable surface (`src`, `convex`, `next.config.ts`,
and `trigger.config.ts`) has no Supabase client/import, URL, edge-function
path, environment alias, deployment manifest, or SDK dependency. A permanent
security regression now fails if any of `@supabase/*`, `supabase`, a
`SUPABASE_*` credential alias, a Supabase project host, or `/functions/v1/`
returns to executable code. It also checks the vault allowlist has no
OpenAI-derived service alias and verifies representative `openai`,
`open-ai`, and `openai-platform` names reject before DNS or fetch.

No account capability was attached to this checkout for the Supabase project,
Vercel alias inventory, central vault, Trigger, OpenAI Platform, or the
ChatGPT/Codex billing controls. Accordingly this session cannot claim a
provider receipt that a legacy Supabase function was disabled, that every
deployed runtime/vault alias contains no usable OpenAI key, that OpenAI
Platform pay-as-you-go is disabled, or that Codex automatic top-up is off.
No credential was read, printed, copied, or attempted.

The exact remaining controller/account gate is a Daniel-authorized,
name/status-only provider audit with authority to disable the identified
legacy Supabase function/copy and revoke any OpenAI Platform keys. It must
retain receipts for: (1) all Vercel production/preview aliases and their
environment-key names, (2) all Media-Engine vault service/key aliases after
deleting and re-reading `openai`, (3) Supabase project/function state showing
the legacy function is unreachable, (4) OpenAI Platform key metadata showing
no active usable key and billing showing pay-as-you-go/auto-recharge disabled,
and (5) ChatGPT/Codex billing showing automatic top-up disabled. Values must
remain redacted; a non-billable task probe is not a substitute for these
receipts.

## Session 10 deployed-revision discrepancy — do not use task probes

At 2026-07-22T19:40Z, the canonical production alias returned HTTP 200 for
the read-only health endpoint, with `aiEnabled: false`, `liveMode: false`, and
the brain identified as `Trigger Codex CLI`. Its read-only capabilities
document still names `Codex CLI (ChatGPT subscription)` as both model and
provider. These reads expose no credential values.

The deployed application nevertheless did **not** match this checkout's
fail-closed route source: unauthenticated `POST /api/tick` returned HTTP 202
and a Trigger run identifier, while `POST /api/crossmarket` returned HTTP 200.
Current source returns HTTP 503 before any vault, Trigger, Convex, or CLI work
when `aiEnabled()` is false for both routes. No further mutating endpoint or
task probe was made after observing the discrepancy. The controller must
inspect and, if still pending, cancel the returned tick run using its Trigger
capability; it must then deploy the contained revision before treating any
provider or billing receipt as evidence of the current source.

This checkout has no Media-scoped vault token or provider-management
capability. Its runner environment also contains ambient `OPENAI_API_KEY` and
`CODEX_API_KEY` variable names; their values were neither read nor emitted,
and `codexChildEnv()` explicitly blanks both before every Codex process. This
is not evidence about Vercel or Trigger environment scopes. The required
name/status-only controller audit remains: remove OpenAI aliases from every
Vercel and Trigger scope, replace the vault capability with a Media-only
token, delete then re-read `openai`, retire the legacy Supabase function, and
retain OpenAI Platform plus ChatGPT/Codex billing receipts showing no usable
key or automatic recharge. Until those receipts and the contained deployment
exist, the provider-account definition of done is not met.

## Session 11 reachable-route correction and production re-read

On 2026-07-23T01:54Z, the canonical production alias again returned HTTP 200
for `GET /api/health`; it reported `server: Vercel`, `aiEnabled: false`,
`liveMode: false`, and `brain.runtime: "Trigger Codex CLI"`. Its read-only
`GET /api/capabilities` response still identified both model and provider as
`Codex CLI (ChatGPT subscription)`. These requests did not invoke a task,
vault, provider, or credential endpoint.

Caller tracing found no repository caller of `GET /api/tick`, but the route
had implemented GET as `return POST()`. That made ordinary GET requests an
alternate Trigger dispatch path whenever AI was enabled. GET now returns HTTP
405 with `Allow: POST` before the AI gate, vault, Trigger, Convex, Codex, or
any provider is contacted. The security regression test denies DNS and fetch
and verifies that exact status, header, and response body.

This is a source-level correction only. The production alias cannot be tied
to this contained revision from this checkout: the previous POST discrepancy
remains proof it is stale until the delivery controller deploys this revision
and repeats the bounded negative POST probes while `aiEnabled` is false.
Provider-side completion remains outstanding: name/status-only Vercel and
Trigger environment inventories, Media-only vault capability replacement and
deletion/re-read of `openai`, legacy Supabase retirement, revoked OpenAI
Platform keys, and OpenAI/ChatGPT/Codex billing controls showing no API
recharge. Do not treat this route test or public reads as substitutes for
those provider receipts.

## Session 12 exact-head negative re-probe

At 2026-07-23T02:12Z, the supplied branch, `origin`, and the preserved
lineage remote all resolved to
`c6825035a7cf2fb3423cb088bfaa57a69627f7cf` (`security: prevent tick GET
dispatch`). The worktree was clean before this evidence update. The source
returns HTTP 405, `Allow: POST`, and `{ ok: false, error: "method not
allowed" }` for `GET /api/tick` without consulting the AI gate, Convex, vault,
Trigger, Codex, or any provider.

A new bodyless public `GET https://media-engine-seven.vercel.app/api/tick`
instead returned HTTP 503 from Vercel (`x-matched-path: /api/tick`) with
`{ "ok": false, "error": "AI generation is paused" }`. That is safe while
the public `aiEnabled` setting is false, but it proves the canonical alias is
not yet serving this exact head: it still executes the predecessor GET-to-POST
shape. In the same read-only recheck, `/api/health` reported
`brain.runtime: "Trigger Codex CLI"`, `aiEnabled: false`, and `liveMode:
false`; `/api/capabilities` reported model and provider
`Codex CLI (ChatGPT subscription)`. No POST, task endpoint, vault endpoint,
or credential-bearing provider endpoint was invoked.

Current-head verification passed: `npm run test:security` (14/14, including
the DNS/fetch-denied GET regression), `npx tsc --noEmit`, and
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run
build` (generated `.next/BUILD_ID`). `git diff --check` passed. The security
suite confirms no runtime OpenAI client/host/model path, rejects `openai`
before DNS/fetch, and clears API/vault/access-token variables from Codex child
processes.

The only valid next action is controller-owned: promote this exact revision to
the canonical Vercel alias, verify the deployed Trigger revision and its
no-cron `schedule-tick` state, then repeat the bounded disabled negative POST
probes. Retain the required redacted provider receipts for Vercel/Trigger
environment-key names, Media-only vault capability plus deletion/re-read of
`openai`, legacy Supabase unreachability, revoked OpenAI Platform keys, and
disabled API/ChatGPT/Codex recharge controls. This checkout has no authority
to inspect or change those provider states.

## Session 13 canonical-alias re-read

At 2026-07-23T02:41Z, the supplied branch and its `origin` tracking ref both
resolved to `db230bce701bdd55bf10081e47bd16ba82e2071b`; the corrective
`c6825035a7cf2fb3423cb088bfaa57a69627f7cf` is an ancestor of that exact head.
The one configured repository remote is
`https://github.com/daniels-project-space/media-engine.git`. No source change
was indicated by this re-read.

Three bodyless, read-only requests to the canonical Vercel alias returned
`server: Vercel` and `x-matched-path` values for the requested routes. Health
returned HTTP 200 with `brain.runtime: "Trigger Codex CLI"`, `aiEnabled:
false`, and `liveMode: false`; capabilities returned HTTP 200 with model and
provider `Codex CLI (ChatGPT subscription)`. `GET /api/tick` returned HTTP 503
with `{ "ok": false, "error": "AI generation is paused" }`, rather than
the exact-head HTTP 405 and `Allow: POST` response. Thus the canonical alias
still cannot be tied to the contained corrective head. No POST, Trigger,
vault, Convex mutation, Codex invocation, provider API, or credential endpoint
was called; repeating a POST while this stale alias can dispatch a run is not a
safe negative probe.

The controller must deploy this exact head to the alias before the bounded
disabled POST re-probe can establish the route-level claim. The independent
provider-account receipts listed above remain required to establish that no
deployed environment, vault record, legacy function, Platform key, or billing
control can consume OpenAI API credits. This checkout has neither the scoped
credentials nor authority to inspect or alter those states.

Final local verification on this exact source passed `npm run test:security`
(14/14), `npx tsc --noEmit`, and
`NEXT_PUBLIC_CONVEX_URL=https://blissful-sardine-231.convex.cloud npm run
build`; the resulting `.next/BUILD_ID` was `c0wScBCVcZSOS9glAl87B`.
`git diff --check` also passed.
