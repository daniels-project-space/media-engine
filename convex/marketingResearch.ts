import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";
import { snapshotHash, website } from "./marketingPolicy";

export const list = internalQuery({
  args: { projectId: v.id("marketingProjects") },
  handler: async (ctx, { projectId }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    return await ctx.db.query("marketingResearch").withIndex("by_project", q => q.eq("projectId", projectId)).take(10);
  },
});

export const save = internalMutation({
  args: { projectId: v.id("marketingProjects"), expectedProjectVersion: v.number(), url: v.string(), title: v.string(),
    description: v.string(), excerpt: v.string(), capturedAt: v.number(), kind: v.union(v.literal("project"), v.literal("reference")),
    origin: v.optional(v.union(v.literal("project"), v.literal("manual"), v.literal("discovered"))) },
  handler: async (ctx, args) => {
    const [project, organization] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    if (project.version !== args.expectedProjectVersion) throw new Error("Project brief changed during source inspection");
    const url = website(args.url);
    if (args.kind === "project" && new URL(url).hostname !== new URL(project.website).hostname) throw new Error("The project source must match the project website");
    if (url.length > 700 || !args.title.trim() || args.title.length > 120 || args.description.length > 2000 || args.excerpt.length > 4000 ||
        !Number.isSafeInteger(args.capturedAt) || Math.abs(Date.now() - args.capturedAt) > 60_000)
      throw new Error("Invalid research source");
    const existing = await ctx.db.query("marketingResearch").withIndex("by_project_url", q => q.eq("projectId", args.projectId).eq("url", url)).unique();
    const origin: "project" | "manual" | "discovered" = args.kind === "project" ? "project" : args.origin === "discovered" && existing?.origin !== "manual" ? "discovered" : "manual";
    const contentHash = snapshotHash({ url, title: args.title, description: args.description, excerpt: args.excerpt, kind: args.kind, origin });
    if (!existing) {
      const sources = await ctx.db.query("marketingResearch").withIndex("by_project", q => q.eq("projectId", args.projectId)).take(10);
      if (sources.length >= 10) throw new Error("Project research source limit reached");
    }
    const changed = !existing || existing.contentHash !== contentHash;
    const values = { projectId: args.projectId, url, title: args.title, description: args.description,
      excerpt: args.excerpt, kind: args.kind, origin, capturedAt: args.capturedAt, contentHash };
    if (existing) await ctx.db.patch(existing._id, values); else await ctx.db.insert("marketingResearch", values);
    if (changed) await ctx.db.patch(project._id, { researchVersion: (project.researchVersion ?? 0) + 1, updatedAt: Date.now() });
    return { changed, researchVersion: (project.researchVersion ?? 0) + (changed ? 1 : 0) };
  },
});

export const startDiscovery = internalMutation({
  args: { projectId: v.id("marketingProjects"), expectedProjectVersion: v.number(), requestKey: v.string() },
  handler: async (ctx, args) => {
    const [project, organization] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    if (project.version !== args.expectedProjectVersion || !/^[a-f0-9-]{36}$/.test(args.requestKey)) throw new Error("Invalid or stale research request");
    const existing = await ctx.db.query("marketingResearchDiscoveries").withIndex("by_project_request", q => q.eq("projectId", args.projectId).eq("requestKey", args.requestKey)).unique();
    if (existing) return { discoveryId: existing._id, status: existing.status, canRun: false, captured: existing.captured };
    const last = await ctx.db.query("marketingResearchDiscoveries").withIndex("by_project_created", q => q.eq("projectId", args.projectId)).order("desc").first();
    if (last && last.createdAt > Date.now() - 24 * 60 * 60_000) throw new Error("Market discovery is limited to one attempt per project per day");
    const sources = await ctx.db.query("marketingResearch").withIndex("by_project", q => q.eq("projectId", args.projectId)).take(10);
    if (sources.length >= 10) throw new Error("Research source limit reached");
    const now = Date.now();
    const discoveryId = await ctx.db.insert("marketingResearchDiscoveries", { projectId: args.projectId, requestKey: args.requestKey,
      projectVersion: project.version, status: "running", captured: 0, createdAt: now, updatedAt: now });
    return { discoveryId, status: "running" as const, canRun: true, captured: 0 };
  },
});

export const finishDiscovery = internalMutation({
  args: { projectId: v.id("marketingProjects"), discoveryId: v.id("marketingResearchDiscoveries"), success: v.boolean(), captured: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.discoveryId);
    if (!row || row.projectId !== args.projectId || row.status !== "running" || !Number.isInteger(args.captured) || args.captured < 0 || args.captured > 3) throw new Error("Invalid research discovery settlement");
    await ctx.db.patch(row._id, { status: args.success ? "completed" : "failed", captured: args.captured, updatedAt: Date.now() });
    return { status: args.success ? "completed" : "failed", captured: args.captured };
  },
});
