import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * The only public Convex boundary for Creator Promotion. Browser clients must
 * use a server-side operator route; that route holds this token and calls these
 * actions. These actions only persist plans, review state, and metadata—none
 * can contact Instagram, Fanvue, a renderer, or an inbox provider.
 */
function requireServiceToken(received: string): void {
  const expected = process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
  if (!expected || received.length < 32 || received !== expected) {
    throw new Error("unauthorised media-engine service call");
  }
}

const serviceArgs = { serviceToken: v.string() };
const servicePayloadArgs = { ...serviceArgs, payload: v.any() };

export const listWorkspace = action({
  args: serviceArgs,
  handler: async (ctx, { serviceToken }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.creatorPromotions.listWorkspace, {});
  },
});

/** Safe, receipt-only projection of governed Fanvue tracking-link actions. */
export const listFanvueTrackingLinks = action({
  args: serviceArgs,
  handler: async (ctx, { serviceToken }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.creatorFanvueTracking.listFanvueTrackingLinks, {});
  },
});

export const importLegacyPersonas = action({
  args: serviceArgs,
  handler: async (ctx, { serviceToken }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.importLegacyPersonas, {});
  },
});

export const createProfile = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createProfile, payload);
  },
});

export const updateProfile = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.updateProfile, payload);
  },
});

/** Appends and activates an immutable Creator Persona Bible revision. */
export const createPersonaRevision = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createPersonaRevision, payload);
  },
});

/** Explicit rollback/activation of an existing immutable persona revision. */
export const activatePersonaRevision = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.activatePersonaRevision, payload);
  },
});

export const createSocialAccount = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createSocialAccount, payload);
  },
});

/** Records a Fanvue OAuth/KYC intent only; the trusted server owns real OAuth. */
export const registerFanvueConnectionIntent = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.registerFanvueConnectionIntent, payload);
  },
});

/** Meta OAuth intent only; credentials and callback handling stay server-only. */
export const registerMetaInstagramConnectionIntent = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.registerMetaInstagramConnectionIntent, payload);
  },
});

/** Metadata-only operator link for one existing Postiz channel integration. */
export const linkPostizIntegration = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.linkPostizIntegration, payload);
  },
});

export const createDestination = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createDestination, payload);
  },
});

/** Draft-only governed funnel metadata; never creates a public link or campaign. */
export const createFunnelCampaign = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createFunnelCampaign, payload);
  },
});

/** Revises a paused/draft funnel into a new unreviewed version. */
export const updateFunnelCampaign = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.updateFunnelCampaign, payload);
  },
});

/** Freezes a campaign version for human review; this makes no external call. */
export const submitFunnelForReview = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.submitFunnelForReview, payload);
  },
});

/** Human approval only; a separate explicit action is still required to activate. */
export const approveFunnelCampaign = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveFunnelCampaign, payload);
  },
});

/** Activates only a human-approved funnel; it does not dispatch a provider action. */
export const activateFunnelCampaign = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.activateFunnelCampaign, payload);
  },
});

/** Pausing blocks future funnel-bound review/dispatch while retaining history. */
export const pauseFunnelCampaign = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.pauseFunnelCampaign, payload);
  },
});

/** Metadata only: image bytes and object-store access stay outside Convex. */
export const createReferenceAsset = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createReferenceAsset, payload);
  },
});

export const createContentPlan = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createContentPlan, payload);
  },
});

export const rescheduleContent = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.rescheduleContent, payload);
  },
});

export const submitContentForReview = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.submitContentForReview, payload);
  },
});

export const approveContentPlan = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveContentPlan, payload);
  },
});

export const rejectContentPlan = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.rejectContentPlan, payload);
  },
});

/** A selected render needs a separate individual Meta publication approval. */
export const requestMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.requestMetaInstagramPublish, payload);
  },
});

/** Human decision only; it cannot publish or enqueue a Trigger worker. */
export const approveMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveMetaInstagramPublish, payload);
  },
});

/** Explicit queue only; a scheduled time never automatically invokes this action. */
export const queueMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.queueMetaInstagramPublish, payload);
  },
});

/** Trusted worker claim only. */
export const claimMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.claimMetaInstagramPublish, payload);
  },
});

/** Worker receipt only; the container id is sanitized metadata. */
export const recordMetaInstagramPublishContainer = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.recordMetaInstagramPublishContainer, payload);
  },
});

export const completeMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.completeMetaInstagramPublish, payload);
  },
});

export const failMetaInstagramPublish = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.failMetaInstagramPublish, payload);
  },
});

/** Creates one separately approved future schedule for the Postiz worker. */
export const requestPostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.requestPostizSchedule, payload);
  },
});

/** Human approval only; it cannot call or queue Postiz. */
export const approvePostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approvePostizSchedule, payload);
  },
});

/** Explicit worker queue only; the frozen future time goes to Postiz. */
export const queuePostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.queuePostizSchedule, payload);
  },
});

/** Trusted worker claim only. */
export const claimPostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.claimPostizSchedule, payload);
  },
});

/** Records Postiz scheduler acceptance only, never social publication. */
export const completePostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.completePostizSchedule, payload);
  },
});

/** Terminal Postiz worker failure; no automatic retry is available here. */
export const failPostizSchedule = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.failPostizSchedule, payload);
  },
});

/** Requests one exact Fanvue tracking link; no provider call happens here. */
export const requestFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.requestFanvueTrackingLink, payload);
  },
});

/** Individual approval only; it cannot create a link or call Fanvue. */
export const approveFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.approveFanvueTrackingLink, payload);
  },
});

/** Explicit worker queue only; a campaign never creates links by itself. */
export const queueFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.queueFanvueTrackingLink, payload);
  },
});

/** Trusted worker claim. A repeated claim remains reconciliation-only. */
export const claimFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.claimFanvueTrackingLink, payload);
  },
});

/** Stores the bounded Fanvue receipt after a successful single provider call. */
export const completeFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.completeFanvueTrackingLink, payload);
  },
});

/** Terminal failure boundary; automatic retry would risk a duplicate provider link. */
export const failFanvueTrackingLink = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorFanvueTracking.failFanvueTrackingLink, payload);
  },
});

/** Creates a separate review request for one signed-inbound, frozen-draft reply. */
export const requestMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.requestMetaInstagramReply, payload);
  },
});

/** Individual human approval only; it cannot send, schedule, or queue a reply. */
export const approveMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveMetaInstagramReply, payload);
  },
});

/** Explicit operator queue only; no inbox scheduler may call this boundary. */
export const queueMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.queueMetaInstagramReply, payload);
  },
});

/** Trusted Trigger claim only. */
export const claimMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.claimMetaInstagramReply, payload);
  },
});

/** Worker-only final signed-inbound/window confirmation immediately before send. */
export const confirmMetaInstagramReplySend = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.confirmMetaInstagramReplySend, payload);
  },
});

/** Worker receipt only; no provider response body crosses this boundary. */
export const completeMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.completeMetaInstagramReply, payload);
  },
});

/** Terminal worker failure only; it routes the thread to manual reconciliation. */
export const failMetaInstagramReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.failMetaInstagramReply, payload);
  },
});

/** Human candidate review only; this action cannot invoke a renderer or publisher. */
export const selectRenderCandidate = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.selectRenderCandidate, payload);
  },
});

/** Human candidate review only; a rejection never starts a new render. */
export const rejectRenderCandidate = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.rejectRenderCandidate, payload);
  },
});

/** Explicit retry creates a new audited attempt, but does not dispatch it. */
export const retryCreatorRenderJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.retryCreatorRenderJob, payload);
  },
});

/** Trusted worker boundary only; no browser route may claim a render job. */
export const claimCreatorRenderJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.claimCreatorRenderJob, payload);
  },
});

/** Trusted worker boundary only; outputs must already be in controlled storage. */
export const recordCreatorRenderCandidate = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.recordCreatorRenderCandidate, payload);
  },
});

/** Trusted worker boundary only; this records a failure and never retries it. */
export const failCreatorRenderJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.failCreatorRenderJob, payload);
  },
});

/** Creates a frozen, consent-gated Z-Image Turbo LoRA training draft only. */
export const createLoRATrainingDraft = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createLoRATrainingDraft, payload);
  },
});

/** Submits the immutable dataset manifest for human review; it never calls Fal. */
export const submitLoRATrainingForReview = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.submitLoRATrainingForReview, payload);
  },
});

/** Human approval admits a later explicit queue action, not provider dispatch. */
export const approveLoRATraining = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveLoRATraining, payload);
  },
});

export const rejectLoRATraining = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.rejectLoRATraining, payload);
  },
});

/** Explicitly creates the audited queued action; it still does not contact Fal. */
export const queueLoRATraining = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.queueLoRATraining, payload);
  },
});

/** Trusted worker boundary only; returns the frozen dataset and parameters. */
export const claimLoRATrainingJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.claimLoRATrainingJob, payload);
  },
});

/** Persists a Fal request id before polling so worker retries cannot resubmit training. */
export const recordLoRATrainingProviderSubmission = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.recordLoRATrainingProviderSubmission, payload);
  },
});

/** Worker completion accepts only sanitized metadata and controlled model artifacts. */
export const completeLoRATrainingJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.completeLoRATrainingJob, payload);
  },
});

export const failLoRATrainingJob = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.failLoRATrainingJob, payload);
  },
});

/** Explicit operator activation; completing a model never activates it. */
export const activateLoRAModel = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.activateLoRAModel, payload);
  },
});

/** Operator-recorded, provider-derived metrics only; this never fetches or fabricates analytics. */
export const createManualAttributionSnapshot = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createManualAttributionSnapshot, payload);
  },
});

/** Manual aggregate attribution only; no pixel, redirect, or provider event ingestion. */
export const recordManualFunnelEvent = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.recordManualFunnelEvent, payload);
  },
});

export const createInboxThread = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.createInboxThread, payload);
  },
});

/**
 * Signed Meta webhook ingress only. This records one verified customer
 * message and its idempotent receipt; it cannot draft, queue, or send a reply.
 */
export const ingestVerifiedMetaInstagramInbound = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.ingestVerifiedMetaInstagramInbound, payload);
  },
});

export const draftInboxReply = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.draftInboxReply, payload);
  },
});

/**
 * Private model context for a draft-only reply. This is intentionally an
 * operator-server boundary, not a browser query: it may read retention-bound
 * inbox text but never returns it through the workspace projection.
 */
export const getInboxDraftContext = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.creatorPromotions.getInboxDraftContext, payload);
  },
});

export const reviseInboxDraft = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.reviseInboxDraft, payload);
  },
});

export const approveInboxDraft = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.approveInboxDraft, payload);
  },
});

export const handoffInboxThread = action({
  args: servicePayloadArgs,
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creatorPromotions.handoffInboxThread, payload);
  },
});
