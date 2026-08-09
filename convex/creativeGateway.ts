import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * The Next.js operator surface and Trigger jobs run outside Convex, so they
 * cannot invoke `internal.creative.*` directly. This is the deliberately small
 * service-to-service boundary: each public action accepts a secret that lives
 * only in the server/Trigger secret store, then delegates to the internal
 * function where the actual data invariants live.
 *
 * Set the same MEDIA_ENGINE_CONVEX_SERVICE_TOKEN value in the media-engine
 * Convex deployment and in the server/Trigger secret store. When it is absent
 * the gateway fails closed; it never quietly opens the render pipeline.
 */
function requireServiceToken(received: string): void {
  const expected = process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
  if (!expected || received.length < 32 || received !== expected) {
    throw new Error("unauthorised media-engine service call");
  }
}

const serviceArgs = { serviceToken: v.string() };

export const listWorkspace = action({
  args: serviceArgs,
  handler: async (ctx, { serviceToken }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.creative.listWorkspace, {});
  },
});

export const getProjectForPlanning = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.creative.getProjectForPlanning, payload);
  },
});

export const createRequest = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.createRequest, payload);
  },
});

export const appendMessage = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.appendMessage, payload);
  },
});

export const updateIntake = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.updateIntake, payload);
  },
});

export const setProductReference = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.setProductReference, payload);
  },
});

export const persistPlan = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.persistPlan, payload);
  },
});

export const approvePlan = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.approvePlan, payload);
  },
});

export const startRender = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.startRender, payload);
  },
});

export const claimRenderExecution = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.claimRenderExecution, payload);
  },
});

export const createRenderPost = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.createRenderPost, payload);
  },
});

export const completeRender = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.completeRender, payload);
  },
});

export const markDelivered = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.markDelivered, payload);
  },
});

export const failRender = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.failRender, payload);
  },
});

export const failQueuedDispatch = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.creative.failQueuedDispatch, payload);
  },
});
