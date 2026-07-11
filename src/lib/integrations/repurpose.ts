import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { mediaUrl } from "../media";
import { chatJson } from "../llm";
import { ensureDisclosure } from "./disclosure";
import { publish } from "./social";
import { isLive } from "./gate";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Asset repurposing — the "reuse a marketing image so an influencer posts it, or
// repurpose it with a cameo and upload to TikTok" flows. Records lineage
// (original → derived → placement). We do NOT render here: cameo/reframe emit a
// derived-asset PLAN + a gated placement; the actual pixels are produced later by
// the (gated) generation pipeline. Distribution is dry-run unless liveMode.

export type RepurposeMode = "influencer" | "cameo" | "reframe";
export type RepurposeInput = {
  assetId: string;
  platform: string; // tiktok | instagram | youtube | ...
  mode: RepurposeMode;
  campaignId?: string;
  discountCode?: string;
  productTitle?: string;
  personaHandle?: string; // whose cameo / which influencer persona
};

const ASPECT: Record<string, string> = { tiktok: "9:16", instagram: "9:16", youtube: "9:16", pinterest: "2:3", x: "16:9", facebook: "1:1" };

export async function repurposeAsset(input: RepurposeInput): Promise<{ ok: boolean; detail: string; placementId?: string; derivedAssetId?: string; brief?: unknown }> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const asset = await cx.query(api.assets.get, { id: input.assetId as Id<"assets"> });
  if (!asset) return { ok: false, detail: "asset not found" };
  const srcUrl = asset.r2Key ? mediaUrl(asset.r2Key) : asset.url ?? "";
  const targetAspect = ASPECT[input.platform] ?? "9:16";

  // Draft a platform-native hook + caption for this asset (LLM, with disclosure).
  let hook = "", caption = "";
  try {
    const draft = await chatJson<{ hook: string; caption: string }>({
      system: "You are a short-form social copywriter. Return ONLY JSON {\"hook\":string,\"caption\":string}.",
      user: `Repurpose an existing marketing asset for ${input.platform}. Product: ${input.productTitle ?? "the product"}. Mode: ${input.mode}${input.personaHandle ? `, featuring ${input.personaHandle}` : ""}. Write a native scroll-stopping hook (<=12 words) and a caption with a CTA${input.discountCode ? ` using code ${input.discountCode}` : ""}. Keep it authentic to ${input.platform}.`,
      maxTokens: 500,
    });
    hook = draft.hook ?? "";
    caption = draft.caption ?? "";
  } catch {
    hook = `New from ${input.productTitle ?? "us"}`;
    caption = `Check it out${input.discountCode ? ` — use ${input.discountCode}` : ""}.`;
  }
  // Our assets are AI-generated; influencer posts are gifted/paid.
  caption = ensureDisclosure(caption, { aiGenerated: true, gifted: input.mode === "influencer" });

  const live = await isLive();

  if (input.mode === "influencer") {
    // Hand the EXISTING asset to an influencer: brief pack + tracking code + placement.
    const placementId = await cx.mutation(api.assets.addPlacement, {
      assetId: input.assetId as Id<"assets">,
      campaignId: input.campaignId ? (input.campaignId as Id<"campaigns">) : undefined,
      platform: input.platform,
      persona: input.personaHandle,
      trackingCode: input.discountCode,
      discountCode: input.discountCode,
    });
    await cx.mutation(api.assets.setPlacementStatus, { id: placementId, status: "handed_off" });
    const brief = {
      assetUrl: srcUrl,
      platform: input.platform,
      hooks: [hook],
      caption,
      code: input.discountCode,
      dos: ["keep it authentic, film/post natively", "disclose the partnership", "tag the brand"],
      donts: ["don't alter the product", "don't drop the disclosure"],
    };
    return { ok: true, detail: `${live ? "" : "[dry-run] "}influencer pack ready for ${input.platform}`, placementId, brief };
  }

  // cameo / reframe → register a DERIVED asset (a plan; pixels rendered later) +
  // lineage edge + a gated placement. No rendering happens here.
  const derivedAssetId = await cx.mutation(api.assets.register, {
    kind: asset.kind === "image" ? "image" : "video",
    source: "derived",
    campaignId: input.campaignId ? (input.campaignId as Id<"campaigns">) : undefined,
    personaId: asset.personaId,
    productId: asset.productId,
    aspect: targetAspect,
    tags: [input.platform, input.mode],
    notes: `${input.mode} of ${input.assetId} for ${input.platform} (${targetAspect}); render pending`,
  });
  await cx.mutation(api.assets.addDerivation, {
    parentAssetId: input.assetId as Id<"assets">,
    childAssetId: derivedAssetId,
    op: input.mode === "cameo" ? "cameo_insert" : "reframe",
    params: { platform: input.platform, aspect: targetAspect, persona: input.personaHandle, hook, caption },
  });
  const placementId = await cx.mutation(api.assets.addPlacement, {
    assetId: derivedAssetId,
    campaignId: input.campaignId ? (input.campaignId as Id<"campaigns">) : undefined,
    platform: input.platform,
    persona: input.personaHandle,
    discountCode: input.discountCode,
  });
  // Gated post attempt (dry-run unless live + provider key). Uses the source URL
  // as a stand-in until the derived render exists.
  const res = await publish({ platform: input.platform, caption: `${hook}\n\n${caption}`.trim(), mediaUrls: srcUrl ? [srcUrl] : undefined });
  await cx.mutation(api.assets.setPlacementStatus, {
    id: placementId,
    status: res.ok ? (res.dryRun ? "scheduled" : "posted") : "failed",
    externalId: res.data && typeof res.data === "object" && "externalId" in res.data ? String((res.data as { externalId?: string }).externalId ?? "") : undefined,
    result: { detail: res.detail },
  });
  return {
    ok: res.ok,
    detail: `${input.mode} → ${input.platform} (${targetAspect}); render pending (gated: Higgsfield Soul-ID / fal face-swap for cameo, ffmpeg/AutoFlip for reframe). ${res.detail}`,
    derivedAssetId,
    placementId,
  };
}
