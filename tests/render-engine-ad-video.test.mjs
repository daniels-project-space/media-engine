import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { portraitFrame, parseEngineAdGenerationStatus, renderEngineAdScene } from "../src/lib/render-engine-ad-video.ts";

test("approved source center-crops deterministically to the Engine's exact 720x1280 first frame", async () => {
  const source = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#cb572b" } }).png().toBuffer();
  const first = await portraitFrame(source);
  const second = await portraitFrame(source);
  assert.deepEqual(first, second);
  const shape = await sharp(first).metadata();
  assert.equal(shape.width, 720);
  assert.equal(shape.height, 1280);
  assert.equal(shape.format, "png");
  assert.deepEqual(await sharp(source).metadata().then(({ width, height }) => [width, height]), [1280, 720]);
});

test("one Engine paid POST binds approved first frame, same-key recovery and full output hash", async () => {
  const priorOrigin = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const priorToken = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://engine.example/";
  process.env.RENDER_ENGINE_PROJECT_TOKEN = "d".repeat(64);
  const job = "a".repeat(32);
  const frameSha = "b".repeat(64);
  const firstFrame = { key: `projects/media-engine/inputs/sha256/${frameSha}.png`, sha256: frameSha,
    bytes: 1024, contentType: "image/png" };
  const video = Buffer.from("verified-video-bytes");
  const videoSha = createHash("sha256").update(video).digest("hex");
  const engineJobId = `hosted-${"c".repeat(32)}`;
  const receipt = { status: "complete", model: "seedance-2.5-i2v", provider: "byteplus",
    providerRequestId: "cgt-20261002-task", projectId: "media-project-id", jobId: engineJobId,
    estimatedCostUsd: 0.8, output: { bucket: "media-engine", key: `projects/media-engine/jobs/${engineJobId}/generation-x/claim/generation.mp4`,
      bytes: video.length, sha256: videoSha, contentType: "video/mp4" } };
  const state = { status: "complete", model: "seedance-2.5-i2v", provider: "byteplus", jobId: engineJobId,
    providerRequestId: receipt.providerRequestId, admittedCostUsd: 1.5, budgetReleasedUsd: 0,
    outputRetired: false, receipt };
  let posted = 0;
  let first = true;
  const fetcher = async (url, init) => {
    if (init.method === "POST") {
      posted++;
      assert.equal(String(url), "https://engine.example/client/hosted-generations");
      const body = JSON.parse(init.body);
      assert.equal(body.projectName, "media-engine");
      assert.equal(body.idempotencyKey, `${job}:scene:1`);
      assert.equal(body.allowPaidDispatch, true);
      assert.deepEqual(body.input, { model: "seedance-2.5-i2v", prompt: "Slow orbit", resolution: "720p",
        durationSeconds: 5, generateAudio: true, requiredAspectRatio: "9:16", firstFrame });
      return new Response("in progress", { status: 202 });
    }
    if (first) { first = false; return new Response("missing", { status: 404 }); }
    return Response.json(state);
  };
  try {
    const args = { renderJobId: job, index: 1, prompt: "Slow orbit", durationSeconds: 5, firstFrame };
    const rendered = await renderEngineAdScene(args, fetcher, async () => undefined, async () => video);
    assert.equal(rendered.scene.idempotencyKey, `${job}:scene:1`);
    assert.equal(rendered.scene.admittedCostUsd, 1.5);
    assert.equal(rendered.scene.estimatedCostUsd, 0.8);
    assert.equal(posted, 1);
    const replay = await renderEngineAdScene(args, fetcher, async () => undefined, async () => video);
    assert.equal(replay.scene.engineJobId, engineJobId);
    assert.equal(posted, 1);
    await assert.rejects(renderEngineAdScene(args, fetcher, async () => undefined, async () => Buffer.from("tampered")), /full SHA-256/);
    assert.equal(posted, 1);
    assert.throws(() => parseEngineAdGenerationStatus({ ...state, receipt: { ...receipt,
      output: { ...receipt.output, key: "projects/foreign/jobs/x/generation.mp4" } } }, `${job}:scene:1`), /invalid owned/);
    assert.throws(() => parseEngineAdGenerationStatus({ ...state, admittedCostUsd: Number.NaN }, `${job}:scene:1`), /invalid owned/);
  } finally {
    if (priorOrigin === undefined) delete process.env.RENDER_ENGINE_PROJECT_API_URL;
    else process.env.RENDER_ENGINE_PROJECT_API_URL = priorOrigin;
    if (priorToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = priorToken;
  }
});

test("an unknown in-flight Engine result never creates a second paid submission", async () => {
  const priorOrigin = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const priorToken = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://engine.example/";
  process.env.RENDER_ENGINE_PROJECT_TOKEN = "d".repeat(64);
  const job = "a".repeat(32);
  const frameSha = "b".repeat(64);
  const firstFrame = { key: `projects/media-engine/inputs/sha256/${frameSha}.png`, sha256: frameSha,
    bytes: 1024, contentType: "image/png" };
  let paidPosts = 0;
  let recoveries = 0;
  const fetcher = async (url, init) => {
    if (init.method === "POST" && String(url).endsWith("/recover")) {
      recoveries++;
      return Response.json({ state: "running" });
    }
    if (init.method === "POST") {
      paidPosts++;
      throw new Error("a second paid POST is forbidden");
    }
    assert.equal(new URL(url).searchParams.get("idempotencyKey"), `${job}:scene:1`);
    return Response.json({ status: "running" });
  };
  try {
    await assert.rejects(renderEngineAdScene({ renderJobId: job, index: 1, prompt: "Slow orbit",
      durationSeconds: 5, firstFrame }, fetcher, async () => undefined), /remains unsettled/);
    assert.equal(paidPosts, 0);
    assert.equal(recoveries, 3);
  } finally {
    if (priorOrigin === undefined) delete process.env.RENDER_ENGINE_PROJECT_API_URL;
    else process.env.RENDER_ENGINE_PROJECT_API_URL = priorOrigin;
    if (priorToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = priorToken;
  }
});
