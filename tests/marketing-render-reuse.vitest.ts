/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { snapshotHash } from "../convex/marketingPolicy";

const modules = import.meta.glob("../convex/**/*.ts");
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`marketingRenders:${name}`);
const query = (name: string) =>
  makeFunctionReference<"query">(`marketingRenders:${name}`);

async function fixture() {
  const t = convexTest(schema, modules);
  const create = makeFunctionReference<"mutation">("marketing:createProject");
  const input = {
    name: "Marketing Alpha",
    website: "https://alpha.example/",
    offer: "Owned offer",
    audience: "Operators",
    facts: ["A verified fact"],
    goal: "signup",
    tone: "Clear",
    timezone: "UTC",
    cadence: 3,
    generationLimitMinor: 0,
    advertisingLimitMinor: 0,
    currency: "USD",
    conversionTokenHash: snapshotHash("local-fixture"),
  };
  const projectId = (await t.mutation(
      create,
      input,
    )) as Id<"marketingProjects">,
    otherId = (await t.mutation(create, {
      ...input,
      name: "Marketing Beta",
    })) as Id<"marketingProjects">;
  const jobId = await t.run(async (ctx) => {
    const project = (await ctx.db.get(projectId))!,
      organizationId = project.organizationId;
    const creativeId = await ctx.db.insert("adProjects", {
      buyer: "Operator",
      title: "Approved transport fixture",
      brief: "A local fixture only",
      organizationId,
      stage: "final_ready",
      storyboardVersion: 1,
      approvedPlanVersion: 1,
      createdAt: Date.now(),
    });
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId,
      resourceType: "creative_plan",
      resourceId: creativeId,
      planVersion: 1,
      actionKind: "creative_render",
      snapshotHash: snapshotHash("approved"),
      snapshot: {},
      riskClass: "financial",
      status: "approved",
      requestedAt: Date.now(),
      requestedBy: "local-fixture",
    });
    const jobId = await ctx.db.insert("renderJobs", {
      projectId: creativeId,
      approvalId,
      planVersion: 1,
      kind: "final",
      idempotencyKey: "fixture-render",
      provider: "render-engine",
      model: "seedance-2.5-i2v",
      creditSource: "engine_hosted_budget",
      status: "succeeded",
      finalOutputSha256: "a".repeat(64),
      finalOutputBytes: 1024,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const postId = await ctx.db.insert("posts", {
      streamSlug: "fixture",
      platform: "instagram",
      kind: "reel",
      status: "ready",
      renderJobId: jobId,
      createdAt: Date.now(),
    });
    const key = `creative/${postId}/ad.mp4`;
    await ctx.db.patch(postId, {
      slides: [{ r2Key: key, prompt: "Approved final output" }],
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId,
      approvalId,
      renderJobId: jobId,
      actionKind: "creative_render",
      riskClass: "financial",
      status: "succeeded",
      idempotencyKey: "fixture-action",
      payloadHash: snapshotHash("approved"),
      providerReceipt: {
        finalOutput: { key, sha256: "a".repeat(64), bytes: 1024 },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(jobId, { postId, actionId });
    await ctx.db.patch(creativeId, { finalPostId: postId });
    return jobId;
  });
  return { t, projectId, otherId, jobId };
}

describe("approved video reuse boundary (database fixtures, no live renders)", () => {
  it("requires explicit reuse rights and a matching final approval/receipt", async () => {
    const f = await fixture();
    expect(
      await f.t.query(query("available"), { projectId: f.projectId }),
    ).toHaveLength(1);
    await expect(
      f.t.mutation(mutation("requestImport"), {
        projectId: f.projectId,
        renderJobId: f.jobId,
        rightsConfirmed: false,
      }),
    ).rejects.toThrow(/permission/);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.jobId, { kind: "draft" });
    });
    expect(
      await f.t.query(query("available"), { projectId: f.projectId }),
    ).toEqual([]);
    await expect(
      f.t.mutation(mutation("requestImport"), {
        projectId: f.projectId,
        renderJobId: f.jobId,
        rightsConfirmed: true,
      }),
    ).rejects.toThrow(/completed final/);
  });

  it("isolates imports, claims once, preserves receipts on retry and selects only a verified copy", async () => {
    const f = await fixture();
    const request = {
      projectId: f.projectId,
      renderJobId: f.jobId,
      rightsConfirmed: true,
    };
    const admission = await f.t.mutation(mutation("requestImport"), request);
    expect(
      (await f.t.mutation(mutation("requestImport"), request)).importId,
    ).toBe(admission.importId);
    const identity = {
      projectId: f.projectId,
      importId: admission.importId,
      attempt: admission.attempt,
      workerRunId: "copy-worker",
    };
    await expect(
      f.t.mutation(mutation("claimImport"), {
        ...identity,
        projectId: f.otherId,
      }),
    ).rejects.toThrow(/does not belong/);
    const receipt = await f.t.mutation(mutation("claimImport"), identity);
    expect(receipt.destinationKey).toContain(`marketing/${f.projectId}/`);
    await expect(
      f.t.mutation(mutation("claimImport"), {
        ...identity,
        workerRunId: "duplicate-worker",
      }),
    ).rejects.toThrow(/owned/);
    await f.t.mutation(mutation("settleImport"), {
      ...identity,
      verified: false,
      error: "R2 hash differs",
    });
    const retry = await f.t.mutation(mutation("requestImport"), request);
    expect(retry.attempt).toBe(2);
    await f.t.mutation(mutation("claimImport"), { ...identity, attempt: 2 });
    const complete = await f.t.mutation(mutation("settleImport"), {
      ...identity,
      attempt: 2,
      verified: true,
    });
    const workspace = await f.t.query(
      makeFunctionReference<"query">("marketing:listWorkspace"),
      { projectId: f.projectId },
    );
    expect(workspace.assets[0].sha256).toBe("a".repeat(64));
    expect(workspace.assets[0].source).toBe("approved_render");
    expect(
      workspace.projects.find((p: { _id: string }) => p._id === f.projectId)
        .defaultAssetId,
    ).toBe(complete.assetId);
    expect(
      (
        await f.t.query(
          makeFunctionReference<"query">("marketing:listWorkspace"),
          { projectId: f.otherId },
        )
      ).assets,
    ).toEqual([]);
  });
});
