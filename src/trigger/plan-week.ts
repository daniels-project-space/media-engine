import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

type Payload = {
  personaId: string;
  days?: number; // default 7
  postsPerDay?: number; // default 1
};

type PlannedPost = {
  dayOffset: number;
  title: string;
  hook: string;
  caption: string;
  slides: { role: "base_model" | "niche_slide" | "cta_slide"; prompt: string }[];
};

// Plans a week of Instagram carousels for one persona. Structure mirrors the
// Maxfusion Vault flow: each post = base model shot + niche slides (+ optional CTA),
// permuted across environments/hooks. Prompts are scene-only — the persona
// GLOBAL LOCK is prefixed at generation time by generate-carousel.
export const planWeek = task({
  id: "plan-week",
  maxDuration: 600,
  run: async (payload: Payload) => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const days = payload.days ?? 7;
    const perDay = payload.postsPerDay ?? 1;

    const personas = await convex.query(api.personas.list, {});
    const persona = personas.find((p) => p._id === payload.personaId);
    if (!persona) throw new AbortTaskRunError(`persona ${payload.personaId} not found`);

    const templates = await convex.query(api.prompts.list, {});
    const captionRules = templates.find((t) => t.category === "caption")?.body ?? "";
    const realism = templates.find((t) => t.category === "realism_suffix" && t.name.startsWith("Realism"))?.body ?? "";
    const facelessAddon = templates.find((t) => t.name.startsWith("Faceless UGC") && t.category === "realism_suffix")?.body ?? "";
    const examples = templates
      .filter((t) => t.category === "base_model" || t.category === "niche_slide")
      .slice(0, 4)
      .map((t) => `- (${t.category}) ${t.body.slice(0, 220)}`)
      .join("\n");

    const { OPENROUTER_API_KEY } = await vaultService("openrouter");
    if (!OPENROUTER_API_KEY) throw new AbortTaskRunError("vault openrouter key missing");

    // Faceless personas (no trained LoRA / faceless archetype) hide the face for the
    // Karolis look; flagship personas (Elara/Kira) show their consistent face.
    const faceless = persona.archetype === "faceless" || !persona.loraTrigger;
    const modelSlideRule = faceless
      ? `Slide 1 role "base_model" = a mirror-selfie or over-the-shoulder shot where she HOLDS HER PHONE UP COVERING HER FACE (face never visible). Describe the SCENE, outfit and setting only; refer to her as "the woman". Append to this slide's prompt: "${facelessAddon}"`
      : `Slide 1 role "base_model" = the persona in a specific environment/outfit/activity, her face visible (her exact appearance is injected separately — refer to her as "the woman").`;

    const system = `You plan Instagram carousel posts for an AI persona. Reply with ONLY a JSON array, no markdown fences, no commentary.`;
    const user = `Persona: ${persona.name} (${persona.handle}) — ${persona.niche ?? "lifestyle"}.
Identity: ${persona.identitySummary ?? persona.bio ?? ""}
This persona is ${faceless ? "FACELESS — her face must never be shown, keep it hidden behind her phone in every shot of her." : "a flagship face-shown persona."}

Plan ${days * perDay} Instagram carousel posts (${perDay}/day for ${days} days, dayOffset 0..${days - 1}).
Each post: 3-4 slides. ${modelSlideRule} Slides 2-3 role "niche_slide" = supporting lifestyle detail shots matching her niche (hands, objects, food, setups — no faces). Optional last slide role "cta_slide".
Every slide prompt must be photorealistic-style and end with this realism instruction: "${realism}"
Vary environments and activities across posts (permutation, no repeats). Hooks: short, curiosity-gap, max 8 words.
Caption rules: ${captionRules}

Style examples of good slide prompts:
${examples}

JSON schema per item: {"dayOffset": number, "title": string, "hook": string, "caption": string, "slides": [{"role": string, "prompt": string}]}`;

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        provider: { only: ["deepseek", "alibaba"] },
        max_tokens: 8000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`openrouter HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = (await r.json()) as { choices: { message: { content: string } }[] };
    let text = data.choices[0].message.content.trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error(`planner returned no JSON array: ${text.slice(0, 200)}`);
    text = text.slice(start, end + 1);

    let plans: PlannedPost[];
    try {
      plans = JSON.parse(text) as PlannedPost[];
    } catch {
      throw new Error(`planner JSON parse failed: ${text.slice(0, 300)}`);
    }

    const base = new Date();
    base.setHours(18, 0, 0, 0); // default posting slot 18:00

    const created: string[] = [];
    for (const plan of plans) {
      const scheduledAt = base.getTime() + plan.dayOffset * 24 * 60 * 60 * 1000;
      const id = await convex.mutation(api.posts.create, {
        streamSlug: persona.streamSlug ?? "persona-growth",
        personaId: persona._id as Id<"personas">,
        platform: "instagram",
        kind: "carousel",
        title: plan.title,
        hook: plan.hook,
        caption: plan.caption,
        slides: plan.slides.map((s) => ({ prompt: s.prompt, role: s.role })),
        scheduledAt,
      });
      created.push(id);
    }

    logger.log("week planned", { persona: persona.handle, posts: created.length });
    return { personaId: persona._id, created: created.length };
  },
});
