import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";
import { assertOwned, localPublicationTime, MAX_CONTENT_ROWS, text } from "./marketingPolicy";

// Read the existing global kill switch only through the authenticated gateway.
// Retired public settings functions intentionally always reject their callers.
export const aiAllowed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "aiEnabled")).unique();
    return row?.value === true;
  },
});

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
    return plan ? { ...plan, stale: plan.projectVersion !== project.version || (plan.researchVersion ?? 0) !== (project.researchVersion ?? 0) } : null;
  },
});

export const listRenderBriefs = internalQuery({
  args: { projectId: v.id("marketingProjects") },
  handler: async (ctx, { projectId }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    return ctx.db.query("marketingRenderBriefs").withIndex("by_project_created", q => q.eq("projectId", projectId)).order("desc").take(25);
  },
});

export const createRenderBrief = internalMutation({
  args: { projectId: v.id("marketingProjects"), planId: v.id("marketingPlans"), entryIndex: v.number(),
    modelId: v.union(v.literal("minimax-h3"), v.literal("qwen-image-2-1")) },
  handler: async (ctx, args) => {
    const [project, organization, plan] = await Promise.all([ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.planId)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    assertOwned(project._id, plan);
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
    if (!plan || latest?._id !== plan._id || plan.projectVersion !== project.version || (plan.researchVersion ?? 0) !== (project.researchVersion ?? 0))
      throw new Error("Review and save a current plan before preparing a render brief");
    if (!Number.isInteger(args.entryIndex) || args.entryIndex < 0 || args.entryIndex >= 28) throw new Error("Invalid calendar entry");
    let entries: unknown;
    try { entries = JSON.parse(plan.calendar); } catch { throw new Error("The saved calendar is not structured"); }
    if (!Array.isArray(entries) || entries.length > 28) throw new Error("The saved calendar is invalid");
    const entry = entries[args.entryIndex];
    if (!entry || typeof entry !== "object" || typeof entry.videoScript !== "string" || !entry.videoScript.trim() || entry.videoScript.length > 10_000 ||
        typeof entry.channel !== "string" || entry.channel.length > 40 || typeof entry.format !== "string" || entry.format.length > 200)
      throw new Error("This calendar entry needs a bounded creative script");
    const existing = await ctx.db.query("marketingRenderBriefs").withIndex("by_plan_entry_model", q => q.eq("planId", plan._id).eq("entryIndex", args.entryIndex).eq("modelId", args.modelId)).unique();
    if (existing) return { briefId: existing._id, reused: true };
    const briefId = await ctx.db.insert("marketingRenderBriefs", { organizationId: organization._id, projectId: project._id,
      planId: plan._id, entryIndex: args.entryIndex, projectVersion: project.version, researchVersion: project.researchVersion ?? 0,
      modelId: args.modelId, prompt: entry.videoScript.trim(), channel: entry.channel, format: entry.format, createdAt: Date.now() });
    return { briefId, reused: false };
  },
});

export const save = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    expectedProjectVersion: v.number(),
    expectedResearchVersion: v.number(),
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
    if ((project.researchVersion ?? 0) !== args.expectedResearchVersion)
      throw new Error("Research sources changed; refresh and review the plan.");
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
      projectVersion: project.version, researchVersion: project.researchVersion ?? 0, revision: revision + 1,
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
    const runId = await ctx.db.insert("marketingPlanRuns", { organizationId: organization._id, projectId, requestKey, projectVersion: project.version, researchVersion: project.researchVersion ?? 0, baseRevision: latest?.revision ?? 0, status: "queued", createdAt: now, updatedAt: now });
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
    if (!project || project.version !== run.projectVersion || (project.researchVersion ?? 0) !== (run.researchVersion ?? 0)) {
      await ctx.db.patch(runId, { status: "failed", error: "Project brief changed before planning started.", updatedAt: Date.now() });
      return null;
    }
    await ctx.db.patch(runId, { status: "running", updatedAt: Date.now() });
    const research = await ctx.db.query("marketingResearch").withIndex("by_project", q => q.eq("projectId", project._id)).take(10);
    return { projectId: project._id, name: project.name, website: project.website,
      offer: project.offer, audience: project.audience, facts: project.facts,
      goal: project.goal, tone: project.tone, timezone: project.timezone, cadence: project.cadence,
      research: research.filter(source => source.kind !== "project" || new URL(source.url).hostname === new URL(project.website).hostname)
        .map(({ url, title, description, excerpt, kind, origin, capturedAt }) => ({ url, title, description, excerpt, kind, origin: origin ?? (kind === "project" ? "project" : "manual"), capturedAt })) };
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
    if (!project || project.version !== run.projectVersion || (project.researchVersion ?? 0) !== (run.researchVersion ?? 0) || (latest?.revision ?? 0) !== run.baseRevision)
      error = "The brief, research or plan changed while the model was working. Generate a fresh plan.";
    if (!error && (!args.strategy?.trim() || args.strategy.length > 20_000 || !args.calendar?.trim() || args.calendar.length > 20_000 || (args.sources?.length ?? 0) > 10_000))
      error = "The planning result was incomplete or exceeded size limits.";
    if (error) {
      await ctx.db.patch(args.runId, { status: "failed", error, updatedAt: Date.now() });
      return { saved: false };
    }
    await ctx.db.insert("marketingPlans", { organizationId: run.organizationId, projectId: run.projectId,
      projectVersion: run.projectVersion, researchVersion: run.researchVersion ?? 0, revision: run.baseRevision + 1, strategy: args.strategy!,
      calendar: args.calendar!, sources: args.sources ?? "", origin: "ai", createdAt: Date.now() });
    await ctx.db.patch(args.runId, { status: "completed", updatedAt: Date.now() });
    return { saved: true };
  },
});

/** Convert a saved plan entry into a draft only; no approval or dispatch. */
export const createDraft = internalMutation({
  args: { projectId: v.id("marketingProjects"), planId: v.id("marketingPlans"),
    entryIndex: v.number(), channelId: v.id("marketingChannels") },
  handler: async (ctx, args) => {
    const [project, organization, plan, channel] = await Promise.all([
      ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.planId), ctx.db.get(args.channelId),
    ]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    assertOwned(project._id, plan); assertOwned(project._id, channel);
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
    if (!plan || latest?._id !== plan._id || plan.projectVersion !== project.version || (plan.researchVersion ?? 0) !== (project.researchVersion ?? 0)) throw new Error("Review and save a current plan before creating a draft");
    if (!Number.isInteger(args.entryIndex) || args.entryIndex < 0 || args.entryIndex >= 28) throw new Error("Invalid calendar entry");
    let entries: unknown;
    try { entries = JSON.parse(plan.calendar); } catch { throw new Error("The saved calendar is not a structured plan"); }
    if (!Array.isArray(entries) || entries.length > 28) throw new Error("The saved calendar is invalid");
    const entry = entries[args.entryIndex] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object" || !Number.isInteger(entry.day) || Number(entry.day) < 1 || Number(entry.day) > 14 ||
        typeof entry.channel !== "string" || typeof entry.caption !== "string" || typeof entry.format !== "string" ||
        !Array.isArray(entry.hashtags) || entry.hashtags.length > 8 || !entry.hashtags.every(tag => typeof tag === "string" && tag.length <= 100))
      throw new Error("The saved calendar entry is incomplete");
    const account = channel ? await ctx.db.get(channel.accountId) : null;
    if (!channel || !account || account.platform !== entry.channel || !["instagram", "x", "reddit"].includes(account.platform))
      throw new Error("Choose a matching project social channel");
    const idempotencyKey = `plan:${plan._id}:${args.entryIndex}:${channel._id}`;
    const existing = await ctx.db.query("marketingItems").withIndex("by_idempotency", q => q.eq("idempotencyKey", idempotencyKey)).unique();
    if (existing) return { itemId: existing._id, reused: true };
    if (project.openItemCount >= MAX_CONTENT_ROWS) throw new Error("Project content limit reached");
    const asset = project.defaultAssetId ? await ctx.db.get(project.defaultAssetId) : null;
    if (asset) { assertOwned(project._id, asset); if (!asset.rightsConfirmed) throw new Error("Confirm media rights first"); }
    if (account.platform === "instagram" && !asset) throw new Error("Add verified project media before preparing an Instagram draft");
    const tags = (entry.hashtags as string[]).map(tag => tag.trim()).filter(Boolean).join(" ");
    const content = text(`${entry.caption}${tags ? `\n\n${tags}` : ""}`, "Content", account.platform === "x" ? 280 : account.platform === "instagram" ? 2200 : 10000);
    const now = Date.now();
    const itemId = await ctx.db.insert("marketingItems", { organizationId: project.organizationId, projectId: project._id,
      planId: plan._id, planEntryIndex: args.entryIndex, channelId: channel._id, kind: "post", title: text(entry.format, "Format", 200),
      content, scheduledAt: localPublicationTime(now, Number(entry.day), project.timezone),
      ...(asset ? { assetId: asset._id } : {}), version: 1, status: "draft", idempotencyKey,
      heldIntegrationMinor: 0, heldAdvertisingMinor: 0, nextCheckAt: now, createdAt: now, updatedAt: now });
    await ctx.db.patch(project._id, { openItemCount: project.openItemCount + 1, updatedAt: now });
    return { itemId, reused: false };
  },
});
