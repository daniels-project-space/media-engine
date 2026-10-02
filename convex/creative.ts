import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const tier = v.union(v.literal("basic"), v.literal("standard"), v.literal("premium"));
const messageRole = v.union(v.literal("buyer"), v.literal("operator"), v.literal("assistant"), v.literal("system"));
const messageStatus = v.union(v.literal("received"), v.literal("draft"), v.literal("approved"), v.literal("sent"));
const intakeStatus = v.union(v.literal("collecting"), v.literal("needs_reply"), v.literal("ready_to_plan"), v.literal("complete"));
const renderKind = v.union(v.literal("draft"), v.literal("final"));
const DISPATCH_TOKEN_MIN_CHARS = 43; // 32 random bytes encoded as base64url
const DISPATCH_TOKEN_MAX_CHARS = 128;
const DEFAULT_MEDIA_ENGINE_ORGANIZATION = {
  slug: "media-engine",
  name: "Media Engine",
  kind: "agency" as const,
  status: "active" as const,
};
const PLAN_APPROVAL_RESOURCE_TYPE = "ad_project_plan";
const PLAN_APPROVAL_ACTION_KIND = "render_plan_approval";
const RENDER_ACTION_KIND = "render_engine_seedance_i2v_render";
const MODERATE_RISK = "moderate" as const;

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
  provider: v.union(v.literal("higgsfield"), v.literal("render-engine")),
  model: v.union(v.literal("seedance_2_0"), v.literal("seedance-2.5-i2v")),
  creditSource: v.union(v.literal("higgsfield_subscription"), v.literal("engine_hosted_budget")),
  aspectRatio: v.union(v.literal("9:16"), v.literal("16:9"), v.literal("1:1")),
  durationSeconds: v.number(),
  audioStrategy: v.string(),
  referencePolicy: v.string(),
  referenceFrameSha256: v.optional(v.string()),
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

/**
 * Control-plane snapshots are stored alongside their deterministic fingerprint.
 * The full snapshot comparison below is the authority; the fingerprint makes
 * accidental drift obvious in list views and action receipts without exposing
 * a client brief to a provider.
 */
function stableSerialize(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function snapshotHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `stable-v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}:${serialized.length}`;
}

function makePlanSnapshot(
  projectId: Id<"adProjects">,
  planVersion: number,
  narrativeValue: unknown,
  shotsValue: unknown,
  renderPlanValue: unknown,
) {
  return {
    resourceType: PLAN_APPROVAL_RESOURCE_TYPE,
    resourceId: String(projectId),
    planVersion,
    plan: {
      narrative: narrativeValue,
      shots: shotsValue,
      renderPlan: renderPlanValue,
    },
  };
}

function hasMatchingSnapshot(snapshot: unknown, storedHash: string, expected: unknown): boolean {
  return storedHash === snapshotHash(expected) && stableSerialize(snapshot) === stableSerialize(expected);
}

async function ensureDefaultMediaEngineOrganization(ctx: MutationCtx, now: number): Promise<Id<"organizations">> {
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_MEDIA_ENGINE_ORGANIZATION.slug))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("organizations", { ...DEFAULT_MEDIA_ENGINE_ORGANIZATION, createdAt: now, updatedAt: now });
}

async function ensureProjectOrganization(
  ctx: MutationCtx,
  project: { _id: Id<"adProjects">; organizationId?: Id<"organizations"> },
  order: { _id: Id<"clientOrders">; organizationId?: Id<"organizations"> } | null,
  now: number,
): Promise<Id<"organizations">> {
  const organizationId = project.organizationId ?? order?.organizationId ?? (await ensureDefaultMediaEngineOrganization(ctx, now));
  if (project.organizationId !== organizationId) await ctx.db.patch(project._id, { organizationId });
  if (order && order.organizationId !== organizationId) await ctx.db.patch(order._id, { organizationId });
  return organizationId;
}

async function findPlanApproval(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  projectId: Id<"adProjects">,
  planVersion: number,
  status: "pending" | "approved",
) {
  const approvals = await ctx.db
    .query("approvalRequests")
    .withIndex("by_resource", (q) =>
      q.eq("resourceType", PLAN_APPROVAL_RESOURCE_TYPE).eq("resourceId", String(projectId)).eq("planVersion", planVersion),
    )
    .collect();
  return approvals
    .filter(
      (approval) =>
        approval.organizationId === organizationId && approval.actionKind === PLAN_APPROVAL_ACTION_KIND && approval.status === status,
    )
    .sort((left, right) => right.requestedAt - left.requestedAt)[0] ?? null;
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
    const organizationId = await ensureDefaultMediaEngineOrganization(ctx, now);
    const orderId = await ctx.db.insert("clientOrders", {
      organizationId,
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
      organizationId,
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
    const order = project.orderId ? await ctx.db.get(project.orderId) : null;
    const organizationId = await ensureProjectOrganization(ctx, project, order, now);
    const storyboardVersion = (project.storyboardVersion ?? 0) + 1;
    const approvalSnapshot = makePlanSnapshot(args.projectId, storyboardVersion, args.narrative, args.shots, args.renderPlan);

    // Versions are immutable. Keep superseded requests as an audit trail but
    // prevent an old pending plan from being approved after a revision exists.
    const priorApprovals = await ctx.db
      .query("approvalRequests")
      .withIndex("by_resource", (q) => q.eq("resourceType", PLAN_APPROVAL_RESOURCE_TYPE).eq("resourceId", String(args.projectId)))
      .collect();
    for (const approval of priorApprovals) {
      if (approval.status === "pending" && approval.actionKind === PLAN_APPROVAL_ACTION_KIND) {
        await ctx.db.patch(approval._id, {
          status: "cancelled",
          decidedAt: now,
          decidedBy: "media-engine:creative-planner",
        });
      }
    }

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
    await ctx.db.insert("approvalRequests", {
      organizationId,
      resourceType: PLAN_APPROVAL_RESOURCE_TYPE,
      resourceId: String(args.projectId),
      planVersion: storyboardVersion,
      actionKind: PLAN_APPROVAL_ACTION_KIND,
      snapshotHash: snapshotHash(approvalSnapshot),
      snapshot: approvalSnapshot,
      riskClass: MODERATE_RISK,
      status: "pending",
      requestedAt: now,
      requestedBy: "media-engine:creative-planner",
    });
    await ctx.db.insert("projectMessages", {
      projectId: args.projectId,
      role: "system",
      body: `Narrative, storyboard and ${args.renderPlan.model} render plan v${storyboardVersion} are ready for approval.`,
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
    const order = project.orderId ? await ctx.db.get(project.orderId) : null;
    const organizationId = await ensureProjectOrganization(ctx, project, order, now);
    const approvalSnapshot = makePlanSnapshot(
      projectId,
      project.storyboardVersion,
      project.narrative,
      project.shots,
      project.renderPlan,
    );
    // The UI intentionally submits only a project ID. Resolve the exact
    // current-version pending record here instead of letting a caller select a
    // stale approval ID or silently approve mutable project fields.
    const pendingApproval = await findPlanApproval(ctx, organizationId, projectId, project.storyboardVersion, "pending");
    if (!pendingApproval) {
      const approvedApproval = await findPlanApproval(ctx, organizationId, projectId, project.storyboardVersion, "approved");
      if (
        project.approvedPlanVersion === project.storyboardVersion &&
        approvedApproval &&
        hasMatchingSnapshot(approvedApproval.snapshot, approvedApproval.snapshotHash, approvalSnapshot)
      ) {
        return project.storyboardVersion;
      }
      throw new Error("the current render plan has no matching pending approval record");
    }
    if (!hasMatchingSnapshot(pendingApproval.snapshot, pendingApproval.snapshotHash, approvalSnapshot)) {
      throw new Error("the current render plan approval record does not match its immutable snapshot");
    }
    await ctx.db.patch(projectId, {
      approvedPlanVersion: project.storyboardVersion,
      approvedShots: project.shots,
      lastActivityAt: now,
    });
    await ctx.db.patch(pendingApproval._id, {
      status: "approved",
      decidedAt: now,
      decidedBy: "media-engine:operator",
    });
    await ctx.db.insert("projectMessages", {
      projectId,
      role: "operator",
      body: `Approved ${project.renderPlan.model} render plan v${project.storyboardVersion}.`,
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
      project.renderPlan.provider !== "render-engine" ||
      project.renderPlan.model !== "seedance-2.5-i2v" ||
      project.renderPlan.creditSource !== "engine_hosted_budget" ||
      project.renderPlan.aspectRatio !== "9:16" ||
      !/^[a-f0-9]{64}$/.test(project.renderPlan.referenceFrameSha256 ?? "") ||
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
    const matching = jobs.filter((job) => job.kind === kind && job.planVersion === project.storyboardVersion);
    const active = matching.find((job) => job.status === "queued" || job.status === "running");
    // An already claimed worker owns the only paid execution for this plan.
    if (active?.status === "running") return { jobId: active._id, reused: true };
    const failed = matching.filter((job) => job.status === "failed");
    if (failed.length > 1) throw new Error("multiple failed render attempts require operator reconciliation");
    const resume = active ?? failed[0];
    const expectedStage = kind === "draft" ? "script_ready" : "draft_ready";
    const retryEligible = project.stage === "failed" && resume?.status === "failed" && (kind === "draft" || Boolean(project.draftPostId));
    const queuedEligible = project.stage === expectedRenderStage(kind) && resume?.status === "queued";
    if (project.stage !== expectedStage && !retryEligible && !queuedEligible) {
      throw new Error(kind === "draft" ? "draft render is not eligible" : "final render needs an approved draft first");
    }
    const attempt = jobs.filter((job) => job.kind === kind && job.planVersion === project.storyboardVersion).length + 1;
    const now = Date.now();
    const organizationId = await ensureProjectOrganization(ctx, project, order, now);
    const approvalSnapshot = makePlanSnapshot(
      projectId,
      project.storyboardVersion,
      project.narrative,
      project.approvedShots,
      project.renderPlan,
    );
    const approval = await findPlanApproval(ctx, organizationId, projectId, project.storyboardVersion, "approved");
    if (!approval || !hasMatchingSnapshot(approval.snapshot, approval.snapshotHash, approvalSnapshot)) {
      throw new Error("the current render plan must have a matching approved control-plane record");
    }
    if (resume) {
      const wasFailed = resume.status === "failed";
      const action = resume.actionId ? await ctx.db.get(resume.actionId) : null;
      const actionPayload = {
        resourceType: PLAN_APPROVAL_RESOURCE_TYPE, resourceId: String(projectId), planVersion: project.storyboardVersion,
        renderKind: kind, provider: project.renderPlan.provider, model: project.renderPlan.model,
        creditSource: project.renderPlan.creditSource,
      };
      if (resume.provider !== project.renderPlan.provider || resume.model !== project.renderPlan.model ||
          resume.creditSource !== project.renderPlan.creditSource ||
          !resume.approvalId || resume.approvalId !== approval._id || !action ||
          action.organizationId !== organizationId || action.approvalId !== approval._id ||
          action.renderJobId !== resume._id || action.actionKind !== RENDER_ACTION_KIND ||
          action.idempotencyKey !== resume.idempotencyKey ||
          !hasMatchingSnapshot(action.payloadSnapshot, action.payloadHash, actionPayload) ||
          action.status !== (wasFailed ? "failed" : "queued")) {
        throw new Error("prior render action needs operator reconciliation before resume");
      }
      // Rotate the private dispatch capability even after a lost Trigger ACK.
      // A late old worker and the replacement cannot both claim this job.
      await ctx.db.patch(resume._id, { status: "queued", dispatchToken,
        workerRunId: undefined, triggerRunId: undefined, error: undefined, updatedAt: now });
      if (wasFailed) {
        await ctx.db.patch(action._id, { status: "queued", triggerRunId: undefined, error: undefined, updatedAt: now });
      }
      await ctx.db.patch(projectId, { stage: expectedRenderStage(kind), error: undefined, lastActivityAt: now });
      return { jobId: resume._id, reused: false, resumed: true };
    }
    const idempotencyKey = `${projectId}:${project.storyboardVersion}:${kind}:${attempt}`;
    // Keep the ledger payload deliberately metadata-only. The immutable plan
    // snapshot remains on the approval record; the action ledger must not
    // duplicate the client brief or private R2 reference key.
    const actionPayload = {
      resourceType: PLAN_APPROVAL_RESOURCE_TYPE,
      resourceId: String(projectId),
      planVersion: project.storyboardVersion,
      renderKind: kind,
      provider: project.renderPlan.provider,
      model: project.renderPlan.model,
      creditSource: project.renderPlan.creditSource,
    };
    // Insert the control-plane action before the durable render job. Convex
    // mutations are atomic, so a failure cannot leave one record without the
    // other and Trigger never receives a paid-dispatch capability first.
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId,
      approvalId: approval._id,
      actionKind: RENDER_ACTION_KIND,
      riskClass: MODERATE_RISK,
      status: "queued",
      idempotencyKey,
      payloadHash: snapshotHash(actionPayload),
      payloadSnapshot: actionPayload,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("renderJobs", {
      projectId,
      planVersion: project.storyboardVersion,
      kind,
      approvalId: approval._id,
      actionId,
      idempotencyKey,
      provider: project.renderPlan.provider,
      model: project.renderPlan.model,
      creditSource: project.renderPlan.creditSource,
      status: "queued",
      dispatchToken,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(actionId, { renderJobId: jobId, updatedAt: now });
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

    const isRetryForSameWorker = job.status === "running";
    if (isRetryForSameWorker) {
      if (job.workerRunId !== triggerRunId) throw new Error("render job is already claimed by another Trigger run");
    } else if (job.status !== "queued" || job.dispatchToken !== dispatchToken) {
      throw new Error("render job dispatch capability is invalid or has expired");
    }

    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("project not found");
    const order = project.orderId ? await ctx.db.get(project.orderId) : null;
    if (
      !project.renderPlan ||
      project.renderPlan.provider !== "render-engine" ||
      project.renderPlan.model !== "seedance-2.5-i2v" ||
      project.renderPlan.creditSource !== "engine_hosted_budget" ||
      project.renderPlan.aspectRatio !== "9:16" ||
      !/^[a-f0-9]{64}$/.test(project.renderPlan.referenceFrameSha256 ?? "") ||
      project.renderPlan.fallbackPolicy !== "fail_closed" ||
      project.storyboardVersion !== job.planVersion ||
      project.approvedPlanVersion !== job.planVersion ||
      !project.narrative ||
      !(project.approvedShots?.length) ||
      project.stage !== expectedRenderStage(job.kind)
    ) {
      throw new Error("render job no longer matches an approved Render Engine Seedance I2V plan");
    }
    assertClientReferenceKey(order?.productImageKey);
    for (const item of project.approvedShots) {
      if (item.kind === "card") continue;
      if (item.imageKey !== order.productImageKey) {
        throw new Error("approved storyboard references an unexpected client image");
      }
    }

    // Pre-control-plane jobs remain readable during cutover, but every newly
    // admitted job has both links and must still agree with its frozen plan and
    // queued ledger action before a worker can reach the renderer.
    if (job.actionId || job.approvalId) {
      if (!job.actionId || !job.approvalId) throw new Error("render job control-plane linkage is incomplete");
      const [approval, action] = await Promise.all([ctx.db.get(job.approvalId), ctx.db.get(job.actionId)]);
      const organizationId = project.organizationId ?? order?.organizationId;
      if (!organizationId || !approval || !action) throw new Error("render job control-plane records are missing");
      const approvalSnapshot = makePlanSnapshot(
        project._id,
        job.planVersion,
        project.narrative,
        project.approvedShots,
        project.renderPlan,
      );
      const actionPayload = {
        resourceType: PLAN_APPROVAL_RESOURCE_TYPE,
        resourceId: String(project._id),
        planVersion: job.planVersion,
        renderKind: job.kind,
        provider: job.provider,
        model: job.model,
        creditSource: job.creditSource,
      };
      if (
        approval.organizationId !== organizationId ||
        approval.status !== "approved" ||
        approval.actionKind !== PLAN_APPROVAL_ACTION_KIND ||
        approval.resourceType !== PLAN_APPROVAL_RESOURCE_TYPE ||
        approval.resourceId !== String(project._id) ||
        approval.planVersion !== job.planVersion ||
        !hasMatchingSnapshot(approval.snapshot, approval.snapshotHash, approvalSnapshot) ||
        action.organizationId !== organizationId ||
        action.approvalId !== approval._id ||
        action.renderJobId !== job._id ||
        action.actionKind !== RENDER_ACTION_KIND ||
        action.idempotencyKey !== job.idempotencyKey ||
        !hasMatchingSnapshot(action.payloadSnapshot, action.payloadHash, actionPayload) ||
        (action.status !== "queued" && action.status !== "running") ||
        (action.status === "running" && action.triggerRunId !== triggerRunId)
      ) {
        throw new Error("render job no longer matches its approved control-plane action");
      }
      if (action.status === "queued") {
        await ctx.db.patch(action._id, { status: "running", triggerRunId, updatedAt: Date.now() });
      }
    }

    // Validate every plan and control-plane link before consuming the one-time
    // capability. A bad record can therefore be retried or cancelled instead
    // of being stranded in running state without a worker execution context.
    if (!isRetryForSameWorker) {
      await ctx.db.patch(jobId, {
        status: "running",
        workerRunId: triggerRunId,
        triggerRunId,
        dispatchToken: undefined,
        updatedAt: Date.now(),
      });
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
    if (job.provider !== "higgsfield" || job.model !== "seedance_2_0") {
      throw new Error("legacy settlement cannot complete a Render Engine job");
    }
    const [project, post] = await Promise.all([ctx.db.get(job.projectId), ctx.db.get(postId)]);
    if (!project) throw new Error("project not found");
    if (!post || post.renderJobId !== jobId) throw new Error("render result does not belong to this job");
    const action = job.actionId ? await ctx.db.get(job.actionId) : null;
    if (
      job.actionId &&
      (!action || action.renderJobId !== jobId || action.status !== "running" || action.triggerRunId !== triggerRunId)
    ) {
      throw new Error("render action ledger is not owned by this active worker");
    }
    const now = Date.now();
    await ctx.db.patch(postId, { slides, status: "ready", qcScore, error: undefined });
    await ctx.db.patch(jobId, { status: "succeeded", creditsUsed, error: undefined, updatedAt: now });
    if (action) {
      await ctx.db.patch(action._id, {
        status: "succeeded",
        triggerRunId,
        providerReceipt: {
          provider: job.provider,
          model: job.model,
          creditSource: job.creditSource,
          creditsUsed,
          renderJobId: String(jobId),
          postId: String(postId),
        },
        updatedAt: now,
      });
    }
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

const hostedScene = v.object({ index: v.number(), idempotencyKey: v.string(), engineJobId: v.string(),
  providerRequestId: v.string(), estimatedCostUsd: v.number(), admittedCostUsd: v.number(),
  outputKey: v.string(), outputSha256: v.string(), outputBytes: v.number() });

function validHostedScene(scene: { index: number; idempotencyKey: string; engineJobId: string;
  providerRequestId: string; estimatedCostUsd: number; admittedCostUsd: number;
  outputKey: string; outputSha256: string; outputBytes: number }, jobId: string): boolean {
  return Number.isSafeInteger(scene.index) && scene.index >= 0 && scene.index < 6 &&
    scene.idempotencyKey === `${jobId}:scene:${scene.index + 1}` &&
    /^hosted-[a-f0-9]{32}$/.test(scene.engineJobId) &&
    /^[A-Za-z0-9_-]{1,200}$/.test(scene.providerRequestId) &&
    scene.outputKey.startsWith(`projects/media-engine/jobs/${scene.engineJobId}/`) &&
    scene.outputKey.endsWith("/generation.mp4") && /^[a-f0-9]{64}$/.test(scene.outputSha256) &&
    Number.isSafeInteger(scene.outputBytes) && scene.outputBytes > 0 &&
    Number.isFinite(scene.estimatedCostUsd) && scene.estimatedCostUsd > 0 &&
    Number.isFinite(scene.admittedCostUsd) && scene.admittedCostUsd > 0;
}

/** Persist partial paid admissions even when a later shot or QC fails. */
export const recordHostedScene = internalMutation({
  args: { jobId: v.id("renderJobs"), triggerRunId: v.string(), scene: hostedScene },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.workerRunId !== args.triggerRunId ||
        job.provider !== "render-engine" || job.model !== "seedance-2.5-i2v" ||
        !validHostedScene(args.scene, String(args.jobId))) throw new Error("Hosted scene claim differs");
    const existing = job.hostedSceneReceipts ?? [];
    if (args.scene.index < existing.length) {
      if (JSON.stringify(existing[args.scene.index]) !== JSON.stringify(args.scene))
        throw new Error("Hosted scene receipt changed after admission");
      return existing.length;
    }
    if (args.scene.index !== existing.length) throw new Error("Hosted scenes must settle in approved order");
    const next = [...existing, args.scene];
    await ctx.db.patch(job._id, { hostedSceneReceipts: next,
      hostedEstimatedCostUsd: next.reduce((sum, scene) => sum + scene.estimatedCostUsd, 0),
      hostedAdmittedCostUsd: next.reduce((sum, scene) => sum + scene.admittedCostUsd, 0),
      updatedAt: Date.now() });
    return next.length;
  },
});

/** Settle the owned ad only from completed Engine objects and its budget ledger. */
export const completeRenderHosted = internalMutation({
  args: {
    jobId: v.id("renderJobs"), triggerRunId: v.string(), postId: v.id("posts"),
    scenes: v.array(hostedScene),
    finalOutput: v.object({ key: v.string(), sha256: v.string(), bytes: v.number() }),
    slides: v.array(v.object({ r2Key: v.optional(v.string()), url: v.optional(v.string()), prompt: v.string(), role: v.optional(v.string()) })),
    qcScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.workerRunId !== args.triggerRunId || job.postId !== args.postId ||
        job.provider !== "render-engine" || job.model !== "seedance-2.5-i2v" || job.creditSource !== "engine_hosted_budget")
      throw new Error("Only the claimed Render Engine worker can settle this ad");
    const [project, post] = await Promise.all([ctx.db.get(job.projectId), ctx.db.get(args.postId)]);
    if (!project || !post || post.renderJobId !== job._id || project.renderPlan?.provider !== "render-engine" ||
        project.renderPlan.model !== "seedance-2.5-i2v" || project.renderPlan.creditSource !== "engine_hosted_budget" ||
        !/^[a-f0-9]{64}$/.test(project.renderPlan.referenceFrameSha256 ?? "") ||
        project.approvedPlanVersion !== job.planVersion || project.storyboardVersion !== job.planVersion)
      throw new Error("Rendered ad no longer matches the approved project plan");
    const action = job.actionId ? await ctx.db.get(job.actionId) : null;
    if (!action || action.renderJobId !== job._id || action.status !== "running" || action.triggerRunId !== args.triggerRunId)
      throw new Error("Render Engine action ledger is not owned by this worker");
    const i2vCount = project.approvedShots?.filter(shot => shot.kind !== "card").length ?? 0;
    if (i2vCount < 1 || args.scenes.length !== i2vCount || args.scenes.length > 6 ||
        JSON.stringify(job.hostedSceneReceipts ?? []) !== JSON.stringify(args.scenes) ||
        args.finalOutput.key !== `creative/${args.postId}/ad.mp4` ||
        !/^[a-f0-9]{64}$/.test(args.finalOutput.sha256) ||
        !Number.isSafeInteger(args.finalOutput.bytes) || args.finalOutput.bytes < 1 ||
        args.slides.length !== 1 || args.slides[0].r2Key !== args.finalOutput.key ||
        (args.qcScore !== undefined && (!Number.isFinite(args.qcScore) || args.qcScore < 0 || args.qcScore > 100)))
      throw new Error("Render Engine final artifact or shot count differs");
    for (const [ordinal, scene] of args.scenes.entries()) {
      if (scene.index !== ordinal || !validHostedScene(scene, String(args.jobId)))
        throw new Error("Render Engine scene receipt or cost admission differs");
    }
    const estimatedCostUsd = args.scenes.reduce((sum, scene) => sum + scene.estimatedCostUsd, 0);
    const admittedCostUsd = args.scenes.reduce((sum, scene) => sum + scene.admittedCostUsd, 0);
    const now = Date.now();
    await ctx.db.patch(post._id, { slides: args.slides, status: "ready", qcScore: args.qcScore, error: undefined });
    await ctx.db.patch(job._id, { status: "succeeded", hostedSceneReceipts: args.scenes,
      hostedEstimatedCostUsd: estimatedCostUsd, hostedAdmittedCostUsd: admittedCostUsd,
      finalOutputSha256: args.finalOutput.sha256, finalOutputBytes: args.finalOutput.bytes,
      error: undefined, updatedAt: now });
    await ctx.db.patch(action._id, { status: "succeeded", triggerRunId: args.triggerRunId,
      providerReceipt: { provider: "render-engine", model: "seedance-2.5-i2v", creditSource: "engine_hosted_budget",
        estimatedCostUsd, admittedCostUsd, actualCostUsd: null, scenes: args.scenes,
        finalOutput: args.finalOutput, renderJobId: String(job._id), postId: String(post._id) }, updatedAt: now });
    if (job.kind === "draft") await ctx.db.patch(project._id, { draftPostId: post._id, stage: "draft_ready", lastActivityAt: now });
    else {
      await ctx.db.patch(project._id, { finalPostId: post._id, stage: "final_ready", lastActivityAt: now });
      if (project.orderId) await ctx.db.patch(project.orderId, { deliveryPostId: post._id, status: "ready_for_delivery" });
    }
    await ctx.db.insert("projectMessages", { projectId: project._id, role: "system",
      body: `${job.kind === "draft" ? "Draft" : "Final"} render completed through project-owned Seedance 2.5 I2V. ${admittedCostUsd.toFixed(2)} USD admitted against the Engine hosted budget; actual provider charge awaits reconciliation.`,
      status: "sent", createdAt: now });
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
    if (job.actionId) {
      const action = await ctx.db.get(job.actionId);
      if (action && action.renderJobId === jobId) {
        await ctx.db.patch(action._id, { status: "failed", triggerRunId, error: message, updatedAt: now });
      }
    }
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
    if (job.actionId) {
      const action = await ctx.db.get(job.actionId);
      if (action && action.renderJobId === jobId) {
        await ctx.db.patch(action._id, { status: "failed", error: message, updatedAt: now });
      }
    }
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
