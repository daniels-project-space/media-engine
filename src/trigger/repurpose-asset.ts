import { task, logger } from "@trigger.dev/sdk";
import { repurposeAsset, type RepurposeInput } from "../lib/integrations/repurpose";
import { legacyWorkflowDisabled } from "./legacy-disabled";

// Reuse/repurpose a marketing asset (influencer handoff or cameo/reframe → post).
// Records lineage; distribution is gated (dry-run unless liveMode).
export const repurposeAssetTask = task({
  id: "repurpose-asset",
  maxDuration: 180,
  run: async (payload: RepurposeInput) => {
    if (legacyWorkflowDisabled()) {
      const result = { ok: false, detail: "Legacy distribution is retired", assetId: payload.assetId };
      logger.warn("repurpose-asset skipped", result);
      return result;
    }
    const res = await repurposeAsset(payload);
    logger.log("repurpose-asset", { ok: res.ok, detail: res.detail });
    return res;
  },
});
