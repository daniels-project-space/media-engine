import { task, logger } from "@trigger.dev/sdk";

// The old campaign heartbeat could invoke social, email, and influencer
// integrations from legacy Convex state. It is deliberately retained under its
// old task id so any explicitly queued invocation drains safely while Distribution is
// rebuilt behind an authenticated operator boundary.
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
