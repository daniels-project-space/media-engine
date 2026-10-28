import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findDefaultOrganization } from "./controlPlaneModel";
import { assertOwned } from "./marketingPolicy";

async function projectFor(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"marketingProjects">,
) {
  const project = await ctx.db.get(projectId),
    organization = await findDefaultOrganization(ctx);
  if (!project || !organization || project.organizationId !== organization._id)
    throw new Error("Marketing project not found");
  return project;
}

async function receipt(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"marketingProjects">,
  jobId: Id<"renderJobs">,
) {
  const job = await ctx.db.get(jobId);
  if (
    !job ||
    job.status !== "succeeded" ||
    job.kind !== "final" ||
    job.provider !== "render-engine" ||
    job.model !== "seedance-2.5-i2v" ||
    job.creditSource !== "engine_hosted_budget" ||
    !job.postId ||
    !job.actionId ||
    !job.approvalId
  )
    throw new Error(
      "Choose a completed final render from the approved Render Engine workflow",
    );
  const [source, post, action, approval] = await Promise.all([
    ctx.db.get(job.projectId),
    ctx.db.get(job.postId),
    ctx.db.get(job.actionId),
    ctx.db.get(job.approvalId),
  ]);
  const key = `creative/${job.postId}/ad.mp4`;
  if (
    !source ||
    source.organizationId !== project.organizationId ||
    source.finalPostId !== post?._id ||
    source.approvedPlanVersion !== job.planVersion ||
    source.storyboardVersion !== job.planVersion ||
    post?.renderJobId !== job._id ||
    post.status !== "ready" ||
    post.slides?.length !== 1 ||
    post.slides[0].r2Key !== key ||
    action?.status !== "succeeded" ||
    action.renderJobId !== job._id ||
    action.organizationId !== project.organizationId ||
    action.approvalId !== approval?._id ||
    approval?.organizationId !== project.organizationId ||
    approval.resourceId !== source._id ||
    approval.planVersion !== job.planVersion ||
    approval.status !== "approved" ||
    action.providerReceipt?.finalOutput?.key !== key ||
    action.providerReceipt?.finalOutput?.sha256 !== job.finalOutputSha256 ||
    action.providerReceipt?.finalOutput?.bytes !== job.finalOutputBytes ||
    !/^[a-f0-9]{64}$/.test(job.finalOutputSha256 ?? "") ||
    !Number.isSafeInteger(job.finalOutputBytes) ||
    job.finalOutputBytes! < 1 ||
    job.finalOutputBytes! > 500_000_000
  )
    throw new Error(
      "Render ownership, approval or final R2 receipt could not be verified",
    );
  return {
    title: source.title,
    jobId: job._id,
    sourceKey: key,
    sha256: job.finalOutputSha256!,
    bytes: job.finalOutputBytes!,
  };
}

export const available = internalQuery({
  args: { projectId: v.id("marketingProjects") },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    const sources = await ctx.db
      .query("adProjects")
      .withIndex("by_organization_stage", (q) =>
        q
          .eq("organizationId", project.organizationId)
          .eq("stage", "final_ready"),
      )
      .order("desc")
      .take(25);
    const results = [];
    for (const source of sources) {
      const post = source.finalPostId
        ? await ctx.db.get(source.finalPostId)
        : null;
      if (!post?.renderJobId) continue;
      try {
        results.push(await receipt(ctx, project, post.renderJobId));
      } catch {
        /* Historical or unqualified output is not offered. */
      }
    }
    return results;
  },
});

export const requestImport = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    renderJobId: v.id("renderJobs"),
    rightsConfirmed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    if (!args.rightsConfirmed)
      throw new Error(
        "Confirm permission to use this final video for this project's marketing",
      );
    const source = await receipt(ctx, project, args.renderJobId);
    const previous = await ctx.db
      .query("marketingRenderImports")
      .withIndex("by_project_job", (q) =>
        q.eq("projectId", project._id).eq("renderJobId", args.renderJobId),
      )
      .unique();
    if (previous && previous.status !== "failed")
      return {
        importId: previous._id,
        attempt: previous.attempt,
        status: previous.status,
      };
    if (previous && previous.attempt >= 3)
      throw new Error(
        "Three import attempts failed; inspect the verified source before retrying",
      );
    const imports = await ctx.db
      .query("marketingRenderImports")
      .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
      .take(100);
    const assets = await ctx.db
      .query("marketingAssets")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .take(100);
    if ((!previous && imports.length >= 100) || assets.length >= 100)
      throw new Error("Project media limit reached");
    const values = {
      projectId: project._id,
      renderJobId: args.renderJobId,
      status: "queued" as const,
      sourceKey: source.sourceKey,
      sha256: source.sha256,
      bytes: source.bytes,
      destinationKey: `marketing/${project._id}/assets/${source.sha256}.mp4`,
      attempt: (previous?.attempt ?? 0) + 1,
      error: undefined,
      workerRunId: undefined,
      updatedAt: Date.now(),
    };
    if (previous) {
      await ctx.db.patch(previous._id, values);
      return {
        importId: previous._id,
        attempt: values.attempt,
        status: values.status,
      };
    }
    return {
      importId: await ctx.db.insert("marketingRenderImports", {
        ...values,
        createdAt: Date.now(),
      }),
      attempt: values.attempt,
      status: values.status,
    };
  },
});

export const claimImport = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    importId: v.id("marketingRenderImports"),
    attempt: v.number(),
    workerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId),
      item = await ctx.db.get(args.importId);
    assertOwned(project._id, item);
    if (item!.status === "verified") return item!;
    if (
      item!.attempt !== args.attempt ||
      (item!.status !== "queued" &&
        !(item!.status === "running" && item!.workerRunId === args.workerRunId))
    )
      throw new Error("This import attempt is not owned by this worker");
    const source = await receipt(ctx, project, item!.renderJobId);
    if (
      source.sha256 !== item!.sha256 ||
      source.bytes !== item!.bytes ||
      source.sourceKey !== item!.sourceKey
    )
      throw new Error("The approved source receipt changed");
    await ctx.db.patch(item!._id, {
      status: "running",
      workerRunId: args.workerRunId,
      updatedAt: Date.now(),
    });
    return item!;
  },
});

export const settleImport = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    importId: v.id("marketingRenderImports"),
    attempt: v.number(),
    workerRunId: v.string(),
    error: v.optional(v.string()),
    verified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId),
      item = await ctx.db.get(args.importId);
    assertOwned(project._id, item);
    if (item!.status === "verified") return { assetId: item!.assetId };
    const unclaimedFailure =
      !args.verified && item!.status === "queued" && !item!.workerRunId;
    if (
      item!.attempt !== args.attempt ||
      (!unclaimedFailure &&
        (item!.status !== "running" || item!.workerRunId !== args.workerRunId))
    )
      throw new Error("Import settlement does not belong to this worker");
    if (!args.verified) {
      await ctx.db.patch(item!._id, {
        status: "failed",
        error: args.error?.slice(0, 500) ?? "Verified R2 copy failed",
        updatedAt: Date.now(),
      });
      return { status: "failed" };
    }
    const source = await receipt(ctx, project, item!.renderJobId);
    if (source.sha256 !== item!.sha256 || source.bytes !== item!.bytes)
      throw new Error("Source changed before import settlement");
    const existing = await ctx.db
      .query("marketingAssets")
      .withIndex("by_key", (q) => q.eq("key", item!.destinationKey))
      .unique();
    if (
      existing &&
      (existing.projectId !== project._id ||
        existing.sha256 !== item!.sha256 ||
        existing.bytes !== item!.bytes)
    )
      throw new Error("Destination receipt conflicts");
    const assetId =
      existing?._id ??
      (await ctx.db.insert("marketingAssets", {
        organizationId: project.organizationId,
        projectId: project._id,
        key: item!.destinationKey,
        sha256: item!.sha256,
        bytes: item!.bytes,
        contentType: "video/mp4",
        source: "approved_render",
        rightsConfirmed: true,
        createdAt: Date.now(),
      }));
    await ctx.db.patch(item!._id, {
      status: "verified",
      assetId,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(project._id, {
      defaultAssetId: assetId,
      updatedAt: Date.now(),
    });
    return { assetId, status: "verified" };
  },
});
