import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { planPersonaWeek } from "../lib/orchestrator/persona-plan";

// Plans a run of Instagram carousels for one persona (base model shot + niche
// slides + optional CTA), scheduled as `planned` posts. Runs on the subscription
// brain (Claude Sonnet) via the shared persona-plan pipeline.
export const planWeek = task({
  id: "plan-week",
  maxDuration: 600,
  run: async (payload: { personaId: string; days?: number; postsPerDay?: number }) => {
    try {
      const res = await planPersonaWeek(payload);
      logger.log("week planned", { persona: res.handle, posts: res.created });
      return { personaId: res.personaId, created: res.created };
    } catch (e) {
      throw new AbortTaskRunError(e instanceof Error ? e.message : String(e));
    }
  },
});
