import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { keywords, serp } from "../lib/integrations/seo";
import { pullBrand } from "../lib/integrations/assets";
import { getProducts } from "../lib/integrations/shopify";
import { planStore } from "../lib/product-channels";
import { createDiscount } from "../lib/integrations/discounts";
import { publish, supportedPlatforms } from "../lib/integrations/social";
import { coldSequence } from "../lib/integrations/email";
import { discover } from "../lib/integrations/influence";
import { repurposeAsset } from "../lib/integrations/repurpose";

// The engine's TOOL CATALOGUE. Each tool is a thin wrapper over an adapter or
// Convex; Convex stays the source of truth. These definitions power the
// capability manifest so the interface/Jarvis can discover the engine.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const cx = () => new ConvexHttpClient(CONVEX_URL);

export type ToolDef = {
  id: string;
  description: string;
  category: "research" | "commerce" | "content" | "distribution" | "assets" | "growth";
  inputSchema: z.ZodTypeAny;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

export const TOOL_DEFS: ToolDef[] = [
  {
    id: "research_keywords",
    description: "SEO keyword ideas + search volumes for a seed term (DataForSEO).",
    category: "research",
    inputSchema: z.object({ seed: z.string().describe("seed keyword") }),
    execute: async (i) => keywords(String(i.seed)),
  },
  {
    id: "research_serp",
    description: "Live Google SERP + competitor landscape for a query (Serper).",
    category: "research",
    inputSchema: z.object({ query: z.string() }),
    execute: async (i) => serp(String(i.query)),
  },
  {
    id: "pull_brand",
    description: "Understand a product/app URL — pull its OG image, screenshot, logo, palette and copy (Microlink). No rendering.",
    category: "research",
    inputSchema: z.object({ url: z.string().url(), mirror: z.boolean().optional() }),
    execute: async (i) => pullBrand(String(i.url), { mirror: Boolean(i.mirror) }),
  },
  {
    id: "get_products",
    description: "Pull a connected Shopify store's real catalogue (products, price, tags, images).",
    category: "commerce",
    inputSchema: z.object({ domain: z.string().optional() }),
    execute: async (i) => getProducts(i.domain ? { domain: String(i.domain) } : undefined),
  },
  {
    id: "plan_product_channels",
    description: "Map products to the marketing channels + creative formats that fit them (product-aware planning).",
    category: "commerce",
    inputSchema: z.object({ products: z.array(z.any()) }),
    execute: async (i) => planStore((i.products as never[]) ?? []),
  },
  {
    id: "create_discount",
    description: "Mint a Stripe promotion code for a campaign (gated: dry-run unless live).",
    category: "commerce",
    inputSchema: z.object({ code: z.string(), percentOff: z.number() }),
    execute: async (i) => createDiscount({ code: String(i.code), percentOff: Number(i.percentOff) }),
  },
  {
    id: "schedule_post",
    description: "Publish/schedule a post to a social platform via the current provider (gated: dry-run unless live).",
    category: "distribution",
    inputSchema: z.object({ platform: z.string(), caption: z.string(), mediaUrls: z.array(z.string()).optional(), when: z.number().optional() }),
    execute: async (i) => publish({ platform: String(i.platform), caption: String(i.caption), mediaUrls: i.mediaUrls as string[] | undefined, when: i.when as number | undefined }),
  },
  {
    id: "supported_platforms",
    description: "List the social platforms the current provider can post to.",
    category: "distribution",
    inputSchema: z.object({}),
    execute: async () => supportedPlatforms(),
  },
  {
    id: "cold_email_sequence",
    description: "Create a cold-outreach email sequence for a lead list (Smartlead, gated).",
    category: "distribution",
    inputSchema: z.object({ name: z.string(), leads: z.array(z.object({ email: z.string(), firstName: z.string().optional() })) }),
    execute: async (i) => coldSequence({ name: String(i.name), leads: (i.leads as { email: string; firstName?: string }[]) ?? [] }),
  },
  {
    id: "find_influencers",
    description: "Discover creators in a niche to seed product to (Modash; needs a key).",
    category: "growth",
    inputSchema: z.object({ niche: z.string(), platform: z.string().optional() }),
    execute: async (i) => discover(String(i.niche), i.platform ? String(i.platform) : "instagram"),
  },
  {
    id: "repurpose_asset",
    description: "Reuse a marketing asset: hand to an influencer, or repurpose (cameo/reframe) and post to TikTok/Reels. Records lineage. Gated.",
    category: "assets",
    inputSchema: z.object({
      assetId: z.string(),
      platform: z.string(),
      mode: z.enum(["influencer", "cameo", "reframe"]),
      campaignId: z.string().optional(),
      discountCode: z.string().optional(),
      productTitle: z.string().optional(),
      personaHandle: z.string().optional(),
    }),
    execute: async (i) => repurposeAsset(i as never),
  },
  {
    id: "register_asset",
    description: "Register a marketing asset (R2 key) into the reuse graph so it can be found & repurposed.",
    category: "assets",
    inputSchema: z.object({ r2Key: z.string().optional(), url: z.string().optional(), kind: z.enum(["image", "video", "clip", "logo", "screenshot"]), campaignId: z.string().optional() }),
    execute: async (i) =>
      cx().mutation(api.assets.register, {
        r2Key: i.r2Key as string | undefined,
        url: i.url as string | undefined,
        kind: i.kind as "image" | "video" | "clip" | "logo" | "screenshot",
        source: "generated",
        campaignId: i.campaignId ? (i.campaignId as Id<"campaigns">) : undefined,
      }),
  },
  {
    id: "propose_cross_promo",
    description: "Propose a cross-marketing move (bundle, shoutout swap, referral, retarget, syndication) across the portfolio.",
    category: "growth",
    inputSchema: z.object({ kind: z.enum(["bundle", "shoutout_swap", "referral", "retarget", "syndication"]), rationale: z.string(), campaignIds: z.array(z.string()).optional() }),
    execute: async (i) =>
      cx().mutation(api.crossmarketing.propose, {
        kind: i.kind as "bundle" | "shoutout_swap" | "referral" | "retarget" | "syndication",
        rationale: String(i.rationale),
        campaignIds: (i.campaignIds as string[] | undefined)?.map((x) => x as Id<"campaigns">),
      }),
  },
];

export const TOOLS_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));
