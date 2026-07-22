import { chatJson, chat } from "./llm";

// Agent names remain part of the product's capability vocabulary. Execution is
// intentionally one subscription-authenticated Codex CLI call, with no SDK or
// API-provider layer in between.
export async function agentJson<T = Record<string, unknown>>(
  _agentId: string,
  opts: { system?: string; user: string; maxTokens?: number },
): Promise<T> {
  return chatJson<T>({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens });
}

export async function agentText(
  _agentId: string,
  opts: { system?: string; user: string; maxTokens?: number },
): Promise<string> {
  return chat({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens });
}
