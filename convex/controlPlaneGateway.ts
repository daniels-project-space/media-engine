import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Narrow service-to-service gateway for the private control plane. Browser
 * clients never call these actions directly; the shared token lives only in a
 * trusted server or Trigger secret store.
 */
function requireServiceToken(received: string): void {
  const expected = process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
  if (!expected || received.length < 32 || received !== expected) {
    throw new Error("unauthorised media-engine service call");
  }
}

const serviceArgs = { serviceToken: v.string() };

export const bootstrapDefaultOrganization = action({
  args: serviceArgs,
  handler: async (ctx, { serviceToken }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.controlPlane.bootstrapDefaultOrganization, {});
  },
});

export const listDashboard = action({
  args: { ...serviceArgs, payload: v.optional(v.any()) },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.controlPlane.listDashboard, payload ?? {});
  },
});

/** The ingress route uses this normalized, idempotent outbox boundary. */
export const ingestFormSevenEvent = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runMutation(internal.controlPlane.ingestFormSevenEvent, payload);
  },
});

export const inspectFormSevenIntake = action({
  args: { ...serviceArgs, payload: v.any() },
  handler: async (ctx, { serviceToken, payload }): Promise<unknown> => {
    requireServiceToken(serviceToken);
    return await ctx.runQuery(internal.controlPlane.inspectFormSevenIntake, payload);
  },
});
