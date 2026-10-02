import assert from "node:assert/strict";
import test from "node:test";
import {
  getRenderEngineProjectJob,
  RenderEngineConfigurationError,
  RenderEngineResponseError,
} from "../src/lib/render-engine-client.ts";

const jobId = "a".repeat(32);
const token = "b".repeat(64);

function job(output = null) {
  return { jobId, status: output ? "completed" : "queued", profileId: "minimax-h3",
    lane: "h3", createdAt: 1, completedAt: output ? 2 : null, progress: null, output };
}

function withConfig(fn) {
  const oldUrl = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const oldToken = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://engine.example.convex.site";
  process.env.RENDER_ENGINE_PROJECT_TOKEN = token;
  return Promise.resolve().then(fn).finally(() => {
    if (oldUrl === undefined) delete process.env.RENDER_ENGINE_PROJECT_API_URL;
    else process.env.RENDER_ENGINE_PROJECT_API_URL = oldUrl;
    if (oldToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = oldToken;
  });
}

test("reads only the Media Engine project job with its server capability", () => withConfig(async () => {
  let calls = 0;
  const result = await getRenderEngineProjectJob(jobId, async (url, options) => {
    calls++;
    assert.equal(url.toString(), `https://engine.example.convex.site/client/jobs?projectName=media-engine&jobId=${jobId}`);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    assert.equal(options.cache, "no-store");
    return Response.json(job());
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "queued");
}));

test("invalid ID and missing configuration stop before network access", () => withConfig(async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("unexpected network call"); };
  await assert.rejects(getRenderEngineProjectJob("wrong", fetcher), RangeError);
  delete process.env.RENDER_ENGINE_PROJECT_API_URL;
  await assert.rejects(getRenderEngineProjectJob(jobId, fetcher), RenderEngineConfigurationError);
  assert.equal(calls, 0);
}));

test("a missing job stays missing and foreign output is rejected", () => withConfig(async () => {
  assert.equal(await getRenderEngineProjectJob(jobId, async () => new Response("", { status: 404 })), null);
  const foreign = { bucket: "another-project", key: `projects/x/workflows/y/jobs/${jobId}/h3-render.mp4`,
    bytes: 1, sha256: "c".repeat(64), contentType: "video/mp4", verifiedAt: 2 };
  await assert.rejects(getRenderEngineProjectJob(jobId, async () => Response.json(job(foreign))), RenderEngineResponseError);
}));
