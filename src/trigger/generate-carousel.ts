import { task, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { IMAGE_WORKFLOW_PAUSED_REASON } from "../lib/image-workflow";

// Keep the established Trigger task ID so existing callers fail visibly rather
// than becoming an unknown task. No vault lookup, provider request, storage
// write, status mutation, or spend row can occur on this path.
export const generateCarousel = task({
  id: "generate-carousel",
  maxDuration: 60,
  run: async () => {
    throw new AbortTaskRunError(IMAGE_WORKFLOW_PAUSED_REASON);
  },
});
