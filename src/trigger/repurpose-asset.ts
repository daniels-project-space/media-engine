import { task, logger } from "@trigger.dev/sdk/v3";
import { repurposeAsset, type RepurposeInput } from "../lib/integrations/repurpose";

// Reuse/repurpose a marketing asset (influencer handoff or cameo/reframe → post).
// Records lineage; distribution is gated (dry-run unless liveMode).
export const repurposeAssetTask = task({
  id: "repurpose-asset",
  maxDuration: 180,
  run: async (payload: RepurposeInput) => {
    const res = await repurposeAsset(payload);
    logger.log("repurpose-asset", { ok: res.ok, detail: res.detail });
    return res;
  },
});
