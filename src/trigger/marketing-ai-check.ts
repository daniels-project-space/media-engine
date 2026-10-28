import { task } from "@trigger.dev/sdk";
import { inspectCodexEnvironment, inspectCodexSubscription } from "../lib/llm";
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

// The project-scoped diagnostic above needs a saved project. This operational
// probe supports first-run setup before any projects exist. Only the private
// Trigger credential can invoke it; its output contains no credential data.
export const marketingAiEnvironmentCheck = task({
  id: "marketing-ai-environment-check",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async () => inspectCodexEnvironment(),
});
