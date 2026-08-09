import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const tier = v.union(v.literal("basic"), v.literal("standard"), v.literal("premium"));
const messageRole = v.union(v.literal("buyer"), v.literal("operator"), v.literal("assistant"), v.literal("system"));
const messageStatus = v.union(v.literal("received"), v.literal("draft"), v.literal("approved"), v.literal("sent"));
const intakeStatus = v.union(v.literal("collecting"), v.literal("needs_reply"), v.literal("ready_to_plan"), v.literal("complete"));
const renderKind = v.union(v.literal("draft"), v.literal("final"));

const shot = v.object({
  id: v.optional(v.string()),
  kind: v.optional(v.string()),
  beat: v.optional(v.string()),
  imagePrompt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageKey: v.optional(v.string()),
  motion: v.string(),
  audioCue: v.optional(v.string()),
  seconds: v.number(),
  onText: v.optional(v.string()),
  cardTitle: v.optional(v.string()),
  cardSub: v.optional(v.string()),
});

const narrative = v.object({
  audience: v.string(),
  objective: v.string(),
  corePromise: v.string(),
  insight: v.string(),
  arc: v.array(v.object({ beat: v.string(), purpose: v.string() })),
  voiceover: v.optional(v.string()),
  cta: v.string(),
});

const renderPlan = v.object({
  provider: v.literal("higgsfield"),
  model: v.literal("seedance_2_0"),
  creditSource: v.literal("higgsfield_subscription"),
  aspectRatio: v.union(v.literal("9:16"), v.literal("16:9"), v.literal("1:1")),
  durationSeconds: v.number(),
  audioStrategy: v.string(),
  referencePolicy: v.string(),
  fallbackPolicy: v.literal("fail_closed"),
  providerInstructions: v.array(v.string()),
});

function latestByConcept<T extends { concept?: string; createdAt: number }>(rows: T[], concept: string): T | null {
  return rows.filter((row) => row.concept === concept).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** The complete private workspace read model. Client components never write directly to Convex. */
export const listWorkspace = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [projects, orders, messages, jobs, posts] = await Promise.all([
      ctx.db.query("adProjects").order("desc").collect(),
      ctx.db.query("clientOrders").order("desc").collect(),
      ctx.db.query("projectMessages").collect(),
      ctx.db.query("renderJobs").collect(),
      ctx.db.query("posts").collect(),
    ]);
    const orderById = new Map(orders.map((order) => [order._id, order]));
    return projects.map((project) => {
      const projectMessages = messages
        .filter((message) => message.projectId === project._id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const renderJobs = jobs.filter((job) => job.projectId === project._id).sort((a, b) => b.createdAt - a.createdAt);
      const draft = project.draftPostId
        ? posts.find((post) => post._id === project.draftPostId) ?? null
        : latestByConcept(posts, `studio-${project._id}-draft`);
      const final = project.finalPostId
        ? posts.find((post) => post._id === project.finalPostId) ?? null
        : latestByConcept(posts, `studio-${project._id}-final`);
      return {
        project,
        order: project.orderId ? orderById.get(project.orderId) ?? null : null,
        messages: projectMessages,
        renderJobs,
        draft,
        final,
      };
    });
  },
});

/** Create the canonical request and its first project in one atomic mutation. */
export const createRequest = internalMutation({
  args: {
    buyer: v.string(),
    source: v.union(v.literal("fiverr"), v.literal("direct")),
    tier,
    title: v.string(),
    brief: v.string(),
    productImageKey: v.optional(v.string()),
    pricePence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const orderId = await ctx.db.insert("clientOrders", {
      buyer: args.buyer,
      source: args.source,
      tier: args.tier,
      brief: args.brief,
      productImageKey: args.productImageKey,
      pricePence: args.pricePence,
      status: "new",
      createdAt: now,
    });
    const projectId = await ctx.db.insert("adProjects", {
      buyer: args.buyer,
      title: args.title,
      brief: args.brief,
      orderId,
      source: args.source,
      stage: "scripting",
      intakeStatus: "collecting",
      missingFields: ["goal", "target audience", "key benefit", "product/reference image", "delivery format"],
      lastActivityAt: now,
      createdAt: now,
    });
    await ctx.db.insert("projectMessages", {
      projectId,
      role: "system",
      body: "Request created. The assistant will collect the missing production details before a render plan can be generated.",
      status: "sent",
      createdAt: now,
    });
    return { projectId, orderId };
  },
});

export const appendMessage = internalMutation({
  args: { projectId: v.id("adProjects"), role: messageRole, body: v.string(), status: messageStatus },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("project not found");
    const now = Date.now();
    const id = await ctx.db.insert("projectMessages", { ...args, body: args.body.trim(), createdAt: now });
    await ctx.db.patch(args.projectId, { lastActivityAt: now });
    return id;
  },
});

export const updateIntake = internalMutation({
  args: {
    projectId: v.id("adProjects"),
    status: intakeStatus,
    summary: v.string(),
    missingFields: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("project not found");
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      intakeStatus: args.status,
      intakeSummary: args.summary,
      missingFields: args.missingFields,
      lastActivityAt: now,
    });
  },
});

/** Add a client-owned reference after a request is created, before planning. */
export const setProductReference = internalMutation({
  args: { projectId: v.id("adProjects"), productImageKey: v.string() },
  handler: async (ctx, { projectId, productImageKey }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("project not found");
    if (!project.orderId) throw new Error("project has no client order");
    if (!["scripting", "failed"].includes(project.stage)) {
      throw new Error("the approved plan cannot be changed; create a revision instead");
    }
    const now = Date.now();
    await ctx.db.patch(project.orderId, { productImageKey });
    await ctx.db.patch(projectId, { lastActivityAt: now });
    await ctx.db.insert("projectMessages", {
      projectId,
      role: "system",
      body: "Client-approved product/reference image attached. Reassess intake before generating the render plan.",
      status: "sent",
      createdAt: now,
    });
  },
});

/** Persist a new immutable-by-version narrative, storyboard and provider plan. */
export const persistPlan = internalMutation({
  args: { projectId: v.id("adProjects"), narrative, shots: v.array(shot), renderPlan },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("project not found");
    if (project.intakeStatus !== "ready_to_plan" && project.intakeStatus !== "complete") {
      throw new Error("intake is not complete");
    }
    const now = Date.now();
    const storyboardVersion = (project.storyboardVersion ?? 0) + 1;
    await ctx.db.patch(args.projectId, {
      narrative: args.narrative,
      shots: args.shots,
      renderPlan: args.renderPlan,
      storyboardVersion,
      approvedPlanVersion: undefined,
      intakeStatus: "complete",
      stage: "script_ready",
      error: undefined,
      lastActivityAt: now,
    });
    await ctx.db.insert("projectMessages", {
      projectId: args.projectId,
      role: "system",
      body: `Narrative, storyboard and Seedance 2.0 render plan v${storyboardVersion} are ready for approval.`,
      status: "sent",
      createdAt: now,
    });
    return storyboardVersion;
  },
});

export const approvePlan = internalMutation({
  args: { projectId: v.id("adProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.storyboardVersion || !project.narrative || !project.renderPlan || !(project.shots?.length)) {
      throw new Error("no complete render plan to approve");
    }
    const now = Date.now();
    await ctx.db.patch(projectId, { approvedPlanVersion: project.storyboardVersion, lastActivityAt: now });
    await ctx.db.insert("projectMessages", {
      projectId,
      role: "operator",
      body: `Approved Seedance 2.0 render plan v${project.storyboardVersion}.`,
      status: "sent",
      createdAt: now,
    });
    return project.storyboardVersion;
  },
});

/** Atomically admits one eligible render. A duplicate click reuses an active run. */
export const startRender = internalMutation({
  args: { projectId: v.id("adProjects"), kind: renderKind },
  handler: async (ctx, { projectId, kind }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("project not found");
    if (!project.renderPlan || !project.storyboardVersion || project.approvedPlanVersion !== project.storyboardVersion) {
      throw new Error("the current render plan must be explicitly approved");
    }
    const jobs = await ctx.db.query("renderJobs").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    const active = jobs.find((job) => job.kind === kind && job.planVersion === project.storyboardVersion && (job.status === "queued" || job.status === "running"));
    // A duplicate click after the project has moved into drafting/rendering
    // returns the admitted job instead of producing a second paid render.
    if (active) return { jobId: active._id, reused: true };
    const expectedStage = kind === "draft" ? "script_ready" : "draft_ready";
    const failedSameKind = jobs.some(
      (job) => job.kind === kind && job.planVersion === project.storyboardVersion && job.status === "failed",
    );
    const retryEligible = project.stage === "failed" && failedSameKind && (kind === "draft" || Boolean(project.draftPostId));
    if (project.stage !== expectedStage && !retryEligible) {
      throw new Error(kind === "draft" ? "draft render is not eligible" : "final render needs an approved draft first");
    }
    const attempt = jobs.filter((job) => job.kind === kind && job.planVersion === project.storyboardVersion).length + 1;
    const now = Date.now();
    const jobId = await ctx.db.insert("renderJobs", {
      projectId,
      planVersion: project.storyboardVersion,
      kind,
      idempotencyKey: `${projectId}:${project.storyboardVersion}:${kind}:${attempt}`,
      provider: "higgsfield",
      model: "seedance_2_0",
      creditSource: "higgsfield_subscription",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(projectId, { stage: kind === "draft" ? "drafting" : "rendering", error: undefined, lastActivityAt: now });
    return { jobId, reused: false };
  },
});

export const markRenderDispatched = internalMutation({
  args: { jobId: v.id("renderJobs"), triggerRunId: v.string() },
  handler: async (ctx, { jobId, triggerRunId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("render job not found");
    await ctx.db.patch(jobId, { triggerRunId, status: "running", updatedAt: Date.now() });
  },
});

export const completeRender = internalMutation({
  args: { jobId: v.id("renderJobs"), postId: v.id("posts"), creditsUsed: v.number() },
  handler: async (ctx, { jobId, postId, creditsUsed }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("render job not found");
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("project not found");
    const now = Date.now();
    await ctx.db.patch(jobId, { status: "succeeded", postId, creditsUsed, error: undefined, updatedAt: now });
    if (job.kind === "draft") {
      await ctx.db.patch(project._id, { draftPostId: postId, stage: "draft_ready", lastActivityAt: now });
    } else {
      await ctx.db.patch(project._id, { finalPostId: postId, stage: "final_ready", lastActivityAt: now });
      if (project.orderId) {
        await ctx.db.patch(project.orderId, { deliveryPostId: postId, status: "ready_for_delivery" });
      }
    }
    await ctx.db.insert("projectMessages", {
      projectId: project._id,
      role: "system",
      body: `${job.kind === "draft" ? "Draft" : "Final"} render completed with Seedance 2.0 using ${creditsUsed} Higgsfield credits.`,
      status: "sent",
      createdAt: now,
    });
  },
});

/**
 * Delivery is a human confirmation, not a render side effect. The final asset
 * must be ready first; this mutation records that the operator delivered it
 * through the buyer's actual marketplace or direct-client channel.
 */
export const markDelivered = internalMutation({
  args: { projectId: v.id("adProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("project not found");
    if (!project.orderId) throw new Error("A client order is required before delivery can be marked.");
    if (project.stage !== "final_ready" || !project.finalPostId) {
      throw new Error("The final render must be ready before delivery can be marked.");
    }

    const order = await ctx.db.get(project.orderId);
    if (!order) throw new Error("client order not found");
    if (order.status === "delivered") return { alreadyDelivered: true };
    if (order.status !== "ready_for_delivery") {
      throw new Error("The client order must be ready for delivery before it can be marked delivered.");
    }

    const now = Date.now();
    await ctx.db.patch(order._id, { deliveryPostId: project.finalPostId, status: "delivered" });
    await ctx.db.patch(project._id, { lastActivityAt: now });
    await ctx.db.insert("projectMessages", {
      projectId,
      role: "operator",
      body: "Operator marked the order delivered after manual delivery. Media Engine did not send a marketplace or client message.",
      status: "approved",
      createdAt: now,
    });
    return { alreadyDelivered: false };
  },
});

export const failRender = internalMutation({
  args: { jobId: v.id("renderJobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const now = Date.now();
    await ctx.db.patch(jobId, { status: "failed", error: error.slice(0, 1000), updatedAt: now });
    const project = await ctx.db.get(job.projectId);
    if (project && (project.stage === "drafting" || project.stage === "rendering")) {
      await ctx.db.patch(project._id, { stage: "failed", error: error.slice(0, 1000), lastActivityAt: now });
    }
  },
});

export const getProjectForPlanning = internalQuery({
  args: { projectId: v.id("adProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const [messages, order] = await Promise.all([
      ctx.db.query("projectMessages").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).collect(),
      project.orderId ? ctx.db.get(project.orderId) : null,
    ]);
    return { project, order, messages: messages.sort((a, b) => a.createdAt - b.createdAt) };
  },
});
