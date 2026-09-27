# Media Engine render cutover gate

The current `generate-ad` consumer renders each approved footage beat from the
client's R2 reference image through Seedance 2.0, for 4–15 seconds at 9:16.
The frozen Convex plan requires `provider: higgsfield`,
`model: seedance_2_0`, and `creditSource: higgsfield_subscription`.

Render Engine's GPU project API exposes `POST /client/workflows` and
`POST /client/h3-jobs`. The latter accepts only `projectName`, `workflowId`,
and a text `prompt` for a five-second MiniMax H3 text-to-video clip. Its
hosted Seedance 1.5 Pro and 2.5 inputs are also text-to-video. None has an
approved-image input compatible with the frozen Media Engine plan.
Setting `RENDER_ENGINE_PROJECT_API_URL` therefore makes both the public render
admission and Trigger worker fail before any Render Engine render request. The old
Seedance MCP gate remains in force when that variable is absent.

`GET /api/render-engine/jobs?jobId=<32-character ID>` is an operator-only,
read-only client for Render Engine's authenticated `GET /client/jobs` endpoint.
Configure the Render Engine HTTPS origin as `RENDER_ENGINE_PROJECT_API_URL` and
store the 64-character `RENDER_ENGINE_PROJECT_TOKEN` server-side or under the
Media Engine vault service. An operator must first enroll `media-engine` with
its dedicated R2 bucket through Render Engine's operator API. Missing config
returns 503, a missing job returns 404, and no GPU work is started.

Before enabling the cutover, Render Engine needs a qualified image-to-video
project workflow whose request binds an immutable approved reference object,
model, duration, and aspect ratio. Media Engine then needs its frozen plan and
credit ledger updated through an explicit policy change, project-scoped
capability and R2 output enrollment, a verified output receipt, and an
end-to-end approved-reference render check. No paid render is part of this
staged patch.
