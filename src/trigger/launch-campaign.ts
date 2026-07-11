import { task, logger } from "@trigger.dev/sdk/v3";
import { runLaunch } from "../lib/orchestrator/run";

// Master campaign task: understand → research → strategise → persist plan.
// Reasoning + Convex writes only; every outward effect stays gated (dry-run).
export const launchCampaign = task({
  id: "launch-campaign",
  maxDuration: 300,
  run: async (payload: { campaignId: string }) => {
    logger.log("launch-campaign", { campaignId: payload.campaignId });
    const res = await runLaunch(payload.campaignId);
    logger.log("launch-campaign done", { status: res.status });
    return { status: res.status };
  },
});
