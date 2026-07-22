import { schedules, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { tickCampaigns } from "../lib/orchestrator/tick";
import { aiEnabled } from "../lib/ai-gate";

// Campaign heartbeat — advances due steps of LIVE campaigns within budget, all
// gated (dry-run unless liveMode + keys). Runs every 15 minutes, offset from the
// content scheduler's 30-min tick. Bounded work per run.
export async function runCampaignTick(
  isAiEnabled: () => Promise<boolean> = aiEnabled,
  tick: typeof tickCampaigns = tickCampaigns,
) {
  if (!(await isAiEnabled())) throw new AbortTaskRunError("AI generation is paused");
  const res = await tick(20);
  logger.log("campaign-tick", { processed: res.processed });
  for (const line of res.log) logger.log(line);
  return res;
}

export const campaignTick = schedules.task({
  id: "campaign-tick",
  cron: "7,22,37,52 * * * *",
  maxDuration: 300,
  run: () => runCampaignTick(),
});
