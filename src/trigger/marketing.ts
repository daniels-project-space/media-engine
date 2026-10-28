import { schedules, task, logger } from "@trigger.dev/sdk";
import type { Id } from "../../convex/_generated/dataModel";
import { runMarketingItem } from "../lib/marketing/runner";
import {
  marketingCall,
  refreshProviderAccounts,
  publicFailure,
} from "../lib/marketing/service";
import { ZernioError } from "../lib/marketing/zernio";
import { copyMarketingVideo } from "../lib/marketing/assets";
import type { Doc } from "../../convex/_generated/dataModel";

export const marketingImportRender = task({
  id: "marketing-import-render",
  maxDuration: 300,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  queue: { name: "marketing-media-imports", concurrencyLimit: 2 },
  run: async (
    payload: {
      projectId: Id<"marketingProjects">;
      importId: Id<"marketingRenderImports">;
      attempt: number;
    },
    { ctx },
  ) => {
    const identity = { ...payload, workerRunId: ctx.run.id };
    try {
      const item = await marketingCall<Doc<"marketingRenderImports">>(
        "claimRenderImport",
        identity,
      );
      if (item.status === "verified")
        return { status: "verified", assetId: item.assetId };
      await copyMarketingVideo({
        projectId: payload.projectId,
        sourceKey: item.sourceKey,
        destinationKey: item.destinationKey,
        sha256: item.sha256,
        bytes: item.bytes,
      });
      return await marketingCall("settleRenderImport", {
        ...identity,
        verified: true,
      });
    } catch (error) {
      await marketingCall("settleRenderImport", {
        ...identity,
        verified: false,
        error: publicFailure(error),
      });
      throw new Error("Approved video import failed; see the project receipt");
    }
  },
});

export const marketingItem = task({
  id: "marketing-item",
  maxDuration: 180,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  queue: { name: "marketing-items", concurrencyLimit: 3 },
  run: async (
    payload: {
      projectId: Id<"marketingProjects">;
      itemId: Id<"marketingItems">;
    },
    { ctx },
  ) => runMarketingItem(payload, ctx.run.id),
});

export const marketingTick = schedules.task({
  id: "marketing-tick",
  maxDuration: 120,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  queue: { name: "marketing-control", concurrencyLimit: 1 },
  // No recurring no-op is installed while automation is unconfigured. Enable
  // this exact authoritative schedule only with the production worker rollout.
  ...(process.env.MARKETING_AUTOMATION_ENABLED === "true"
    ? {
        cron: { pattern: "*/5 * * * *", environments: ["PRODUCTION" as const] },
      }
    : {}),
  run: async () => {
    if (process.env.MARKETING_AUTOMATION_ENABLED !== "true")
      return { status: "disabled" };
    if (process.env.MARKETING_ZERNIO_QUALIFIED === "true") {
      const inventory = await marketingCall<{ nextRefreshAt?: number } | null>(
        "providerInventory",
        {},
      );
      if (!inventory?.nextRefreshAt || inventory.nextRefreshAt <= Date.now()) {
        try {
          await refreshProviderAccounts();
        } catch (error) {
          await marketingCall("recordInventoryFailure", {
            error: publicFailure(error),
            retryAfterMs:
              error instanceof ZernioError &&
              (error.status === 429 ||
                error.status >= 500 ||
                error.status === 0)
                ? Math.max(3_600_000, error.retryAfterSeconds * 1_000)
                : 86_400_000,
          });
        }
      }
    }
    const projects = await marketingCall<
      Array<{ _id: Id<"marketingProjects"> }>
    >("dueProjects", {});
    for (const project of projects) {
      try {
        await marketingCall("generateWeek", { projectId: project._id });
      } catch (error) {
        await marketingCall("recordPlanningFailure", {
          projectId: project._id,
          error: publicFailure(error),
        });
        logger.warn("Marketing planning needs operator attention", {
          projectId: project._id,
          error: publicFailure(error),
        });
      }
    }
    const items = await marketingCall<
      Array<{
        projectId: Id<"marketingProjects">;
        itemId: Id<"marketingItems">;
        status: string;
      }>
    >("dueItems", {});
    for (const item of items)
      await marketingItem.trigger(
        { projectId: item.projectId, itemId: item.itemId },
        {
          idempotencyKey: `${item.itemId}:${item.status}:${Math.floor(Date.now() / 300_000)}`,
        },
      );
    return { projectsChecked: projects.length, itemsDispatched: items.length };
  },
});
