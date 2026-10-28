import { task } from "@trigger.dev/sdk";
import { inspectCodexSubscription } from "../lib/llm";
import { marketingCall } from "../lib/marketing/service";

// Read-only diagnostic. It never submits a model prompt or changes the AI gate.
export const marketingAiCheck = task({
  id: "marketing-ai-check",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async ({ projectId, requestKey }: { projectId: string; requestKey: string }) => {
    if (!await marketingCall<boolean>("claimAiCheck", { projectId, requestKey })) return { claimed: false };
    const outcome = await inspectCodexSubscription();
    await marketingCall("finishAiCheck", { projectId, requestKey, outcome });
    return { claimed: true };
  },
});
