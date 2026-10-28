import { task } from "@trigger.dev/sdk";
import { generateMarketingPlan } from "../lib/marketing/ai-plan";
import { marketingCall } from "../lib/marketing/service";

export const marketingPlan = task({
  id: "marketing-ai-plan",
  maxDuration: 240,
  retry: { maxAttempts: 1 },
  run: async ({ runId }: { runId: string }) => {
    const brief = await marketingCall<Parameters<typeof generateMarketingPlan>[0] | null>("claimPlan", { runId });
    if (!brief) return { status: "not-claimed" };
    try {
      const result = await generateMarketingPlan(brief);
      return await marketingCall("finishPlan", { runId, ...result });
    } catch {
      // Do not persist raw model output, provider errors or credentials in UI.
      await marketingCall("finishPlan", { runId, error: "AI planning failed or the subscription worker is unavailable. No generated plan was saved." });
      return { status: "failed" };
    }
  },
});
