import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_ENGINE_PROJECT_VIDEO,
  RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE,
} from "../src/lib/render-engine-compatibility.ts";
import {
  CANONICAL_VIDEO_MODEL,
  SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE,
  assertSeedanceRendererEnabled,
  primeHiggsfield,
  renderClip,
} from "../src/lib/video-router.ts";

test("configured Render Engine cutover fails at admission and worker preflight without a network call", async () => {
  const priorUrl = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://example.convex.site";
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("unexpected network request");
  };
  try {
    assert.throws(assertSeedanceRendererEnabled, { message: RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE });
    await assert.rejects(primeHiggsfield(), { message: RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE });
    await assert.rejects(renderClip({
      model: CANONICAL_VIDEO_MODEL,
      imageBytes: Buffer.from("approved reference"),
      motion: "slow orbit",
      durationSeconds: 5,
      aspectRatio: "9:16",
    }), { message: RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.RENDER_ENGINE_PROJECT_API_URL;
    else process.env.RENDER_ENGINE_PROJECT_API_URL = priorUrl;
  }
});

test("without Render Engine configuration, the existing Seedance gate remains closed", () => {
  const priorUrl = process.env.RENDER_ENGINE_PROJECT_API_URL;
  delete process.env.RENDER_ENGINE_PROJECT_API_URL;
  try {
    assert.throws(assertSeedanceRendererEnabled, { message: SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE });
  } finally {
    if (priorUrl !== undefined) process.env.RENDER_ENGINE_PROJECT_API_URL = priorUrl;
  }
});

test("the engine's current project job has no approved-reference input", () => {
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.path, "/client/h3-jobs");
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.profileId, "minimax-h3");
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.acceptsReferenceImage, false);
});
