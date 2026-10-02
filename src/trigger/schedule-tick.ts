import { task, logger } from "@trigger.dev/sdk";

// The former autopilot task keeps its ID so explicitly queued calls can drain
// safely. It performs no generation, approval, or
// publishing. Social planning and review data remain intact while client media
// renders are restricted to the private Work flow.
export const scheduleTick = task({
  id: "schedule-tick",
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
