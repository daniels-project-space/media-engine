import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";

export const request = internalMutation({
  args: { projectId: v.id("marketingProjects"), jobId: v.string(), rightsConfirmed: v.boolean() },
  handler: async (ctx, args) => {
    const [project, org] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx)]);
    if (!project || !org || project.organizationId !== org._id) throw new Error("Marketing project not found");
    if (!args.rightsConfirmed || !/^[a-f0-9-]{36}$/.test(args.jobId)) throw new Error("A valid job and confirmed usage rights are required");
    const existing = await ctx.db.query("marketingHyperImports").withIndex("by_project_job", q => q.eq("projectId", args.projectId).eq("jobId", args.jobId)).unique();
    const staleWorker = existing?.status === "running" && existing.updatedAt < Date.now() - 10 * 60_000;
    if (existing && existing.status !== "failed" && !staleWorker) return { importId: existing._id, attempt: existing.attempt, status: existing.status };
    if (existing && existing.attempt >= 3) throw new Error("Three attempts failed; inspect the source before retrying.");
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "queued", attempt: existing.attempt + 1, workerRunId: undefined, error: undefined, updatedAt: now });
      return { importId: existing._id, attempt: existing.attempt + 1, status: "queued" as const };
    }
    const imports = await ctx.db.query("marketingHyperImports").withIndex("by_project_created", q => q.eq("projectId", args.projectId)).take(100);
    if (imports.length >= 100) throw new Error("Project render import limit reached");
    const importId = await ctx.db.insert("marketingHyperImports", { projectId: args.projectId, jobId: args.jobId,
      status: "queued", attempt: 1, createdAt: now, updatedAt: now });
    return { importId, attempt: 1, status: "queued" as const };
  },
});

export const claim = internalMutation({
  args: { projectId: v.id("marketingProjects"), importId: v.id("marketingHyperImports"), attempt: v.number(), workerRunId: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.importId);
    if (!item || item.projectId !== args.projectId || item.attempt !== args.attempt || item.status !== "queued") throw new Error("Import is not available to this worker");
    await ctx.db.patch(item._id, { status: "running", workerRunId: args.workerRunId, updatedAt: Date.now() });
    return { jobId: item.jobId };
  },
});

export const settle = internalMutation({
  args: { projectId: v.id("marketingProjects"), importId: v.id("marketingHyperImports"), attempt: v.number(), workerRunId: v.string(),
    error: v.optional(v.string()), receipt: v.optional(v.object({ key: v.string(), sha256: v.string(), bytes: v.number(), contentType: v.string() })) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.importId), project = await ctx.db.get(args.projectId);
    if (!item || !project || item.projectId !== args.projectId || item.attempt !== args.attempt || item.status !== "running" || item.workerRunId !== args.workerRunId)
      throw new Error("Import settlement does not belong to this worker");
    if (args.error || !args.receipt) {
      await ctx.db.patch(item._id, { status: "failed", error: args.error?.slice(0, 500) ?? "R2 verification failed", updatedAt: Date.now() });
      return { status: "failed" as const };
    }
    const r = args.receipt;
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4" };
    const ext = extensions[r.contentType];
    if (!ext || !/^[a-f0-9]{64}$/.test(r.sha256) || r.key !== `marketing/${args.projectId}/assets/${r.sha256}.${ext}` ||
        !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > 500_000_000) throw new Error("Verified media receipt is invalid");
    const existing = await ctx.db.query("marketingAssets").withIndex("by_key", q => q.eq("key", r.key)).unique();
    if (existing && (existing.projectId !== args.projectId || existing.sha256 !== r.sha256 || existing.bytes !== r.bytes || existing.contentType !== r.contentType)) throw new Error("Media receipt conflicts");
    const assets = await ctx.db.query("marketingAssets").withIndex("by_project", q => q.eq("projectId", args.projectId)).take(100);
    if (!existing && assets.length >= 100) throw new Error("Project media limit reached");
    const assetId = existing?._id ?? await ctx.db.insert("marketingAssets", { organizationId: project.organizationId, projectId: project._id,
      ...r, source: "approved_render", rightsConfirmed: true, createdAt: Date.now() });
    await ctx.db.patch(item._id, { status: "verified", assetId, updatedAt: Date.now() });
    await ctx.db.patch(project._id, { defaultAssetId: assetId, updatedAt: Date.now() });
    return { status: "verified" as const, assetId };
  },
});

export const latest = internalQuery({
  args: { projectId: v.id("marketingProjects"), jobId: v.string() },
  handler: async (ctx, args) => {
    const [project, org] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx)]);
    if (!project || !org || project.organizationId !== org._id) throw new Error("Marketing project not found");
    return await ctx.db.query("marketingHyperImports").withIndex("by_project_job", q => q.eq("projectId", args.projectId).eq("jobId", args.jobId)).unique();
  },
});
