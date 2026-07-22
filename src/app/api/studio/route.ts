import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { presignedGet } from "@/lib/storage";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 60;

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

async function triggerTask(taskId: string, payload: unknown): Promise<string> {
  const trigger = await vaultService("trigger");
  const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
  if (!key) throw new Error("trigger key missing");
  const r = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data).slice(0, 200));
  return data.id as string;
}

// Ad Studio pipeline bridge:
//   plan         -> generate the shot script (approval gate 1)
//   render-draft -> cheap 480p Seedance cut of the approved script (approval gate 2)
//   render-final -> 4K Seedance cut reusing the approved draft images + SFX
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: "plan" | "render-draft" | "render-final";
    projectId: string;
    productImageKey?: string;
    clipCount?: number;
    secondsPerShot?: number;
  };
  const convex = new ConvexHttpClient(CONVEX_URL);
  const project = await convex.query(api.studio.get, { id: body.projectId as Id<"adProjects"> });
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  try {
    if (!(await aiEnabled())) return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
    if (body.action === "plan") {
      const productImageUrl = body.productImageKey ? await presignedGet(body.productImageKey, 60 * 60 * 24) : undefined;
      const runId = await triggerTask("plan-ad-script", {
        projectId: project._id,
        productImageUrl,
        clipCount: body.clipCount,
        secondsPerShot: body.secondsPerShot,
      });
      return NextResponse.json({ runId });
    }

    const shots = (project.shots ?? []) as Shot[];
    if (shots.length === 0) return NextResponse.json({ error: "no script yet" }, { status: 400 });

    if (body.action === "render-draft") {
      const scenes = shots.map((s) => ({
        model: "seedance-draft",
        kind: s.kind === "card" ? "card" : undefined,
        imagePrompt: s.imagePrompt,
        imageUrl: s.imageUrl,
        cardTitle: s.cardTitle,
        cardSub: s.cardSub,
        intent: s.imagePrompt ?? s.motion,
        motion: s.motion,
        seconds: s.seconds,
      }));
      const runId = await triggerTask("generate-ad", {
        title: `${project.title} — draft`,
        concept: `studio-${project._id}-draft`,
        caption: project.caption,
        hook: project.hook,
        quick: false, // honor per-shot seconds
        bestOf: 2,
        musicPrompt: project.musicPrompt ?? "premium commercial music bed, glossy and driving, no vocals",
        scenes,
      });
      await convex.mutation(api.studio.setStage, { id: project._id, stage: "drafting" });
      return NextResponse.json({ runId });
    }

    if (body.action === "render-final") {
      // Find the approved draft post and reuse its generated frames so the 4K cut is
      // faithful to what was signed off. Product/card shots keep their own source.
      const ready = await convex.query(api.posts.byStatus, { status: "ready" });
      const approved = await convex.query(api.posts.byStatus, { status: "approved" });
      const published = await convex.query(api.posts.byStatus, { status: "published" });
      const draftPost = [...ready, ...approved, ...published]
        .filter((p) => p.concept === `studio-${project._id}-draft`)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      const scenes = await Promise.all(
        shots.map(async (s, i) => {
          if (s.kind === "card") return { model: "seedance-4k", kind: "card", cardTitle: s.cardTitle, cardSub: s.cardSub, motion: s.motion, seconds: s.seconds };
          // Reuse the approved draft frame for generated shots; keep product photos as-is.
          let imageUrl = s.imageUrl;
          if (!imageUrl && draftPost) imageUrl = await presignedGet(`posts/${draftPost._id}/scene-${i + 1}-a.png`, 60 * 60 * 24);
          return {
            model: "seedance-4k",
            imageUrl,
            imagePrompt: imageUrl ? undefined : s.imagePrompt,
            intent: s.imagePrompt ?? s.motion,
            motion: s.motion,
            seconds: s.seconds,
          };
        }),
      );
      const runId = await triggerTask("generate-ad", {
        title: `${project.title} — final 4K`,
        concept: `studio-${project._id}-final`,
        caption: project.caption,
        hook: project.hook,
        quick: false,
        bestOf: 1, // frames already approved
        musicPrompt: project.musicPrompt ?? "premium commercial music bed, glossy and driving, no vocals",
        scenes,
      });
      await convex.mutation(api.studio.setStage, { id: project._id, stage: "rendering" });
      return NextResponse.json({ runId });
    }

    return NextResponse.json({ error: "bad action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
