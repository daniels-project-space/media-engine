import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { checkChatGptCodexAuth } from "../lib/llm";

// This task is intentionally unscheduled and non-generating. It makes no
// model request: it accepts only a ChatGPT CLI profile and returns the exact
// installed CLI revision so a Trigger test run can retain that receipt.
export async function runCodexAuthCheck(
  check: () => Promise<{ revision: string }> = checkChatGptCodexAuth,
) {
  try {
    const { revision } = await check();
    logger.log("codex-auth-check", { login: "chatgpt", revision });
    return { login: "chatgpt" as const, revision };
  } catch (error) {
    throw new AbortTaskRunError(error instanceof Error ? error.message : "Codex CLI authentication unavailable");
  }
}

export const codexAuthCheck = task({
  id: "codex-auth-check",
  maxDuration: 60,
  run: runCodexAuthCheck,
});
