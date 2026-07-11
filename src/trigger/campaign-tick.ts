import { schedules, logger } from "@trigger.dev/sdk/v3";
import { tickCampaigns } from "../lib/orchestrator/tick";

// Campaign heartbeat — advances due steps of LIVE campaigns within budget, all
// gated (dry-run unless liveMode + keys). Runs every 15 minutes, offset from the
// content scheduler's 30-min tick. Bounded work per run.
export const campaignTick = schedules.task({
  id: "campaign-tick",
  cron: "7,22,37,52 * * * *",
  maxDuration: 300,
  run: async () => {
    const res = await tickCampaigns(20);
    logger.log("campaign-tick", { processed: res.processed });
    for (const line of res.log) logger.log(line);
    return res;
  },
});
