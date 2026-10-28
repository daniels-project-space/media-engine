import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findDefaultOrganization } from "./controlPlaneModel";
import { assertOwned, localPublicationTime, MAX_CONTENT_ROWS, snapshotHash, text } from "./marketingPolicy";

// Read the existing global kill switch only through the authenticated gateway.
// Retired public settings functions intentionally always reject their callers.
export const aiAllowed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "aiEnabled")).unique();
    return row?.value === true;
  },
});

export const latestAiCheck = internalQuery({
  args: { projectId: v.id("marketingProjects"), asOfMinute: v.number() },
  handler: async (ctx, { projectId, asOfMinute }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    const check = await ctx.db.query("marketingAiChecks").withIndex("by_project", q => q.eq("projectId", projectId)).unique();
    return check ? { ...check, recoverable: check.status !== "completed" && check.updatedAt < asOfMinute * 60_000 - 120_000 } : null;
  },
});

export const startAiCheck = internalMutation({
  args: { projectId: v.id("marketingProjects"), requestKey: v.string() },
  handler: async (ctx, { projectId, requestKey }) => {
    const [project, organization] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    if (!/^[a-f0-9-]{36}$/.test(requestKey)) throw new Error("Invalid diagnostic request");
    const check = await ctx.db.query("marketingAiChecks").withIndex("by_project", q => q.eq("projectId", projectId)).unique();
    if (check?.requestKey === requestKey) return { status: check.status };
    if (check && Date.now() - check.updatedAt < 120_000) throw new Error("Wait before starting another worker check.");
    const data = { projectId, requestKey, status: "queued" as const, outcome: undefined, updatedAt: Date.now() };
    if (check) await ctx.db.patch(check._id, data); else await ctx.db.insert("marketingAiChecks", data);
    return { status: "queued" as const };
  },
});

export const claimAiCheck = internalMutation({
  args: { projectId: v.id("marketingProjects"), requestKey: v.string() },
  handler: async (ctx, { projectId, requestKey }) => {
    const check = await ctx.db.query("marketingAiChecks").withIndex("by_project", q => q.eq("projectId", projectId)).unique();
    if (!check || check.requestKey !== requestKey || check.status !== "queued") return false;
    await ctx.db.patch(check._id, { status: "running", updatedAt: Date.now() });
    return true;
  },
});

export const finishAiCheck = internalMutation({
  args: { projectId: v.id("marketingProjects"), requestKey: v.string(), outcome: v.union(v.literal("subscription-login"), v.literal("unavailable")) },
  handler: async (ctx, { projectId, requestKey, outcome }) => {
    const check = await ctx.db.query("marketingAiChecks").withIndex("by_project", q => q.eq("projectId", projectId)).unique();
    if (!check || check.requestKey !== requestKey || check.status !== "running") return false;
    await ctx.db.patch(check._id, { status: "completed", outcome, updatedAt: Date.now() });
    return true;
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
    const [briefs, latest] = await Promise.all([
      ctx.db.query("marketingRenderBriefs").withIndex("by_project_created", q => q.eq("projectId", projectId)).order("desc").take(25),
      ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", projectId)).order("desc").first(),
    ]);
    return briefs.map(brief => ({ ...brief, stale: latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0) }));
  },
});

export const getRenderBrief = internalQuery({
  args: { projectId: v.id("marketingProjects"), briefId: v.id("marketingRenderBriefs") },
  handler: async (ctx, { projectId, briefId }) => {
    const [project, organization, brief] = await Promise.all([ctx.db.get(projectId), findDefaultOrganization(ctx), ctx.db.get(briefId)]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    assertOwned(projectId, brief);
    if (!brief) throw new Error("Render brief not found");
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", projectId)).order("desc").first();
    return { modelId: brief.modelId, prompt: brief.prompt, format: brief.format,
      stale: latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0) };
  },
});

export const stageHyperMediaRequest = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    briefId: v.id("marketingRenderBriefs"),
    modelId: v.union(v.literal("minimax-h3"), v.literal("qwen-image-2-1")),
    requestGuideHash: v.string(),
    environmentId: v.optional(v.string()),
    quality: v.union(
      v.object({
        kind: v.literal("video"), steps: v.number(), width: v.number(), height: v.number(), frames: v.number(), fps: v.number(),
        durationSeconds: v.number(), precision: v.string(), approximateCache: v.boolean(),
        postprocess: v.object({ latentScale: v.number(), videoRestoration: v.string(), finalWidth: v.number(), finalHeight: v.number(), required: v.boolean() }),
      }),
      v.object({
        kind: v.literal("image"), precision: v.string(), steps: v.number(), cfg: v.number(), outputResolution: v.number(),
        useKvCache: v.boolean(), cpuOffload: v.boolean(), defaultSeed: v.number(),
      }),
    ),
    settings: v.union(v.object({}), v.object({ width: v.number(), height: v.number() })),
    blockers: v.array(v.union(
      v.literal("native-model-unqualified"),
      v.literal("gpu-profile-unverified"),
      v.literal("model-gpu-unqualified"),
      v.literal("project-connection-missing"),
      v.literal("project-connection-unavailable"),
      v.literal("environment-required"),
      v.literal("environment-model-mismatch"),
      v.literal("environment-not-prepared"),
      v.literal("requested-format-not-supported"),
      v.literal("capacity-unverified"),
      v.literal("spend-control-unverified"),
      v.literal("output-delivery-unverified"),
      v.literal("dispatch-disabled"),
    )),
  },
  handler: async (ctx, args) => {
    if (args.blockers.length > 16) throw new Error("Too many Hyper render readiness blockers");
    const [project, organization, brief] = await Promise.all([
      ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.briefId),
    ]);
    if (!project || !organization || project.organizationId !== organization._id)
      throw new Error("Marketing project not found");
    assertOwned(project._id, brief);
    if (!brief) throw new Error("Render brief not found");
    if (brief.modelId !== args.modelId)
      throw new Error("The selected Hyper model does not match this marketing brief");
    if (args.quality.kind !== (args.modelId === "minimax-h3" ? "video" : "image"))
      throw new Error("The Hyper quality profile does not match the selected model");
    if (!/^[a-f0-9]{64}$/.test(args.requestGuideHash))
      throw new Error("The live Hyper request guide fingerprint is invalid");
    if (args.environmentId && !/^[0-9a-f-]{36}$/i.test(args.environmentId))
      throw new Error("The Hyper environment ID is invalid");
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
    if (latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0))
      throw new Error("Review and save the current plan before staging its media request");
    const prompt = text(brief.prompt, "creative prompt", args.modelId === "minimax-h3" ? 20_000 : 10_000);
    const outputContentType = args.modelId === "minimax-h3" ? "video/mp4" as const : "image/png" as const;
    const requestHash = snapshotHash({
      projectId: project._id,
      briefId: brief._id,
      modelId: brief.modelId,
      outputContentType,
      format: brief.format,
      requestGuideHash: args.requestGuideHash,
      environmentId: args.environmentId ?? null,
      quality: args.quality,
      inputs: { prompt },
      settings: args.settings,
      inputRefs: [],
      outputKind: "final",
      finalRetention: "project-default",
    });
    const requestKey = `media-engine-hyper:${brief._id}:${requestHash.slice(0, 24)}`;
    const renderRequest = {
      state: "staged" as const,
      requestHash,
      requestKey,
      requestGuideHash: args.requestGuideHash,
      modelId: args.modelId,
      outputContentType,
      ...(args.environmentId ? { environmentId: args.environmentId } : {}),
      quality: args.quality,
      settings: args.settings,
      blockers: args.blockers,
      checkedAt: Date.now(),
    };
    const reused = brief.renderRequest?.requestHash === requestHash;
    await ctx.db.patch(brief._id, { renderRequest });
    return { request: renderRequest, reused };
  },
});

export const authorizeHyperMediaRequest = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    briefId: v.id("marketingRenderBriefs"),
    requestHash: v.string(),
    rightsConfirmed: v.literal(true),
    spendAuthorized: v.literal(true),
  },
  handler: async (ctx, args) => {
    const [project, organization, brief] = await Promise.all([
      ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.briefId),
    ]);
    if (!project || !organization || project.organizationId !== organization._id)
      throw new Error("Marketing project not found");
    assertOwned(project._id, brief);
    if (!brief) throw new Error("Render brief not found");
    const latest = await ctx.db.query("marketingPlans").withIndex("by_project_revision", q => q.eq("projectId", project._id)).order("desc").first();
    if (latest?._id !== brief.planId || brief.projectVersion !== project.version || brief.researchVersion !== (project.researchVersion ?? 0))
      throw new Error("Review and save the current strategy before authorizing this render");
    const request = brief.renderRequest;
    if (!request || request.state !== "staged" || request.requestHash !== args.requestHash)
      throw new Error("The exact Hyper request changed. Refresh and review it before authorizing");
    if (Date.now() - request.checkedAt > 5 * 60_000)
      throw new Error("Hyper readiness is stale. Refresh the request before authorizing");
    if (request.blockers.length > 0)
      throw new Error(`Hyper submission is blocked: ${request.blockers.join(", ")}`);
    if (!Number.isSafeInteger(project.generationLimitMinor) || project.generationLimitMinor <= 0)
      throw new Error("Set a positive project generation allowance before authorizing a render");

    const authorization = {
      requestHash: request.requestHash,
      authorizedAt: Date.now(),
      generationLimitMinor: project.generationLimitMinor,
      currency: project.currency,
      source: "owner-action" as const,
    };
    await ctx.db.patch(brief._id, { renderRequest: { ...request, authorization } });
    return { authorizedAt: authorization.authorizedAt, generationLimitMinor: authorization.generationLimitMinor, currency: authorization.currency };
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
    if (!entry || typeof entry !== "object" || typeof entry.channel !== "string" || entry.channel.length > 40 ||
        typeof entry.format !== "string" || entry.format.length > 200)
      throw new Error("This calendar entry is not a supported creative item");
    const row = entry as Record<string, unknown>;
    const videoScript = typeof row.videoScript === "string" ? row.videoScript.trim() : "";
    const videoPrompt = typeof row.videoPrompt === "string" ? row.videoPrompt.trim() : "";
    const imagePrompt = typeof row.imagePrompt === "string" ? row.imagePrompt.trim() : "";
    const prompt = args.modelId === "minimax-h3" ? (videoPrompt || videoScript) : imagePrompt;
    const promptLimit = args.modelId === "minimax-h3" ? 20_000 : 10_000;
    if (!prompt || prompt.length > promptLimit)
      throw new Error(args.modelId === "minimax-h3"
        ? "This video entry needs a separate bounded render prompt or a legacy video script"
        : "This calendar entry needs a separate bounded image-generation prompt");
    if (args.modelId === "minimax-h3" && (!videoScript || videoScript.length > 10_000))
      throw new Error("This video entry needs a bounded human-readable script");
    if (args.modelId === "qwen-image-2-1" && videoScript && !imagePrompt)
      throw new Error("A video script cannot be used as an image-generation prompt");
    const existing = await ctx.db.query("marketingRenderBriefs").withIndex("by_plan_entry_model", q => q.eq("planId", plan._id).eq("entryIndex", args.entryIndex).eq("modelId", args.modelId)).unique();
    if (existing) return { briefId: existing._id, reused: true };
    const briefId = await ctx.db.insert("marketingRenderBriefs", { organizationId: organization._id, projectId: project._id,
      planId: plan._id, entryIndex: args.entryIndex, projectVersion: project.version, researchVersion: project.researchVersion ?? 0,
      modelId: args.modelId, prompt, ...(args.modelId === "minimax-h3" ? { script: videoScript } : {}),
      channel: entry.channel, format: entry.format, createdAt: Date.now() });
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
    entryIndex: v.number(), channelId: v.optional(v.id("marketingChannels")) },
  handler: async (ctx, args) => {
    const [project, organization, plan, channel] = await Promise.all([
      ctx.db.get(args.projectId), findDefaultOrganization(ctx), ctx.db.get(args.planId), args.channelId ? ctx.db.get(args.channelId) : null,
    ]);
    if (!project || !organization || project.organizationId !== organization._id) throw new Error("Marketing project not found");
    assertOwned(project._id, plan); if (args.channelId) assertOwned(project._id, channel);
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
    if (entry.channel !== "instagram" && entry.channel !== "x" && entry.channel !== "reddit") throw new Error("Choose a supported social platform");
    const localTime = entry.localTime === undefined ? "09:00" : entry.localTime;
    if (typeof localTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime))
      throw new Error("The saved calendar entry needs a local posting time in HH:MM format");
    const platform = entry.channel;
    const account = channel ? await ctx.db.get(channel.accountId) : null;
    if (args.channelId && (!channel || !account || account.platform !== platform))
      throw new Error("Choose a matching project social channel");
    const idempotencyKey = `plan:${plan._id}:${args.entryIndex}:${channel?._id ?? "unassigned"}`;
    const existing = await ctx.db.query("marketingItems").withIndex("by_idempotency", q => q.eq("idempotencyKey", idempotencyKey)).unique();
    if (existing) return { itemId: existing._id, reused: true };
    if (project.openItemCount >= MAX_CONTENT_ROWS) throw new Error("Project content limit reached");
    const asset = project.defaultAssetId ? await ctx.db.get(project.defaultAssetId) : null;
    if (asset) { assertOwned(project._id, asset); if (!asset.rightsConfirmed) throw new Error("Confirm media rights first"); }
    if (channel && platform === "instagram" && !asset) throw new Error("Add verified project media before preparing an Instagram draft");
    const sections = [entry.caption.trim()];
    for (const field of ["cta", "promotion"] as const) {
      const value = entry[field];
      if (value === undefined || value === "") continue;
      const maxLength = field === "cta" ? 300 : 500;
      if (typeof value !== "string" || value.length > maxLength)
        throw new Error(`The saved calendar entry has an invalid ${field}`);
      if (!entry.caption.toLowerCase().includes(value.trim().toLowerCase()) &&
          !sections.some(section => section.toLowerCase().includes(value.trim().toLowerCase())))
        sections.push(value.trim());
    }
    const tags = (entry.hashtags as string[]).map(tag => tag.trim()).filter(Boolean).join(" ");
    const content = text(`${[...sections, ...(tags ? [tags] : [])].join("\n\n")}`, "Content", platform === "x" ? 280 : platform === "instagram" ? 2200 : 10000);
    const now = Date.now();
    const itemId = await ctx.db.insert("marketingItems", { organizationId: project.organizationId, projectId: project._id,
      planId: plan._id, planEntryIndex: args.entryIndex, ...(channel ? { channelId: channel._id } : {}), intendedPlatform: platform, kind: "post", title: text(entry.format, "Format", 200),
      content, scheduledAt: localPublicationTime(now, Number(entry.day), project.timezone, localTime),
      ...(asset ? { assetId: asset._id } : {}), version: 1, status: "draft", idempotencyKey,
      heldIntegrationMinor: 0, heldAdvertisingMinor: 0, nextCheckAt: now, createdAt: now, updatedAt: now });
    await ctx.db.patch(project._id, { openItemCount: project.openItemCount + 1, updatedAt: now });
    return { itemId, reused: false };
  },
});
