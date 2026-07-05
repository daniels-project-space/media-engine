import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { aiEnabled } from "../lib/ai-gate";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

type Shot = {
  kind?: string;
  imagePrompt?: string;
  imageUrl?: string;
  motion: string;
  seconds: number;
  onText?: string;
  cardTitle?: string;
  cardSub?: string;
};

type Payload = {
  projectId: string;
  productImageUrl?: string; // real product photo — anchored to the demo shot
  clipCount?: number; // how many content shots (default 3)
  secondsPerShot?: number; // default 5 (Seedance native 4–15)
  card?: boolean; // append a brand end-card (default true)
};

// Turns a brief into a UGC ad shot plan following the research-backed arc:
// HOOK (stop the scroll, ~3s) -> DEMO (show the product accurately) -> PAYOFF/CTA.
export const planAdScript = task({
  id: "plan-ad-script",
  maxDuration: 120,
  run: async (payload: Payload, {}) => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const project = await convex.query(api.studio.get, { id: payload.projectId as Id<"adProjects"> });
    if (!project) throw new AbortTaskRunError(`project ${payload.projectId} not found`);
    await convex.mutation(api.studio.setStage, { id: project._id, stage: "scripting" });

    const n = Math.max(2, Math.min(5, payload.clipCount ?? 3));
    const secs = Math.max(4, Math.min(12, payload.secondsPerShot ?? 5));
    if (!(await aiEnabled())) throw new AbortTaskRunError("AI paused — re-enable in Settings to generate scripts");
    const { OPENROUTER_API_KEY } = await vaultService("openrouter");
    if (!OPENROUTER_API_KEY) throw new AbortTaskRunError("openrouter key missing");

    const sys = `You are a senior UGC ad director. Turn a product brief into a ${n}-shot vertical (9:16) ad script.
Structure the shots as an arc: shot 1 = HOOK that stops the scroll in the first 3 seconds; middle shot(s) = DEMO showing the product in use / its benefit; last shot = PAYOFF + clear CTA.
Rules: native, authentic, "shot on iPhone" realism — NOT polished corporate. Keep the product accurate and central. onText = a SHORT punchy on-screen caption (max 6 words), like a real UGC creator would add.
Return STRICT JSON only: {"hook": string, "caption": string, "shots": [{"imagePrompt": string, "motion": string, "onText": string}]}. Exactly ${n} shots. imagePrompt = what the frame shows (composition, subject, setting, lighting). motion = camera/subject movement for the video.`;

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Brand/buyer: ${project.buyer}\nBrief: ${project.brief}${payload.productImageUrl ? "\n(A real product photo is provided — the demo shot will use it.)" : ""}` },
        ],
      }),
    });
    if (!r.ok) throw new Error(`openrouter HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()) as { choices: { message: { content: string } }[] };
    const content = d.choices[0].message.content ?? "";
    // DeepSeek sometimes wraps JSON in ```fences``` or a preamble — extract the object.
    let parsed: { hook?: string; caption?: string; shots?: { imagePrompt: string; motion: string; onText?: string }[] };
    const jsonStr = (content.match(/\{[\s\S]*\}/) ?? [content])[0];
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.error("script LLM non-JSON", { content: content.slice(0, 300) });
      throw new Error("script LLM returned non-JSON");
    }
    const raw = (parsed.shots ?? []).slice(0, n);
    if (raw.length === 0) throw new Error("script LLM returned no shots");

    const shots: Shot[] = raw.map((s, i) => ({
      imagePrompt: s.imagePrompt,
      motion: s.motion,
      onText: s.onText,
      seconds: secs,
      // Anchor the DEMO shot (middle) on the real product photo when provided.
      ...(payload.productImageUrl && i === Math.min(1, raw.length - 1) ? { imageUrl: payload.productImageUrl } : {}),
    }));

    if (payload.card !== false) {
      shots.push({ kind: "card", cardTitle: project.buyer, cardSub: parsed.caption?.slice(0, 40) ?? "", motion: "end card", seconds: Math.min(3, secs) });
    }

    await convex.mutation(api.studio.setScript, {
      id: project._id,
      shots,
      hook: parsed.hook,
      caption: parsed.caption,
    });
    logger.log("script ready", { projectId: project._id, shots: shots.length });
    return { projectId: project._id, shots: shots.length };
  },
});
