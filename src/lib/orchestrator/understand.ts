import { agentJson } from "../../mastra/brain";
import { pullBrand } from "../integrations/assets";
import type { ProductProfile } from "./types";

// "Understand the app I'm talking about." Pulls the product URL's real brand
// material (Microlink: OG image, screenshot, logo, palette, copy) + a slice of
// the page text, then reasons a structured ProductProfile. Reference stills are
// MIRRORED to R2 (pulled, never rendered) so influencers/funnels can reuse them.

async function pageText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 media-engine" }, cache: "no-store" });
    const html = await r.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return "";
  }
}

export async function understand(input: { brief: string; productUrl?: string }): Promise<ProductProfile> {
  let brandBlock = "No product URL supplied — infer from the brief alone.";
  let referenceImageKeys: string[] = [];
  let brandColors: string[] | undefined;

  if (input.productUrl) {
    const [brand, text] = await Promise.all([pullBrand(input.productUrl, { mirror: true }), pageText(input.productUrl)]);
    referenceImageKeys = brand.savedKeys;
    brandColors = brand.colors;
    brandBlock = [
      `URL: ${input.productUrl}`,
      `Title: ${brand.title ?? ""}`,
      `Meta description: ${brand.description ?? ""}`,
      `Publisher: ${brand.publisher ?? ""}`,
      `Palette: ${(brand.colors ?? []).join(", ")}`,
      `Reference stills mirrored to R2: ${brand.savedKeys.join(", ") || "none"}`,
      `Page text (truncated): ${text}`,
    ].join("\n");
  }

  const profile = await agentJson<ProductProfile>("product_analyst", {
    system:
      "You are a senior brand strategist at an AI ad agency. Given a marketing brief and pulled brand material, produce a precise, honest positioning profile. Return ONLY a JSON object.",
    user: `BRIEF FROM CLIENT:\n${input.brief}\n\nPULLED BRAND MATERIAL:\n${brandBlock}\n\nReturn a JSON object with EXACTLY these keys:\n{\n  "productName": string,\n  "oneLiner": string,\n  "category": one of "app_launch"|"ecommerce"|"fiverr_service"|"personal_brand"|"saas"|"content"|"other",\n  "audience": string (ideal customer profile),\n  "painPoints": string[],\n  "valueProps": string[],\n  "differentiators": string[],\n  "tone": string,\n  "keywords": string[] (5-10 SEO seed terms),\n  "competitors": string[] (best guesses),\n  "suggestedChannels": string[] (subset of instagram, tiktok, x, facebook, reddit, linkedin, youtube, email, seo),\n  "notes": string\n}\nBe specific to THIS product; do not be generic.`,
    maxTokens: 1600,
  });

  return {
    ...profile,
    referenceImageKeys,
    brandColors,
    category: profile.category ?? "other",
    keywords: profile.keywords ?? [],
    suggestedChannels: profile.suggestedChannels ?? [],
    competitors: profile.competitors ?? [],
    painPoints: profile.painPoints ?? [],
    valueProps: profile.valueProps ?? [],
    differentiators: profile.differentiators ?? [],
  };
}
