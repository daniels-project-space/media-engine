import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const tier = v.union(v.literal("basic"), v.literal("standard"), v.literal("premium"));
const messageRole = v.union(v.literal("buyer"), v.literal("operator"), v.literal("assistant"), v.literal("system"));
const messageStatus = v.union(v.literal("received"), v.literal("draft"), v.literal("approved"), v.literal("sent"));
const intakeStatus = v.union(v.literal("collecting"), v.literal("needs_reply"), v.literal("ready_to_plan"), v.literal("complete"));
const renderKind = v.union(v.literal("draft"), v.literal("final"));
const DISPATCH_TOKEN_MIN_CHARS = 43; // 32 random bytes encoded as base64url
const DISPATCH_TOKEN_MAX_CHARS = 128;

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

function assertDispatchToken(value: string): void {
  if (value.length < DISPATCH_TOKEN_MIN_CHARS || value.length > DISPATCH_TOKEN_MAX_CHARS) {
    throw new Error("invalid render dispatch capability");
  }
}

function expectedRenderStage(kind: "draft" | "final"): "drafting" | "rendering" {
  return kind === "draft" ? "drafting" : "rendering";
}

function assertClientReferenceKey(value: string | undefined): asserts value is string {
  if (!value || !value.startsWith("products/client/")) {
    throw new Error("the approved render plan must use a private client reference image");
  }
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
    if (args.productImageKey !== undefined) assertClientReferenceKey(args.productImageKey);
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
    assertClientReferenceKey(productImageKey);
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
      approvedShots: undefined,
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
    await ctx.db.patch(projectId, {
      approvedPlanVersion: project.storyboardVersion,
      approvedShots: project.shots,
      lastActivityAt: now,
    });
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
  args: { projectId: v.id("adProjects"), kind: renderKind, dispatchToken: v.string() },
  handler: async (ctx, { projectId, kind, dispatchToken }) => {
    assertDispatchToken(dispatchToken);
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("project not found");
    if (
      !project.renderPlan ||
      !project.storyboardVersion ||
      project.approvedPlanVersion !== project.storyboardVersion ||
      !(project.approvedShots?.length)
    ) {
      throw new Error("the current render plan must be explicitly approved");
    }
    const order = project.orderId ? await ctx.db.get(project.orderId) : null;
    assertClientReferenceKey(order?.productImageKey);
    for (const item of project.approvedShots) {
      if (item.kind === "card") continue;
      if (item.imageKey !== order.productImageKey) {
        throw new Error("the approved storyboard must use the verified client reference image");
      }
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
      dispatchToken,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(projectId, { stage: kind === "draft" ? "drafting" : "rendering", error: undefined, lastActivityAt: now });
    return { jobId, reused: false };
  },
});

/**
 * Atomically consumes the one-time dispatch capability before a Trigger worker
 * can read the approved storyboard, touch R2, or reach a renderer. Retrying
 * the same Trigger run is idempotent; every other run is rejected.
 */
export const claimRenderExecution = internalMutation({
  args: { jobId: v.id("renderJobs"), dispatchToken: v.string(), triggerRunId: v.string() },
  handler: async (ctx, { jobId, dispatchToken, triggerRunId }) => {
    assertDispatchToken(dispatchToken);
    if (!triggerRunId || triggerRunId.length > 256) throw new Error("invalid Trigger run identity");
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("render job not found");

    if (job.status === "running") {
      if (job.workerRunId !== triggerRunId) throw new Error("render job is already claimed by another Trigger run");
    } else {
      if (job.status !== "queued" || job.dispatchToken !== dispatchToken) {
        throw new Error("render job dispatch capability is invalid or has expired");
      }
      await ctx.db.patch(jobId, {
        status: "running",
        workerRunId: triggerRunId,
        triggerRunId,
        dispatchToken: undefined,
        updatedAt: Date.now(),
      });
    }

    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("project not found");
    const order = project.orderId ? await ctx.db.get(project.orderId) : null;
    if (
      !project.renderPlan ||
      project.renderPlan.provider !== "higgsfield" ||
      project.renderPlan.model !== "seedance_2_0" ||
      project.renderPlan.creditSource !== "higgsfield_subscription" ||
      project.renderPlan.fallbackPolicy !== "fail_closed" ||
      project.storyboardVersion !== job.planVersion ||
      project.approvedPlanVersion !== job.planVersion ||
      !project.narrative ||
      !(project.approvedShots?.length) ||
      project.stage !== expectedRenderStage(job.kind)
    ) {
      throw new Error("render job no longer matches an approved Seedance 2.0 plan");
    }
    assertClientReferenceKey(order?.productImageKey);
    for (const item of project.approvedShots) {
      if (item.kind === "card") continue;
      if (item.imageKey !== order.productImageKey) {
        throw new Error("approved storyboard references an unexpected client image");
      }
    }

    return {
      job: { id: job._id, kind: job.kind, planVersion: job.planVersion },
      project: {
        id: project._id,
        buyer: project.buyer,
        title: project.title,
        narrative: project.narrative,
        shots: project.approvedShots,
        renderPlan: project.renderPlan,
      },
      referenceKey: order.productImageKey,
    };
  },
});

/** Creates the post ledger entry only for the active worker that claimed the job. */
export const createRenderPost = internalMutation({
  args: {
    jobId: v.id("renderJobs"),
    triggerRunId: v.string(),
    variantTag: v.string(),
    concept: v.string(),
    hookId: v.string(),
    variantId: v.string(),
  },
  handler: async (ctx, { jobId, triggerRunId, variantTag, concept, hookId, variantId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || job.workerRunId !== triggerRunId) {
      throw new Error("only the claimed render worker can create its post");
    }
    if (job.postId) {
      const existing = await ctx.db.get(job.postId);
      if (!existing || existing.renderJobId !== jobId) throw new Error("render job post binding is invalid");
      return job.postId;
    }
    const project = await ctx.db.get(job.projectId);
    if (!project?.narrative) throw new Error("render project no longer has a narrative");
    const postId = await ctx.db.insert("posts", {
      streamSlug: "client-ads",
      platform: "instagram",
      kind: "reel",
      status: "generating",
      title: `${project.title} — ${job.kind}`,
      hook: project.narrative.arc[0]?.beat,
      caption: project.narrative.corePromise,
      slides: project.approvedShots?.map((item) => ({ prompt: item.motion, role: item.kind ?? "i2v" })),
      externalId: triggerRunId,
      renderJobId: jobId,
      variantTag,
      concept,
      hookId,
      variantId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(jobId, { postId, updatedAt: Date.now() });
    return postId;
  },
});

export const completeRender = internalMutation({
  args: {
    jobId: v.id("renderJobs"),
    triggerRunId: v.string(),
    postId: v.id("posts"),
    creditsUsed: v.number(),
    slides: v.array(v.object({ r2Key: v.optional(v.string()), url: v.optional(v.string()), prompt: v.string(), role: v.optional(v.string()) })),
    qcScore: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, triggerRunId, postId, creditsUsed, slides, qcScore }) => {
    if (!Number.isFinite(creditsUsed) || creditsUsed < 0) throw new Error("invalid Higgsfield credit usage");
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || job.workerRunId !== triggerRunId || job.postId !== postId) {
      throw new Error("only the claimed render worker can complete this job");
    }
    const [project, post] = await Promise.all([ctx.db.get(job.projectId), ctx.db.get(postId)]);
    if (!project) throw new Error("project not found");
    if (!post || post.renderJobId !== jobId) throw new Error("render result does not belong to this job");
    const now = Date.now();
    await ctx.db.patch(postId, { slides, status: "ready", qcScore, error: undefined });
    await ctx.db.patch(jobId, { status: "succeeded", creditsUsed, error: undefined, updatedAt: now });
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

/** Records a failure only from the Trigger run that atomically claimed the job. */
export const failRender = internalMutation({
  args: { jobId: v.id("renderJobs"), triggerRunId: v.string(), error: v.string() },
  handler: async (ctx, { jobId, triggerRunId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || job.workerRunId !== triggerRunId) return { recorded: false };
    const now = Date.now();
    const message = error.slice(0, 1000);
    await ctx.db.patch(jobId, { status: "failed", error: message, updatedAt: now });
    const project = await ctx.db.get(job.projectId);
    if (project && expectedRenderStage(job.kind) === project.stage) {
      await ctx.db.patch(project._id, { stage: "failed", error: message, lastActivityAt: now });
    }
    return { recorded: true };
  },
});

/**
 * The Vercel dispatcher may fail before Trigger accepts the task. Only the
 * still-queued job holding that one-time capability may be marked failed.
 */
export const failQueuedDispatch = internalMutation({
  args: { jobId: v.id("renderJobs"), dispatchToken: v.string(), error: v.string() },
  handler: async (ctx, { jobId, dispatchToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "queued" || job.dispatchToken !== dispatchToken) return { recorded: false };
    const now = Date.now();
    const message = error.slice(0, 1000);
    await ctx.db.patch(jobId, {
      status: "failed",
      dispatchToken: undefined,
      error: message,
      updatedAt: now,
    });
    const project = await ctx.db.get(job.projectId);
    if (project && expectedRenderStage(job.kind) === project.stage) {
      await ctx.db.patch(project._id, { stage: "failed", error: message, lastActivityAt: now });
    }
    return { recorded: true };
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
