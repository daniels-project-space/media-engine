import assert from "node:assert/strict";
import test from "node:test";
import { approvePlan, claimRenderExecution, createRenderPost, failRender,
  persistPlan, recordHostedScene, startRender } from "../convex/creative.ts";

function fixture() {
  const ids = { project: "f".repeat(32), order: "e".repeat(32), org: "g".repeat(32),
    approvalRequests: "b".repeat(32), actionLedger: "c".repeat(32), renderJobs: "a".repeat(32), posts: "d".repeat(32) };
  const rows = new Map();
  const counts = new Map();
  const writes = [];
  const project = { _id: ids.project, organizationId: ids.org, orderId: ids.order,
    title: "Approved client ad", buyer: "Client", intakeStatus: "complete", stage: "scripting", storyboardVersion: 0 };
  rows.set(ids.project, project);
  rows.set(ids.order, { _id: ids.order, organizationId: ids.org, productImageKey: "products/client/approved.png" });
  const ctx = { db: {
    get: async id => rows.get(id) ?? null,
    patch: async (id, value) => { assert.ok(rows.has(id)); writes.push(["patch", id]); Object.assign(rows.get(id), value); },
    insert: async (table, value) => {
      const count = (counts.get(table) ?? 0) + 1;
      counts.set(table, count);
      const id = ids[table] ?? `${table}-${count}`;
      assert.ok(!rows.has(id));
      rows.set(id, { _id: id, _table: table, ...value });
      writes.push(["insert", table]);
      return id;
    },
    query: table => ({ withIndex: () => ({
      collect: async () => [...rows.values()].filter(row => row._table === table),
      first: async () => [...rows.values()].find(row => row._table === table) ?? null,
    }) }),
  } };
  return { ctx, ids, rows, counts, writes, project };
}

const plan = { provider: "render-engine", model: "seedance-2.5-i2v", creditSource: "engine_hosted_budget",
  aspectRatio: "9:16", durationSeconds: 5, audioStrategy: "product sound", referencePolicy: "approved reference",
  referenceFrameSha256: "9".repeat(64), fallbackPolicy: "fail_closed", providerInstructions: [] };
const narrative = { audience: "buyers", objective: "demonstrate", corePromise: "approved promise", insight: "insight",
  arc: [{ beat: "Hook", purpose: "show product" }], cta: "Learn more" };
const shots = [{ kind: "reference_video", imageKey: "products/client/approved.png", motion: "Slow orbit", seconds: 5 }];
const token = char => char.repeat(43);

test("a failed charged shot resumes the same approved job, action, post and Engine key", async () => {
  const f = fixture();
  await persistPlan._handler(f.ctx, { projectId: f.ids.project, narrative, shots, renderPlan: plan });
  await approvePlan._handler(f.ctx, { projectId: f.ids.project });
  const first = await startRender._handler(f.ctx, { projectId: f.ids.project, kind: "draft", dispatchToken: token("A") });
  assert.equal(first.jobId, f.ids.renderJobs);
  assert.equal(first.reused, false);
  // A lost Trigger dispatch ACK can be retried without creating another job.
  const queuedRetry = await startRender._handler(f.ctx, { projectId: f.ids.project, kind: "draft", dispatchToken: token("B") });
  assert.deepEqual(queuedRetry, { jobId: first.jobId, reused: false, resumed: true });
  assert.equal(f.counts.get("renderJobs"), 1);
  assert.equal(f.counts.get("actionLedger"), 1);
  await assert.rejects(claimRenderExecution._handler(f.ctx, {
    jobId: first.jobId, dispatchToken: token("A"), triggerRunId: "late-worker" }), /invalid or has expired/);
  await claimRenderExecution._handler(f.ctx, { jobId: first.jobId, dispatchToken: token("B"), triggerRunId: "worker-1" });
  const postArgs = { jobId: first.jobId, triggerRunId: "worker-1", variantTag: "variant", concept: "concept",
    hookId: "hook", variantId: "variant-1" };
  const postId = await createRenderPost._handler(f.ctx, postArgs);
  const scene = { index: 0, idempotencyKey: `${first.jobId}:scene:1`, engineJobId: `hosted-${"1".repeat(32)}`,
    providerRequestId: "cgt-1", estimatedCostUsd: 0.8, admittedCostUsd: 1.5,
    outputKey: `projects/media-engine/jobs/hosted-${"1".repeat(32)}/generation-1/claim/generation.mp4`,
    outputSha256: "2".repeat(64), outputBytes: 1000 };
  await recordHostedScene._handler(f.ctx, { jobId: first.jobId, triggerRunId: "worker-1", scene });
  await failRender._handler(f.ctx, { jobId: first.jobId, triggerRunId: "worker-1", error: "quality check timed out" });
  const resumed = await startRender._handler(f.ctx, { projectId: f.ids.project, kind: "draft", dispatchToken: token("C") });
  assert.deepEqual(resumed, { jobId: first.jobId, reused: false, resumed: true });
  assert.equal(f.counts.get("renderJobs"), 1);
  assert.equal(f.counts.get("actionLedger"), 1);
  assert.equal(f.rows.get(first.jobId).postId, postId);
  assert.deepEqual(f.rows.get(first.jobId).hostedSceneReceipts, [scene]);
  await claimRenderExecution._handler(f.ctx, { jobId: first.jobId, dispatchToken: token("C"), triggerRunId: "worker-2" });
  const replayPost = await createRenderPost._handler(f.ctx, { ...postArgs, triggerRunId: "worker-2" });
  assert.equal(replayPost, postId);
  assert.equal(f.counts.get("posts"), 1);
  const beforeReplay = f.writes.length;
  await recordHostedScene._handler(f.ctx, { jobId: first.jobId, triggerRunId: "worker-2", scene });
  assert.equal(f.writes.length, beforeReplay);
  // A second failure with an unknown in-flight provider result also keeps the key.
  await failRender._handler(f.ctx, { jobId: first.jobId, triggerRunId: "worker-2", error: "Engine status timeout" });
  const pendingResume = await startRender._handler(f.ctx, { projectId: f.ids.project, kind: "draft", dispatchToken: token("D") });
  assert.equal(pendingResume.jobId, first.jobId);
  assert.equal(f.rows.get(first.jobId).idempotencyKey, `${f.ids.project}:1:draft:1`);
  assert.equal(f.counts.get("renderJobs"), 1);
  assert.equal(f.counts.get("actionLedger"), 1);
});
