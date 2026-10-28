import { task } from "@trigger.dev/sdk";
import { hyperProjectConnection, getHyperImportReceipt } from "../lib/marketing/hyper-project";
import { copyHyperMarketingAsset } from "../lib/marketing/assets";
import { marketingCall } from "../lib/marketing/service";

export const marketingHyperImport = task({
  id: "marketing-hyper-import", maxDuration: 300, machine: "small-1x", retry: { maxAttempts: 1 },
  queue: { name: "marketing-media-imports", concurrencyLimit: 2 },
  run: async (payload: { projectId: string; importId: string; attempt: number }, { ctx }) => {
    const identity = { ...payload, workerRunId: ctx.run.id };
    const item = await marketingCall<{ jobId: string }>("claimHyperImport", identity);
    try {
      const connection = await hyperProjectConnection(payload.projectId);
      if (!connection) throw new Error("New rendering service connection is not configured");
      const before = await getHyperImportReceipt(connection, item.jobId);
      const copied = await copyHyperMarketingAsset({ projectId: payload.projectId, sourcePrefix: connection.prefix,
        sourceKey: before.key, sha256: before.sha256, bytes: before.bytes, contentType: before.contentType });
      const after = await getHyperImportReceipt(connection, item.jobId);
      if (before.key !== after.key || before.sha256 !== after.sha256 || before.bytes !== after.bytes ||
          before.generation !== after.generation || before.contentType !== after.contentType)
        throw new Error("The source render receipt changed during import");
      return await marketingCall("settleHyperImport", { ...identity, receipt: copied });
    } catch {
      await marketingCall("settleHyperImport", { ...identity, error: "New-service render import failed verification. Check the project connection and source receipt." });
      return { status: "failed" };
    }
  },
});
