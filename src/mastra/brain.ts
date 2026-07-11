/* eslint-disable @typescript-eslint/no-explicit-any */
import { chatJson, chat, parseJson } from "../lib/llm";
import { getMastra } from "./index";

// Resilient brain: run reasoning through a Mastra agent (Claude Sonnet via the
// subscription) and fall back to the proven llm.ts on ANY failure — Mastra not
// loading, a bundling issue, or a model error. Mirrors youtube-studio-ai's
// agentJson pattern so the engine never hard-depends on the Mastra path.

export async function agentJson<T = Record<string, unknown>>(
  agentId: string,
  opts: { system?: string; user: string; maxTokens?: number },
): Promise<T> {
  try {
    const mastra = await getMastra();
    const agent = mastra?.getAgent?.(agentId);
    if (agent) {
      const prompt = opts.system ? `${opts.system}\n\n${opts.user}` : opts.user;
      const res: any = await agent.generate(prompt, { maxSteps: 1 });
      const text: string = res?.text ?? (typeof res === "string" ? res : "");
      if (text) return parseJson<T>(text);
    }
  } catch {
    /* fall through to the proven direct path */
  }
  return chatJson<T>({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens });
}

export async function agentText(agentId: string, opts: { system?: string; user: string; maxTokens?: number }): Promise<string> {
  try {
    const mastra = await getMastra();
    const agent = mastra?.getAgent?.(agentId);
    if (agent) {
      const prompt = opts.system ? `${opts.system}\n\n${opts.user}` : opts.user;
      const res: any = await agent.generate(prompt, { maxSteps: 1 });
      const text: string = res?.text ?? (typeof res === "string" ? res : "");
      if (text) return text;
    }
  } catch {
    /* fall through */
  }
  return chat({ system: opts.system, user: opts.user, maxTokens: opts.maxTokens });
}
