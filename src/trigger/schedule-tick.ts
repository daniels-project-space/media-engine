import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// The former autopilot heartbeat remains scheduled so deployments with this task
// ID do not start an old renderer. It performs no generation, approval, or
// publishing. Social planning and review data remain intact while client media
// renders are restricted to the private Work flow.
export const scheduleTick = schedules.task({
  id: "schedule-tick",
  cron: "*/30 * * * *",
  maxDuration: 60,
  run: async () => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const now = Date.now();
    const [planned, approved] = await Promise.all([
      convex.query(api.posts.due, { status: "planned", before: now }),
      convex.query(api.posts.due, { status: "approved", before: now }),
    ]);

    const result = {
      generationDisabled: true,
      publishingDisabled: true,
      plannedAwaitingReview: planned.length,
      approvedAwaitingManualAction: approved.length,
    };
    logger.warn("social scheduler paused by generation policy", result);
    return result;
  },
});
