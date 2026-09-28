import assert from "node:assert/strict";
import test from "node:test";
import { generateCreatorImage } from "../src/lib/render-engine-creator-image.ts";

const token = "b".repeat(64);
const jobId = `hosted-${"a".repeat(32)}`;
const receipt = {
  status: "complete", model: "nano-banana-pro", provider: "google", projectId: "project123", jobId,
  output: { bucket: "media-engine", key: `projects/media-engine/jobs/${jobId}/generation-${"c".repeat(32)}/${"d".repeat(64)}/generation.png`,
    bytes: 12, sha256: "e".repeat(64), contentType: "image/png" },
};

function withConfig(run) {
  const oldUrl = process.env.RENDER_ENGINE_PROJECT_API_URL;
  const oldToken = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_API_URL = "https://engine.example.convex.site";
  process.env.RENDER_ENGINE_PROJECT_TOKEN = token;
  return Promise.resolve().then(run).finally(() => {
    if (oldUrl === undefined) delete process.env.RENDER_ENGINE_PROJECT_API_URL;
    else process.env.RENDER_ENGINE_PROJECT_API_URL = oldUrl;
    if (oldToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = oldToken;
  });
}

const input = { idempotencyKey: "creator-image:job123:1:abcdef0123456789", prompt: "adult creator portrait",
  aspectRatio: "4:5", referenceImages: [] };

test("submits one Final image through the authenticated project API", () => withConfig(async () => {
  const calls = [];
  const result = await generateCreatorImage(input, async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "GET") return new Response("", { status: 404 });
    return Response.json(receipt);
  });
  assert.deepEqual(result, receipt);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://engine.example.convex.site/client/hosted-generations?projectName=media-engine&idempotencyKey=${encodeURIComponent(input.idempotencyKey)}`);
  assert.equal(calls[1].options.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { projectName: "media-engine", idempotencyKey: input.idempotencyKey,
    allowPaidDispatch: true, input: { model: "nano-banana-pro", prompt: input.prompt, resolution: "2K", aspectRatio: "4:5", referenceImages: [] } });
}));

test("an existing completed claim is read without another paid submission", () => withConfig(async () => {
  let calls = 0;
  const result = await generateCreatorImage(input, async () => { calls++; return Response.json({ status: "complete", receipt }); });
  assert.equal(result.output.bucket, "media-engine");
  assert.equal(calls, 1);
}));

test("foreign output and unapproved image route fail closed", () => withConfig(async () => {
  await assert.rejects(generateCreatorImage(input, async () => Response.json({ status: "complete", receipt: {
    ...receipt, output: { ...receipt.output, bucket: "render-engine" },
  } })), /invalid Media Engine R2 image receipt/);
  await assert.rejects(generateCreatorImage(input, async () => Response.json({ status: "complete", receipt: {
    ...receipt, output: { ...receipt.output, key: receipt.output.key.replace("projects/media-engine/", "projects/foreign/") },
  } })), /invalid Media Engine R2 image receipt/);
  await assert.rejects(generateCreatorImage({ ...input, referenceImages: [{ mimeType: "image/png", base64: "a".repeat(20) }] },
    async () => Response.json({ status: "complete", receipt: { ...receipt, provider: "fal" } })), /invalid Media Engine R2 image receipt/);
}));
