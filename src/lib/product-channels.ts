import type { ShopProduct } from "./integrations/shopify";

// Product-aware channel mapping. Turns a product's real attributes (price band,
// category, visual-ness) into the channels + creative formats that actually fit
// it — so the strategist plans for THIS catalogue, not generically. Heuristic
// grounded in DTC channel-by-category practice (see research doc). Deterministic;
// the LLM strategist receives this as ground truth and refines copy/angles.

export type AovBand = "impulse" | "considered" | "premium";
export type ChannelPlan = {
  aovBand: AovBand;
  category: string;
  channels: string[]; // ranked
  formats: string[]; // creative formats
  angle: string; // the core marketing angle for this product
  influencerFit: boolean;
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  pet: ["dog", "cat", "pet", "puppy", "enrichment", "snuffle", "lick", "chew", "treat", "kitten"],
  beauty: ["skin", "beauty", "serum", "makeup", "cosmetic", "hair", "cream", "lotion"],
  home: ["home", "decor", "kitchen", "candle", "furniture", "bedding", "mat", "rug"],
  fashion: ["apparel", "clothing", "wear", "shirt", "dress", "jewel", "accessory", "bag", "shoe"],
  tech: ["gadget", "tech", "electronic", "charger", "device", "smart", "cable"],
  food: ["food", "snack", "drink", "supplement", "coffee", "tea", "protein"],
  fitness: ["fitness", "gym", "workout", "yoga", "training", "sport"],
  baby: ["baby", "infant", "toddler", "nursery"],
};

function detectCategory(p: ShopProduct): string {
  const hay = `${p.title} ${p.productType ?? ""} ${p.tags.join(" ")} ${p.collections.join(" ")}`.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return "general";
}

function aovBand(pricePence?: number): AovBand {
  const p = (pricePence ?? 0) / 100;
  if (p === 0) return "considered"; // unknown → middle
  if (p < 40) return "impulse";
  if (p <= 80) return "considered";
  return "premium";
}

/** Channels + formats + angle for a single product. */
export function planChannels(p: ShopProduct): ChannelPlan {
  const band = aovBand(p.pricePence);
  const category = detectCategory(p);
  const visualCats = ["pet", "beauty", "home", "fashion", "food", "baby"];
  const visual = visualCats.includes(category);

  let channels: string[];
  let formats: string[];
  let angle: string;

  if (band === "impulse") {
    channels = ["tiktok", "instagram", "pinterest", "email"];
    formats = ["reel", "ugc_demo", "before_after", "carousel"];
    angle = "scroll-stopping visual demo + social proof; compress discovery→buy to seconds";
  } else if (band === "premium") {
    channels = ["seo", "youtube", "email", "reddit", "instagram"];
    formats = ["long_demo", "comparison", "testimonial", "carousel"];
    angle = "build trust & demonstrate value before purchase; comparison + proof";
  } else {
    channels = ["instagram", "pinterest", "email", "tiktok", "facebook"];
    formats = ["carousel", "reel", "lifestyle", "story"];
    angle = "aspirational lifestyle framing + retargeting into email";
  }

  // Category nudges.
  if (category === "pet" || category === "baby") {
    channels = dedupe(["instagram", "tiktok", "pinterest", ...channels]);
    angle = `emotional, relatable ${category} moments + community trust; ${angle}`;
  }
  if (category === "tech") channels = dedupe(["youtube", "reddit", ...channels]);
  if (!visual) channels = dedupe([...channels.filter((c) => c !== "pinterest"), "seo"]);

  return { aovBand: band, category, channels, formats, angle, influencerFit: visual && band !== "premium" };
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

/** Store-level rollup: dominant channels across the catalogue + per-product plans. */
export function planStore(products: ShopProduct[]): {
  topChannels: string[];
  categories: string[];
  perProduct: { title: string; handle?: string; plan: ChannelPlan }[];
} {
  const perProduct = products.map((p) => ({ title: p.title, handle: p.handle, plan: planChannels(p) }));
  const score: Record<string, number> = {};
  const cats = new Set<string>();
  for (const { plan } of perProduct) {
    cats.add(plan.category);
    plan.channels.forEach((c, i) => (score[c] = (score[c] ?? 0) + (plan.channels.length - i)));
  }
  const topChannels = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 6);
  return { topChannels, categories: [...cats], perProduct };
}
