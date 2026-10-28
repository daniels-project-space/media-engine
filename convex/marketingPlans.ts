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
