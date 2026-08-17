import { task, logger } from "@trigger.dev/sdk";

// The old campaign heartbeat could invoke social, email, and influencer
// integrations from legacy Convex state. It is a permanent no-op (Distribution
// is retired). The task id is deliberately kept deployed (registered with
// Trigger.dev) so any leftover references to it resolve safely, but the cron
// schedule has been removed (cost opt, 2026-08-17) so it no longer fires
// ~96 times/day for zero effect. Trigger manually if ever needed.
export const campaignTick = task({
  id: "campaign-tick",
  maxDuration: 300,
  run: async () => {
    const result = {
      automationDisabled: true,
      reason: "Legacy Distribution is retired pending authenticated migration",
    };
    logger.warn("campaign-tick skipped", result);
    return result;
  },
});
