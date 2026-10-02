import assert from "node:assert/strict";
import test from "node:test";
import { completeRenderHosted, recordHostedScene, completeRender } from "../convex/creative.ts";

const handler = completeRenderHosted._handler;
const recordScene = recordHostedScene._handler;

test("claimed ad settlement binds every Engine scene and keeps actual provider cost unknown", async () => {
  const job = { _id: "a".repeat(32), projectId: "b".repeat(32), postId: "c".repeat(32),
    actionId: "d".repeat(32), workflowId: undefined, kind: "draft", planVersion: 3,
    status: "running", workerRunId: "trigger-run", provider: "render-engine",
    model: "seedance-2.5-i2v", creditSource: "engine_hosted_budget" };
  const project = { _id: job.projectId, approvedPlanVersion: 3, storyboardVersion: 3,
    approvedShots: [{ kind: "reference_video" }], renderPlan: { provider: "render-engine",
      model: "seedance-2.5-i2v", creditSource: "engine_hosted_budget", referenceFrameSha256: "a".repeat(64) } };
  const post = { _id: job.postId, renderJobId: job._id };
  const action = { _id: job.actionId, renderJobId: job._id, status: "running", triggerRunId: "trigger-run" };
  const rows = { [job._id]: job, [project._id]: project, [post._id]: post, [action._id]: action };
  const writes = [];
  const ctx = { db: { get: async id => rows[id] ?? null,
    patch: async (id, update) => { writes.push([id, update]); Object.assign(rows[id], update); },
    insert: async (table, row) => { writes.push([table, row]); },
  } };
  const engineJobId = `hosted-${"e".repeat(32)}`;
  const scenes = [{ index: 0, idempotencyKey: `${job._id}:scene:1`, engineJobId,
    providerRequestId: "cgt-20261002", estimatedCostUsd: 0.8, admittedCostUsd: 1.5,
    outputKey: `projects/media-engine/jobs/${engineJobId}/generation-1/claim/generation.mp4`,
    outputSha256: "f".repeat(64), outputBytes: 1000 }];
  const finalOutput = { key: `creative/${job.postId}/ad.mp4`, sha256: "1".repeat(64), bytes: 8000 };
  const args = { jobId: job._id, triggerRunId: "trigger-run", postId: post._id, scenes,
    finalOutput, slides: [{ r2Key: finalOutput.key, prompt: "Product", role: "video" }], qcScore: 70 };
  await assert.rejects(completeRender._handler(ctx, { jobId: job._id, triggerRunId: "trigger-run", postId: post._id,
    creditsUsed: 1, slides: args.slides }), /legacy settlement cannot complete/);
  await assert.rejects(recordScene(ctx, { jobId: job._id, triggerRunId: "foreign", scene: scenes[0] }), /Hosted scene claim differs/);
  await assert.rejects(recordScene(ctx, { jobId: job._id, triggerRunId: "trigger-run",
    scene: { ...scenes[0], estimatedCostUsd: Number.NaN } }), /Hosted scene claim differs/);
  await assert.rejects(handler(ctx, args), /final artifact or shot count differs/);
  await recordScene(ctx, { jobId: job._id, triggerRunId: "trigger-run", scene: scenes[0] });
  assert.equal(job.hostedEstimatedCostUsd, 0.8);
  assert.equal(job.hostedAdmittedCostUsd, 1.5);
  const writesAfterFirstScene = writes.length;
  await recordScene(ctx, { jobId: job._id, triggerRunId: "trigger-run", scene: scenes[0] });
  assert.equal(writes.length, writesAfterFirstScene);
  await assert.rejects(recordScene(ctx, { jobId: job._id, triggerRunId: "trigger-run",
    scene: { ...scenes[0], outputSha256: "a".repeat(64) } }), /changed after admission/);
  await assert.rejects(handler(ctx, { ...args, scenes: [{ ...scenes[0], idempotencyKey: "foreign:scene:1" }] }), /final artifact or shot count differs/);
  await assert.rejects(handler(ctx, { ...args, scenes: [{ ...scenes[0], estimatedCostUsd: Number.NaN }] }), /final artifact or shot count differs/);
  await assert.rejects(handler(ctx, { ...args, finalOutput: { ...finalOutput, key: "creative/foreign/ad.mp4" } }), /final artifact or shot count differs/);
  assert.equal(writes.length, writesAfterFirstScene);
  await handler(ctx, args);
  assert.equal(job.status, "succeeded");
  assert.equal(job.hostedEstimatedCostUsd, 0.8);
  assert.equal(job.hostedAdmittedCostUsd, 1.5);
  assert.equal(job.creditsUsed, undefined);
  assert.equal(action.providerReceipt.actualCostUsd, null);
  assert.equal(action.providerReceipt.scenes[0].outputSha256, scenes[0].outputSha256);
  assert.equal(project.stage, "draft_ready");
});
