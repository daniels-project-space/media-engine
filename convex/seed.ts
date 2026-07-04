import { mutation } from "./_generated/server";
import { MAXFUSION_PROMPTS } from "./seedData";

const REALISM_SUFFIX =
  "Shot on an iPhone, 1080p phone-photo quality (not 4K — slightly soft and grainy with subtle motion blur), natural imperfect indoor lighting slightly underexposed. Natural matte skin, NO beauty filter, NO skin glow, NO retouching, realistic pores and texture. Candid casual Instagram energy, nothing polished or professional — looks like a real person's camera roll. No text overlays.";

// Added for faceless UGC persona shots (the Karolis method): keep the face hidden.
const FACELESS_ADDON =
  "She holds her phone up so it FULLY COVERS HER FACE — face completely hidden behind the phone, only hair visible above it. Slightly dirty mirror with faint fingerprint smudges.";

// Motion for faceless UGC image-to-video: the #1 failure is the model animating a
// face-reveal, so lock the phone in place.
const FACELESS_MOTION =
  "Natural breathing and subtle body sway only. The phone stays exactly in front of her face the entire time — she does NOT lower it and her face is never revealed. Camera locked, no zoom, no hair flying, no morphing, no warping.";

const ELARA_LOCK =
  "elaravoss. 26-year-old Swedish-Italian woman, tall slender elegant build, olive-toned skin with natural freckles on the nose, dark brown wavy shoulder-length hair with a single silver-platinum streak on the left side, hazel eyes with golden flecks, three thin gold rings, minimal gold jewelry, quiet-luxury wardrobe in earth tones, cashmere and linen. " +
  REALISM_SUFFIX;

const KIRA_LOCK =
  "kiravex. 22-year-old English woman, petite build, fair skin with a warm undertone and faint freckles, long platinum blonde hair that reads white-silver in cool light, bright ice-blue expressive eyes, thin black choker she never removes, gamer-girl cosplay aesthetic with LED-lit room accents. " +
  REALISM_SUFFIX;

const STORYBOARD_TEMPLATE = `3-scene reel storyboard (JSON prompting). Structure every reel as:
Scene 1 HOOK (0-3s): medium shot, direct-to-camera, golden hour, handheld. One-line hook that creates a question.
Scene 2 BODY (3-30s): close-up push-in. Deliver the fact / value / situation. Keep pacing tight, no dead air.
Scene 3 PAYOFF (30-45s): extreme close-up punchline with subversion, then walk-away exit.
Output one JSON object per scene: { "shot", "camera", "action", "dialogue", "duration" }. Subtitles always on. Optional brand_integration slot: place the product in-world (in-scene, never an overlay).`;

const CAPTION_RULES = `Caption rules (per post): NO hashtags. Keyword-rich search caption phrased as a question or curiosity gap (e.g. "How much were the workers who built the pyramids actually paid?"). First line = second hook. End with a question CTA that invites comments ("lmk"). Include one save-bait fact per post. Keep under 200 chars for feed display.`;

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("streams").first();
    if (existing) return { seeded: false, reason: "already seeded" };
    const now = Date.now();

    for (const s of [
      {
        slug: "persona-growth",
        name: "Persona Growth",
        kind: "persona_growth" as const,
        goal: "Grow AI persona Instagram accounts to brand-ready scale",
        autonomy: "approve" as const,
      },
      {
        slug: "product-ads",
        name: "Product Ads",
        kind: "product_ads" as const,
        goal: "UGC carousels and shorts promoting Snuffloe, db-cinema and apps",
        autonomy: "auto" as const,
      },
      {
        slug: "shorts-factory",
        name: "Shorts Factory",
        kind: "shorts" as const,
        goal: "Image-to-video shorts for new persona YouTube channels",
        autonomy: "approve" as const,
      },
      {
        slug: "email-engine",
        name: "Email Engine",
        kind: "email" as const,
        goal: "Link-in-bio capture, Snuffloe flows, db-cinema renters, cold outreach",
        autonomy: "approve" as const,
      },
    ]) {
      await ctx.db.insert("streams", { ...s, status: "draft", createdAt: now });
    }

    const elara = await ctx.db.insert("personas", {
      name: "Elara Voss",
      handle: "@elaravoss",
      archetype: "flagship",
      globalLock: ELARA_LOCK,
      bio: "26 | Stockholm + Mediterranean | Slow fashion & intentional living | Capsule wardrobe curator",
      identitySummary:
        "Swedish-Italian art history graduate turned capsule wardrobe curator. Quiet luxury, earth tones, signature silver hair streak.",
      loraUrl:
        "https://v3b.fal.media/files/b/0a936380/xte2-0brdV7E-gnvuRHYW_pytorch_lora_weights.safetensors",
      loraTrigger: "elaravoss",
      stage: "grow",
      niche: "quiet-luxury lifestyle",
      streamSlug: "persona-growth",
      createdAt: now,
    });

    const kira = await ctx.db.insert("personas", {
      name: "Kira Vex",
      handle: "@kiravex",
      archetype: "flagship",
      globalLock: KIRA_LOCK,
      bio: "22 | cosplay queen + gym rat | your favorite blonde disaster | lvl 99 at making you look twice",
      identitySummary:
        "Working-class Bristol girl turned cosplay content creator. Chaotic Shoreditch flat, black cat Pixel, never removes her Nan's choker.",
      loraUrl:
        "https://v3b.fal.media/files/b/0a936392/hchPuG9xPCFk7BXah8GjY_pytorch_lora_weights.safetensors",
      loraTrigger: "kiravex",
      stage: "grow",
      niche: "gamer-girl cosplay",
      streamSlug: "persona-growth",
      createdAt: now,
    });

    for (const a of [
      { platform: "instagram" as const, handle: "@elaravoss", personaId: elara },
      { platform: "instagram" as const, handle: "@kiravex", personaId: kira },
      { platform: "youtube" as const, handle: "Elara Voss", personaId: elara },
      { platform: "fanvue" as const, handle: "kiravex", personaId: kira },
    ]) {
      await ctx.db.insert("accounts", {
        ...a,
        status: "unlinked",
        notes: "Create account + connect token to activate",
      });
    }

    for (const t of [
      { name: "GLOBAL LOCK — Elara Voss", category: "global_lock" as const, body: ELARA_LOCK, source: "ai-instagram persona port" },
      { name: "GLOBAL LOCK — Kira Vex", category: "global_lock" as const, body: KIRA_LOCK, source: "ai-instagram persona port" },
      { name: "Realism suffix (apply to every image)", category: "realism_suffix" as const, body: REALISM_SUFFIX, source: "karolis + daniel" },
      { name: "Faceless UGC — hide the face", category: "realism_suffix" as const, body: FACELESS_ADDON, source: "karolis" },
      { name: "Faceless UGC motion (locked, no face reveal)", category: "motion" as const, body: FACELESS_MOTION, source: "karolis + daniel" },
      { name: "3-scene reel storyboard", category: "storyboard" as const, body: STORYBOARD_TEMPLATE, source: "chloe-vs-history + emythecop" },
      { name: "Caption rules", category: "caption" as const, body: CAPTION_RULES, source: "chloe-vs-history" },
    ]) {
      await ctx.db.insert("promptTemplates", { ...t, createdAt: now });
    }

    for (const p of MAXFUSION_PROMPTS) {
      await ctx.db.insert("promptTemplates", {
        name: p.name,
        category: p.category,
        body: p.body,
        niche: p.niche ?? undefined,
        source: p.source,
        createdAt: now,
      });
    }

    return { seeded: true };
  },
});
