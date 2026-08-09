import { schedules, logger } from "@trigger.dev/sdk";

// The former autopilot heartbeat remains scheduled so deployments with this task
// ID do not start an old renderer. It performs no generation, approval, or
// publishing. Social planning and review data remain intact while client media
// renders are restricted to the private Work flow.
export const scheduleTick = schedules.task({
  id: "schedule-tick",
  cron: "*/30 * * * *",
  maxDuration: 60,
  run: async () => {
    const result = {
      generationDisabled: true,
      publishingDisabled: true,
      legacyQueueInspectionDisabled: true,
    };
    logger.warn("social scheduler paused by generation policy", result);
    return result;
  },
});
