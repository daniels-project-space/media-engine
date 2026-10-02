import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_ENGINE_PROJECT_VIDEO,
  RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE,
  assertRenderEngineCanRenderApprovedAd,
} from "../src/lib/render-engine-compatibility.ts";
import {
  CANONICAL_VIDEO_MODEL,
  SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE,
  assertSeedanceRendererEnabled,
  primeHiggsfield,
  renderClip,
} from "../src/lib/video-router.ts";

test("configured Engine route admits while the legacy Higgsfield adapter remains closed", async () => {
  const priorUrl = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://example.convex.site";
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("unexpected network request");
  };
  try {
    assert.doesNotThrow(assertRenderEngineCanRenderApprovedAd);
    assert.throws(assertSeedanceRendererEnabled, { message: SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE });
    await assert.rejects(primeHiggsfield(), { message: SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE });
    await assert.rejects(renderClip({
      model: CANONICAL_VIDEO_MODEL,
      imageBytes: Buffer.from("approved reference"),
      motion: "slow orbit",
      durationSeconds: 5,
      aspectRatio: "9:16",
    }), { message: SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE });
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

test("the Engine I2V project route requires the approved first frame", () => {
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.path, "/client/hosted-generations");
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.profileId, "seedance-2.5-i2v");
  assert.equal(RENDER_ENGINE_PROJECT_VIDEO.acceptsReferenceImage, true);
});
