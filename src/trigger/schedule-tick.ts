import { task, logger } from "@trigger.dev/sdk";

// The former autopilot heartbeat remains DEPLOYED under this task ID (but no
// longer scheduled) so nothing that references this ID could ever start an
// old renderer. It performs no generation, approval, or publishing. Social
// planning and review data remain intact while client media renders are
// restricted to the private Work flow. The cron schedule was removed
// (cost opt, 2026-08-17) — it no longer fires ~48 times/day for zero effect.
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
