import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";

export const track = internalMutation({
  args: { projectId: v.id("marketingProjects"), briefId: v.id("marketingRenderBriefs"), jobId: v.string(), modelId: v.string(), providerState: v.string(), errorCode: v.optional(v.string()), rightsConfirmed: v.boolean() },
  handler: async (ctx, args) => {
    const [project, org, brief] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.briefId)]);
    if (!project || !org || project.organizationId !== org._id) throw new Error("Marketing project not found");
    if (!brief || brief.projectId !== project._id || brief.organizationId !== project.organizationId) throw new Error("Render brief does not belong to this project");
    if (!args.rightsConfirmed || !/^[a-f0-9-]{36}$/.test(args.jobId)) throw new Error("A valid job and confirmed usage rights are required");
    if (brief.modelId !== args.modelId) throw new Error("Render model differs from this creative brief");
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
    if (latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0))
      throw new Error("Review the current strategy and recreate this render brief before tracking a job");
    if (brief.renderJobId && brief.renderJobId !== args.jobId && brief.renderState !== "failed")
      throw new Error("This creative brief already has a render in progress or ready");
    const existing = await ctx.db.query("marketingHyperImports").withIndex("by_project_job", q => q.eq("projectId", project._id).eq("jobId", args.jobId)).unique();
    if (existing?.briefId && existing.briefId !== brief._id) throw new Error("This render job is already linked to another creative brief");
    const providerState = args.providerState.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 40) || "unknown";
    const errorCode = args.errorCode?.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 100);
    const terminalFailure = providerState === "failed" || providerState === "cancelled";
    const now = Date.now();
    if (existing) {
      const status = existing.status === "queued" || existing.status === "running" || existing.status === "verified"
        ? existing.status : terminalFailure ? "failed" : "tracked";
      await ctx.db.patch(existing._id, { briefId: brief._id, modelId: args.modelId, providerState,
        ...(status === "failed" ? { error: errorCode ?? providerState } : errorCode ? { error: errorCode } : { error: undefined }), status, updatedAt: now });
      await ctx.db.patch(brief._id, { renderJobId: args.jobId,
        renderState: status === "verified" ? "ready" : status === "failed" ? "failed" : status === "tracked" ? "tracked" : "importing",
        renderProviderState: providerState,
        renderError: errorCode,
        ...(existing.assetId ? { renderAssetId: existing.assetId } : {}) });
      return { importId: existing._id, status, providerState: args.providerState };
    }
    const imports = await ctx.db.query("marketingHyperImports").withIndex("by_project_created", q => q.eq("projectId", project._id)).take(100);
    if (imports.length >= 100) throw new Error("Project render import limit reached");
    const status = terminalFailure ? "failed" as const : "tracked" as const;
    const importId = await ctx.db.insert("marketingHyperImports", { projectId: project._id, jobId: args.jobId, briefId: brief._id,
      modelId: args.modelId, providerState, status, attempt: 0,
      ...(terminalFailure ? { error: errorCode ?? providerState } : {}), createdAt: now, updatedAt: now });
    await ctx.db.patch(brief._id, { renderJobId: args.jobId, renderState: terminalFailure ? "failed" : "tracked", renderProviderState: providerState,
      renderError: terminalFailure ? errorCode ?? providerState : undefined, renderAssetId: undefined });
    return { importId, status, providerState };
  },
});

export const request = internalMutation({
  args: { projectId: v.id("marketingProjects"), jobId: v.string(), briefId: v.optional(v.id("marketingRenderBriefs")), rightsConfirmed: v.boolean() },
  handler: async (ctx, args) => {
    const [project, org] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx)]);
    if (!project || !org || project.organizationId !== org._id) throw new Error("Marketing project not found");
    if (!args.rightsConfirmed || !/^[a-f0-9-]{36}$/.test(args.jobId)) throw new Error("A valid job and confirmed usage rights are required");
    const brief = args.briefId ? await ctx.db.get(args.briefId) : null;
    if (args.briefId) {
      if (!brief || brief.projectId !== project._id || brief.organizationId !== project.organizationId)
        throw new Error("Render brief does not belong to this project");
      const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
      if (latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0))
        throw new Error("Review the current strategy and recreate this render brief before importing media");
      if (brief.renderJobId && brief.renderJobId !== args.jobId && brief.renderState !== "failed")
        throw new Error("This creative brief already has a render in progress or ready");
    }
    const existing = await ctx.db.query("marketingHyperImports").withIndex("by_project_job", q => q.eq("projectId", args.projectId).eq("jobId", args.jobId)).unique();
    if (existing?.briefId && args.briefId && existing.briefId !== args.briefId)
      throw new Error("This render job is already linked to another creative brief");
    const staleWorker = existing?.status === "running" && existing.updatedAt < Date.now() - 10 * 60_000;
    if (existing && existing.status !== "failed" && existing.status !== "tracked" && !staleWorker) {
      if (brief) await ctx.db.patch(brief._id, { renderJobId: args.jobId, renderState: existing.status === "verified" ? "ready" : "importing", ...(existing.assetId ? { renderAssetId: existing.assetId } : {}) });
      if (!existing.briefId && brief) await ctx.db.patch(existing._id, { briefId: brief._id });
      return { importId: existing._id, attempt: existing.attempt, status: existing.status };
    }
    if (existing && existing.status === "failed" && existing.attempt >= 3) throw new Error("Three attempts failed; inspect the source before retrying.");
    const now = Date.now();
    if (existing) {
      const attempt = existing.attempt + 1;
      await ctx.db.patch(existing._id, { status: "queued", ...(brief ? { briefId: brief._id } : {}), attempt, workerRunId: undefined, error: undefined, updatedAt: now });
      if (brief) await ctx.db.patch(brief._id, { renderJobId: args.jobId, renderState: "importing", renderError: undefined, renderAssetId: undefined });
      return { importId: existing._id, attempt, status: "queued" as const };
    }
    const imports = await ctx.db.query("marketingHyperImports").withIndex("by_project_created", q => q.eq("projectId", args.projectId)).take(100);
    if (imports.length >= 100) throw new Error("Project render import limit reached");
    const importId = await ctx.db.insert("marketingHyperImports", { projectId: args.projectId, jobId: args.jobId, ...(brief ? { briefId: brief._id } : {}),
      status: "queued", attempt: 1, createdAt: now, updatedAt: now });
    if (brief) await ctx.db.patch(brief._id, { renderJobId: args.jobId, renderState: "importing", renderError: undefined, renderAssetId: undefined });
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
      if (item.briefId) {
        const brief = await ctx.db.get(item.briefId);
      if (brief?.projectId === project._id && brief.renderJobId === item.jobId)
          await ctx.db.patch(brief._id, { renderState: "failed", renderError: "R2_VERIFICATION_FAILED" });
      }
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
    if (item.briefId) {
      const brief = await ctx.db.get(item.briefId);
      if (brief?.projectId === project._id && brief.renderJobId === item.jobId)
        await ctx.db.patch(brief._id, { renderState: "ready", renderError: undefined, renderAssetId: assetId });
    }
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
