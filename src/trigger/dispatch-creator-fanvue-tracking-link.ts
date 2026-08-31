import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import { api } from "../../convex/_generated/api";
import { creativeServiceToken } from "../lib/creative-service";
import {
  FanvueApiVersionSchema,
  FanvueTrackingLinkClaimSchema,
  FanvueTrackingLinkProviderReceiptSchema,
  buildApprovedFanvueTrackingLinkRequest,
  checkFanvueApprovedDispatchHealth,
  createFanvueTrackingLink,
  resolveFanvueAccessToken,
} from "../lib/creator-promotion";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

type Payload = { actionId: string };

const SafeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

function safeActionId(value: unknown): string {
  return SafeIdentifierSchema.parse(value);
}

function assertLiveFanvueTrackingLinkGate(): void {
  if (process.env.CREATOR_FANVUE_TRACKING_LINKS_ENABLED !== "true") {
    throw new Error("CREATOR_FANVUE_TRACKING_LINKS_ENABLED is not true; Fanvue tracking-link creation remains fail-closed");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Fanvue tracking-link creation cannot run outside a production worker");
  }
  const health = checkFanvueApprovedDispatchHealth();
  if (!health.canDispatchApprovedActions) {
    throw new Error(`Fanvue approved dispatch is ${health.status}; repair the server-only OAuth and dispatcher configuration first`);
  }
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Fanvue tracking-link worker failed";
  return message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 2_000) || "Fanvue tracking-link worker failed";
}

/**
 * One exact, individually approved Fanvue tracking-link creation. There is no
 * retry: an interrupted HTTP request is provider-ambiguous and must be
 * reconciled by an operator instead of creating a duplicate link.
 */
export const dispatchCreatorFanvueTrackingLink = task({
  id: "dispatch-creator-fanvue-tracking-link",
  maxDuration: 180,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const actionId = safeActionId(payload.actionId);
    assertLiveFanvueTrackingLinkGate();
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let claim: z.infer<typeof FanvueTrackingLinkClaimSchema> | undefined;

    try {
      claim = FanvueTrackingLinkClaimSchema.parse(await convex.action(api.creatorPromotionsGateway.claimFanvueTrackingLink, {
        serviceToken,
        payload: { actionId, triggerRunId: ctx.run.id },
      }));
      if (claim.action.id !== actionId) {
        throw new Error("claimed Fanvue tracking-link action does not match its dispatch request");
      }
      if (claim.reused) {
        const receipt = FanvueTrackingLinkProviderReceiptSchema.safeParse(claim.providerReceipt);
        if (receipt.success) {
          logger.log("Fanvue tracking link was already completed", {
            actionId,
            trackingLinkId: receipt.data.trackingLinkId,
          });
          return { actionId, ...receipt.data, reused: true };
        }
        throw new Error("Fanvue tracking-link action was already claimed; manual reconciliation is required before any new provider call");
      }

      const apiVersion = FanvueApiVersionSchema.parse(process.env.FANVUE_API_VERSION);
      const accessToken = await resolveFanvueAccessToken(claim.snapshot.destination.connectionId);
      const request = buildApprovedFanvueTrackingLinkRequest({
        claim,
        accessToken,
        apiVersion,
        providerHealth: checkFanvueApprovedDispatchHealth(),
      });
      const receipt = await createFanvueTrackingLink({ request });
      await convex.action(api.creatorPromotionsGateway.completeFanvueTrackingLink, {
        serviceToken,
        payload: {
          actionId,
          triggerRunId: ctx.run.id,
          trackingLinkId: receipt.trackingLinkId,
          linkUrl: receipt.linkUrl,
        },
      });
      logger.log("Fanvue tracking link created", { actionId, trackingLinkId: receipt.trackingLinkId });
      return { actionId, ...receipt, reused: false };
    } catch (error) {
      const message = safeFailure(error);
      if (claim) {
        await convex.action(api.creatorPromotionsGateway.failFanvueTrackingLink, {
          serviceToken,
          payload: { actionId, triggerRunId: ctx.run.id, error: message },
        }).catch((recordError) => logger.error("could not record Fanvue tracking-link failure", {
          actionId,
          error: safeFailure(recordError),
        }));
      }
      throw new AbortTaskRunError(message);
    }
  },
});
