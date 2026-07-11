import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { chat, parseJson } from "../llm";
import { aiEnabled } from "../ai-gate";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Persona content pipeline — plans a run of Instagram carousels for one influencer
// persona and writes them as scheduled `planned` posts. Faithful port of the
// plan-week task, now on the subscription (Claude Sonnet via llm.ts) instead of
// the dead OpenRouter path. Prompts are scene-only; the persona GLOBAL LOCK is
// injected at generation time by generate-carousel.

export type PlannedPost = {
  dayOffset: number;
  title: string;
  hook: string;
  caption: string;
  slides: { role: "base_model" | "niche_slide" | "cta_slide"; prompt: string }[];
};

export async function planPersonaWeek(payload: {
  personaId: string;
  days?: number;
  postsPerDay?: number;
}): Promise<{ personaId: string; handle: string; created: number; plans: PlannedPost[] }> {
  const convex = new ConvexHttpClient(CONVEX_URL);
  const days = payload.days ?? 7;
  const perDay = payload.postsPerDay ?? 1;

  const personas = await convex.query(api.personas.list, {});
  const persona = personas.find((p) => p._id === payload.personaId);
  if (!persona) throw new Error(`persona ${payload.personaId} not found`);

  if (!(await aiEnabled())) throw new Error("AI paused — re-enable in Settings to plan content");

  // Content de-dup: pull this persona's recent posts so the planner doesn't
  // repeat concepts/angles over time.
  let recentTitles: string[] = [];
  try {
    const recent = await convex.query(api.posts.forPersona, { personaId: persona._id });
    recentTitles = recent
      .map((p) => p.title)
      .filter((t): t is string => Boolean(t))
      .slice(-40);
  } catch {
    /* no history yet */
  }
  const avoid = recentTitles.length
    ? `\nAlready posted recently — do NOT repeat these concepts or angles: ${recentTitles.join("; ")}.`
    : "";

  const templates = await convex.query(api.prompts.list, {});
  const captionRules = templates.find((t) => t.category === "caption")?.body ?? "";
  const realism = templates.find((t) => t.category === "realism_suffix" && t.name.startsWith("Realism"))?.body ?? "";
  const facelessAddon = templates.find((t) => t.name.startsWith("Faceless UGC") && t.category === "realism_suffix")?.body ?? "";
  const examples = templates
    .filter((t) => t.category === "base_model" || t.category === "niche_slide")
    .slice(0, 4)
    .map((t) => `- (${t.category}) ${t.body.slice(0, 220)}`)
    .join("\n");

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
Vary environments and activities across posts (permutation, no repeats). Hooks: short, curiosity-gap, max 8 words.${avoid}
Caption rules: ${captionRules}

Style examples of good slide prompts:
${examples}

JSON schema per item: {"dayOffset": number, "title": string, "hook": string, "caption": string, "slides": [{"role": string, "prompt": string}]}`;

  const raw = await chat({ system, user, maxTokens: 8000 });
  const plans = extractArray<PlannedPost>(raw);

  const base = new Date();
  base.setHours(18, 0, 0, 0); // default posting slot 18:00
  let created = 0;
  for (const plan of plans) {
    const scheduledAt = base.getTime() + plan.dayOffset * 24 * 60 * 60 * 1000;
    await convex.mutation(api.posts.create, {
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
    created++;
  }
  return { personaId: persona._id, handle: persona.handle, created, plans };
}

function extractArray<T>(raw: string): T[] {
  const s = raw.indexOf("[");
  const e = raw.lastIndexOf("]");
  if (s === -1 || e === -1) {
    // maybe the model wrapped it in an object — try parseJson then find an array field
    const obj = parseJson<Record<string, unknown>>(raw);
    const arr = Object.values(obj).find((v) => Array.isArray(v));
    if (Array.isArray(arr)) return arr as T[];
    throw new Error(`planner returned no JSON array: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(s, e + 1)) as T[];
}
