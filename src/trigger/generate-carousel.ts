import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

/**
 * Retained only so a queued legacy Trigger run has a deterministic, safe result.
 *
 * Social image rendering formerly used OpenAI. The media engine's generation
 * policy now permits billable rendering only from the approved Work flow, which
 * creates a Higgsfield Seedance 2.0 client-render plan. Do not reintroduce an
 * image provider or a fallback here.
 */
export const generateCarousel = task({
  id: "generate-carousel",
  maxDuration: 60,
  run: async () => {
    const reason =
      "Social carousel rendering is retired by generation policy. Existing social plans and posts remain available for review; create approved client video in Work using Higgsfield Seedance 2.0.";
    logger.warn(reason);
    throw new AbortTaskRunError(reason);
  },
});
