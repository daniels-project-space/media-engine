import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk/v3";

/**
 * Retained only to fail closed for old Trigger runs.
 *
 * A social short is not an approved client render plan, so it must not consume
 * Higgsfield subscription credits. The canonical render entry point is the
 * private Work workflow, which validates an approved Seedance 2.0 plan first.
 */
export const generateShort = task({
  id: "generate-short",
  maxDuration: 60,
  run: async () => {
    const reason =
      "Social short rendering is retired by generation policy. This job cannot use Higgsfield credits; use an approved client render in Work instead.";
    logger.warn(reason);
    throw new AbortTaskRunError(reason);
  },
});
