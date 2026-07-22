import { zodToJsonSchema } from "zod-to-json-schema";
import { MODEL } from "./llm";
import { supportedPlatforms } from "./integrations/social";
import { TOOL_DEFS } from "../mastra/tools";
import { AGENT_DEFS } from "../mastra/agents";

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

export async function capabilityManifest(): Promise<CapabilityManifest> {
  let channels: string[] = [];
  try { channels = await supportedPlatforms(); } catch { /* manifest remains available */ }
  return {
    engine: "media-engine",
    model: MODEL,
    provider: "Codex CLI (ChatGPT subscription)",
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
      { area: "Assets", items: ["approved-asset reuse graph (lineage)", "influencer handoff packs", "cameo/reframe repurposing to TikTok/Reels", "R2 asset registry"] },
      { area: "Growth", items: ["influencer discovery (Modash)", "cross-marketing (bundles/swaps/referrals)", "SEO + competitor intel", "real engagement analytics"] },
      { area: "Safety", items: ["image generation explicitly paused", "dry-run master switch", "human approval by autonomy"] },
    ],
    channels,
  };
}
