/* eslint-disable @typescript-eslint/no-explicit-any */
import { zodToJsonSchema } from "zod-to-json-schema";
import { anthropicCreds, MODEL } from "../lib/llm";
import { supportedPlatforms } from "../lib/integrations/social";
import { TOOL_DEFS, TOOLS_BY_ID } from "./tools";
import { AGENT_DEFS } from "./agents";

// The engine's Mastra layer. `getMastra()` lazily builds the instance (agents on
// Claude Sonnet via the subscription, tools from the catalogue) and latches
// disabled on any failure so the rest of the engine keeps working via the
// llm.ts fallback (mirrors youtube-studio-ai's defensive pattern).
// `capabilityManifest()` is built from config alone, so the interface/Jarvis can
// always discover what the engine can do — even if Mastra fails to load.

let cached: any = null;
let disabled = false;

export async function getMastra(): Promise<any> {
  if (disabled) return null;
  if (cached) return cached;
  try {
    const [mastraMod, anthropicMod, toolsMod] = await Promise.all([
      import("@mastra/core"),
      import("@ai-sdk/anthropic"),
      import("@mastra/core/tools").catch(() => null as any),
    ]);
    const Mastra = (mastraMod as any).Mastra;
    const Agent = (mastraMod as any).Agent;
    const createAnthropic = (anthropicMod as any).createAnthropic;
    const createTool = (toolsMod as any)?.createTool ?? (mastraMod as any).createTool;

    const { base } = await anthropicCreds();
    // Resolve auth fresh per request so a rotating subscription token stays valid.
    const authedFetch = async (url: any, init: any = {}) => {
      const c = await anthropicCreds();
      const h = new Headers(init?.headers ?? {});
      h.delete("x-api-key");
      if (c.token) {
        h.set("authorization", `Bearer ${c.token}`);
        h.set("anthropic-beta", "oauth-2025-04-20");
      } else if (c.apiKey) {
        h.set("x-api-key", c.apiKey);
      }
      return fetch(url, { ...init, headers: h });
    };
    const provider = createAnthropic({ apiKey: "noop", baseURL: `${base}/v1`, fetch: authedFetch });
    const model = provider(MODEL);

    const buildTools = (ids: string[]) => {
      if (!createTool) return undefined;
      const o: Record<string, any> = {};
      for (const id of ids) {
        const d = TOOLS_BY_ID[id];
        if (!d) continue;
        o[id] = createTool({
          id: d.id,
          description: d.description,
          inputSchema: d.inputSchema,
          execute: async ({ context }: any) => d.execute(context ?? {}),
        });
      }
      return o;
    };

    const agents: Record<string, any> = {};
    for (const a of AGENT_DEFS) {
      agents[a.id] = new Agent({ name: a.name, instructions: a.instructions, model, tools: buildTools(a.toolIds) });
    }
    cached = new Mastra({ agents });
    return cached;
  } catch (e) {
    disabled = true;
    console.error("[mastra] disabled, using llm.ts fallback:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type CapabilityManifest = {
  engine: string;
  model: string;
  provider: string;
  agents: { id: string; name: string; role: string; tools: string[] }[];
  tools: { id: string; category: string; description: string; inputSchema: unknown }[];
  workflows: { id: string; description: string }[];
  capabilities: { area: string; items: string[] }[];
  channels: string[];
};

// Machine-readable "what can this engine do" — for the /capabilities UI and for
// Jarvis to introspect before launching work.
export async function capabilityManifest(): Promise<CapabilityManifest> {
  let channels: string[] = [];
  try {
    channels = await supportedPlatforms();
  } catch {
    channels = [];
  }
  return {
    engine: "media-engine",
    model: MODEL,
    provider: "anthropic (Claude subscription)",
    agents: AGENT_DEFS.map((a) => ({ id: a.id, name: a.name, role: a.role, tools: a.toolIds })),
    tools: TOOL_DEFS.map((t) => ({ id: t.id, category: t.category, description: t.description, inputSchema: zodToJsonSchema(t.inputSchema) })),
    workflows: [
      { id: "launch-campaign", description: "brief → understand → research → strategise → funnel + discount + step DAG" },
      { id: "sync-store", description: "pull a Shopify catalogue and compute per-product channel plans" },
      { id: "repurpose-asset", description: "reuse an asset via influencer handoff or cameo/reframe repurpose to a platform" },
      { id: "campaign-tick", description: "advance live campaign steps within budget (gated)" },
    ],
    capabilities: [
      { area: "Strategy", items: ["natural-language brief intake", "product-aware channel planning", "playbook-grounded tactics", "free/paid mode + budget governor"] },
      { area: "Commerce", items: ["Shopify catalogue sync", "product→channel mapping", "Stripe + Shopify discount codes"] },
      { area: "Content", items: ["content calendar", "funnels /f/[slug]", "captions/hooks per platform"] },
      { area: "Distribution", items: ["multi-platform posting (Ayrshare/Postiz/Graph)", "cold email (Smartlead)", "transactional email (Resend)", "community posts"] },
      { area: "Assets", items: ["asset-reuse graph (lineage)", "influencer handoff packs", "cameo/reframe repurposing to TikTok/Reels", "R2 asset registry"] },
      { area: "Growth", items: ["influencer discovery (Modash)", "cross-marketing (bundles/swaps/referrals)", "SEO + competitor intel", "real engagement analytics"] },
      { area: "Safety", items: ["FTC/AI disclosure gate", "dry-run master switch", "human approval by autonomy"] },
    ],
    channels,
  };
}
