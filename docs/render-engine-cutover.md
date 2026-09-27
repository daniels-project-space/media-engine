# Media Engine render cutover gate

The current `generate-ad` consumer renders each approved footage beat from the
client's R2 reference image through Seedance 2.0, for 4–15 seconds at 9:16.
The frozen Convex plan requires `provider: higgsfield`,
`model: seedance_2_0`, and `creditSource: higgsfield_subscription`.

Render Engine's current project API exposes `POST /client/workflows` and
`POST /client/h3-jobs`. The latter accepts only `projectName`, `workflowId`,
and a text `prompt` for a five-second MiniMax H3 text-to-video clip. It has no
approved-image input, Seedance profile, clip length, or aspect-ratio field.
Setting `RENDER_ENGINE_PROJECT_API_URL` therefore makes both the public render
admission and Trigger worker fail before any Render Engine request. The old
Seedance MCP gate remains in force when that variable is absent.

Before enabling the cutover, Render Engine needs a qualified image-to-video
project workflow whose request binds an immutable approved reference object,
model, duration, and aspect ratio. Media Engine then needs its frozen plan and
credit ledger updated through an explicit policy change, project-scoped
capability and R2 output enrollment, a verified output receipt, and an
end-to-end approved-reference render check. No paid render is part of this
staged patch.
