import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";

export const latest = internalQuery({
  args: { projectId: v.id("marketingProjects") },
  handler: async (ctx, { projectId }) => {
    const [project, organization] = await Promise.all([
      ctx.db.get(projectId), findDefaultOrganization(ctx),
    ]);
    if (!project || !organization || project.organizationId !== organization._id)
      throw new Error("Marketing project not found");
    const plan = await ctx.db.query("marketingPlans")
      .withIndex("by_project_revision", (q) => q.eq("projectId", projectId))
      .order("desc").first();
    return plan ? { ...plan, stale: plan.projectVersion !== project.version } : null;
  },
});

export const save = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    expectedProjectVersion: v.number(),
    expectedRevision: v.number(),
    strategy: v.string(),
    calendar: v.string(),
    sources: v.string(),
  },
  handler: async (ctx, args) => {
    const [project, organization] = await Promise.all([
      ctx.db.get(args.projectId), findDefaultOrganization(ctx),
    ]);
    if (!project || !organization || project.organizationId !== organization._id)
      throw new Error("Marketing project not found");
    if (project.version !== args.expectedProjectVersion)
      throw new Error("Project brief changed; refresh and review the plan.");
    const latest = await ctx.db.query("marketingPlans")
      .withIndex("by_project_revision", (q) => q.eq("projectId", args.projectId))
      .order("desc").first();
    const revision = latest?.revision ?? 0;
    if (args.expectedRevision !== revision)
      throw new Error("Plan changed; refresh before saving again.");
    if (!args.strategy.trim() || args.strategy.length > 20_000 ||
        args.calendar.length > 20_000 || args.sources.length > 10_000)
      throw new Error("Provide a strategy within the size limits.");
    const id = await ctx.db.insert("marketingPlans", {
      organizationId: organization._id, projectId: project._id,
      projectVersion: project.version, revision: revision + 1,
      strategy: args.strategy.trim(), calendar: args.calendar.trim(),
      sources: args.sources.trim(), origin: "owner", createdAt: Date.now(),
    });
    return { planId: id, revision: revision + 1 };
  },
});

export const start = internalMutation({
  args: { projectId: v.id("marketingProjects"), requestKey: v.string() },
  handler: async (ctx, { projectId, requestKey }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    if (!/^[a-f0-9-]{36}$/.test(requestKey)) throw new Error("Invalid planning request key");
    const existing = await ctx.db.query("marketingPlanRuns").withIndex("by_project_request", q => q.eq("projectId", projectId).eq("requestKey", requestKey)).unique();
    if (existing) return { runId: existing._id, status: existing.status };
    const previous = await ctx.db.query("marketingPlanRuns").withIndex("by_project_created", q => q.eq("projectId", projectId)).order("desc").first();
    if (previous?.status === "running" && previous.updatedAt < Date.now() - 8 * 60_000) {
      // The worker's maximum duration is four minutes. Fence a lost worker
      // before admitting a new run; any late result can no longer commit.
      await ctx.db.patch(previous._id, { status: "failed", error: "Planning worker timed out; its result was fenced.", updatedAt: Date.now() });
    } else if (previous && ["queued", "running"].includes(previous.status)) {
      throw new Error("A planning run is already in progress; check its status before retrying.");
    }
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", projectId)).order("desc").first();
    const now = Date.now();
    const runId = await ctx.db.insert("marketingPlanRuns", { organizationId: organization._id, projectId, requestKey, projectVersion: project.version, baseRevision: latest?.revision ?? 0, status: "queued", createdAt: now, updatedAt: now });
    return { runId, status: "queued" as const };
  },
});

export const latestRun = internalQuery({
  args: { projectId: v.id("marketingProjects"), asOfMinute: v.number() },
  handler: async (ctx, { projectId, asOfMinute }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    const run = await ctx.db.query("marketingPlanRuns").withIndex("by_project_created", q => q.eq("projectId", projectId)).order("desc").first();
    return run ? { ...run, recoverable: run.status === "running" && run.updatedAt < asOfMinute * 60_000 - 8 * 60_000 } : null;
  },
});

export const claim = internalMutation({
  args: { runId: v.id("marketingPlanRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    const project = await ctx.db.get(run.projectId);
    if (!project || project.version !== run.projectVersion) {
      await ctx.db.patch(runId, { status: "failed", error: "Project brief changed before planning started.", updatedAt: Date.now() });
      return null;
    }
    await ctx.db.patch(runId, { status: "running", updatedAt: Date.now() });
    return { projectId: project._id, name: project.name, website: project.website,
      offer: project.offer, audience: project.audience, facts: project.facts,
      goal: project.goal, tone: project.tone, timezone: project.timezone, cadence: project.cadence };
  },
});

export const finish = internalMutation({
  args: { runId: v.id("marketingPlanRuns"), strategy: v.optional(v.string()), calendar: v.optional(v.string()), sources: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return { saved: false };
    const project = await ctx.db.get(run.projectId);
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", run.projectId)).order("desc").first();
    let error = args.error?.slice(0, 500);
    if (!project || project.version !== run.projectVersion || (latest?.revision ?? 0) !== run.baseRevision)
      error = "The brief or plan changed while the model was working. Generate a fresh plan.";
    if (!error && (!args.strategy?.trim() || args.strategy.length > 20_000 || !args.calendar?.trim() || args.calendar.length > 20_000 || (args.sources?.length ?? 0) > 10_000))
      error = "The planning result was incomplete or exceeded size limits.";
    if (error) {
      await ctx.db.patch(args.runId, { status: "failed", error, updatedAt: Date.now() });
      return { saved: false };
    }
    await ctx.db.insert("marketingPlans", { organizationId: run.organizationId, projectId: run.projectId,
      projectVersion: run.projectVersion, revision: run.baseRevision + 1, strategy: args.strategy!,
      calendar: args.calendar!, sources: args.sources ?? "", origin: "ai", createdAt: Date.now() });
    await ctx.db.patch(args.runId, { status: "completed", updatedAt: Date.now() });
    return { saved: true };
  },
});
