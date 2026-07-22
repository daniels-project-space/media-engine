# Media Engine v2 — Media Service

_Updated 2026-07-22. This document describes the checked-in runtime, not a
deployment claim. See `OPENAI_API_CREDIT_AUDIT_2026-07-22.md` for the current
production cutover status._

## Product-aware media operations

- Shopify catalogue sync and deterministic product-to-channel mapping live in
  `src/lib/integrations/shopify.ts`, `src/lib/product-channels.ts`, and the
  `sync-store` task.
- Agent and tool metadata in `src/mastra/` is provider-neutral configuration
  used by the capability manifest. There is no Mastra SDK runtime or provider
  client in the dependency manifest.
- The asset-reuse graph records existing assets, derivations, and placements.
  Reframing and influencer handoffs preserve that lineage and still use their
  normal safety gates.

## Reasoning and generation boundaries

- Reasoning uses the subscription-authenticated Codex CLI only. `src/lib/llm.ts`
  executes `codex exec` in a read-only sandbox with a curated child environment
  that blanks API-key and vault-token variables. It has no HTTP provider
  fallback and never reads the vault.
- Image generation is explicitly paused. `generate-carousel` aborts before any
  vault, network, storage, or spend operation. Image-backed paths require an
  approved `imageUrl`; otherwise they return a visible paused error.
- Existing approved-image video rendering, deterministic cards, asset reuse,
  and normal product/research workflows remain separate. They retain their
  existing `aiEnabled`, budget, and live/dry-run gates.

## Control plane and status surfaces

- `GET /api/capabilities` returns the provider-neutral agent/tool manifest.
- `GET /api/health` reports control state without attempting a model call.
- `settings.aiEnabled` is fail-closed: only a literal boolean `true` permits
  provider-backed generation; an absent, malformed, or unreadable setting is
  paused.
- `schedule-tick` has no declarative cron and aborts before any work while AI is
  disabled. `campaign-tick` remains separately scheduled and governs only
  campaign-step orchestration.

## Going live

- A deployment must include the current branch before the source controls above
  are live. Do not infer deployed code or provider state from this document.
- Any live posting, discounts, email, or video work remains subject to its own
  key-presence, budget, `liveMode`, and human-approval controls.
