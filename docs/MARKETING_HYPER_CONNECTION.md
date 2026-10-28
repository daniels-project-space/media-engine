# New GPU service connection for marketing

The marketing workspace reads the new Hyper Render Service catalogue and can
inspect an existing project/job without creating GPU work. It does not submit
jobs, authorize spending, verify object bytes, or import the output yet.
Qualification of the renderer and the Media Engine integration are separate.

For a future private pilot, put `HYPER_RENDER_PROJECT_CONNECTIONS` in the
existing server-only `media-engine` vault service. Its value is a JSON object
keyed by the actual Convex marketing project ID; each value has `projectId`
(the Hyper project UUID), `token` (its project-scoped credential), `bucket`
(`media-engine`), and `prefix` (the exact output prefix returned by that
project's integration guide). Do not place tokens in source, browser inputs,
logs, or chat. Each marketing project must have a distinct Hyper project and
non-overlapping output prefix. A connection is only shown as verified after
the authenticated guide matches the configured project and storage scope.

The job lookup validates the project, job ID, generation, bucket and key
prefix in the returned receipt. A receipt is **not** independent proof of
object bytes. Before any final output is marked imported or available for
publishing, implement a project-bucket R2 readback and verify its length and
SHA-256 against that receipt. Preserve source ownership, rights checks,
retention, and scoped access. Do not use the previous Render Engine as a
fallback for new marketing renders.

Actual GPU submission remains gated on a concrete approved request and
spending authorization, a qualified native model/environment, available
capacity, and an idempotent durable action that reconciles uncertain writes.
No paid provider operation is performed by the connection check.
