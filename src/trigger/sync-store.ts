import { task, logger } from "@trigger.dev/sdk/v3";
import { syncStore } from "../lib/orchestrator/store";

// Pull a Shopify store's catalogue into Convex with per-product channel plans,
// so campaigns targeting the store are product-aware.
export const syncStoreTask = task({
  id: "sync-store",
  maxDuration: 180,
  run: async (payload: { storeId: string }) => {
    const res = await syncStore(payload.storeId);
    logger.log("sync-store", res);
    return res;
  },
});
