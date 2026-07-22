import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { putObject, presignedGet } from "../lib/storage";
import { renderClip } from "../lib/video-router";
import { aiEnabled } from "../lib/ai-gate";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const EST_PENCE_PER_CLIP = 40;

const DEFAULT_MOTION =
  "Natural breathing and subtle body sway only. If a phone covers her face it stays exactly in place — she never lowers it, her face is never revealed. Camera completely locked, no zoom, no hair flying, no morphing, no warping.";

type Payload = {
  // Animate an existing image into a 9:16 short.
  imageUrl: string;
  streamSlug: string;
  personaId?: string;
  title: string;
  caption?: string;
  motionPrompt?: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const generateShort = task({
  id: "generate-short",
  maxDuration: 900,
  run: async (payload: Payload, { ctx }) => {
    if (!(await aiEnabled())) throw new AbortTaskRunError("AI generation is paused");
    const convex = new ConvexHttpClient(CONVEX_URL);

    const settings = await convex.query(api.settings.all, {});
    const cap = Number(settings.dailyCapPence ?? 500);
    const spend = await convex.query(api.spend.forDay, { day: today() });
    if (spend.totalPence + EST_PENCE_PER_CLIP > cap) {
      throw new AbortTaskRunError(`daily budget cap: ${spend.totalPence}p + ${EST_PENCE_PER_CLIP}p > ${cap}p`);
    }

    const templates = await convex.query(api.prompts.list, {});
    // Prefer the locked faceless motion (no face-reveal, no morph) for persona shorts.
    const motion =
      payload.motionPrompt ??
      templates.find((t) => t.name === "Faceless UGC motion (locked, no face reveal)")?.body ??
      templates.find((t) => t.category === "motion")?.body ??
      DEFAULT_MOTION;

    // Idempotent across Trigger retries: reuse the post tagged with this run id.
    const failedPosts = await convex.query(api.posts.byStatus, { status: "failed" });
    const generating = await convex.query(api.posts.byStatus, { status: "generating" });
    const prior = [...failedPosts, ...generating].find((p) => p.externalId === ctx.run.id);
    const postId =
      prior?._id ??
      ((await convex.mutation(api.posts.create, {
        streamSlug: payload.streamSlug,
        personaId: payload.personaId as Id<"personas"> | undefined,
        platform: "instagram",
        kind: "short",
        title: payload.title,
        caption: payload.caption,
        slides: [{ prompt: motion }],
        externalId: ctx.run.id,
      })) as Id<"posts">);
    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });

    try {
      // Animate the still — Higgsfield credits first, fal fallback (via shared router).
      const imageBytes = Buffer.from(await (await fetch(payload.imageUrl)).arrayBuffer());
      const clip = await renderClip({
        model: "seedance-lite",
        imageUrl: payload.imageUrl,
        imageBytes,
        motion,
        durationSeconds: 5,
        aspectRatio: "9:16",
      });

      const mp4 = Buffer.from(await (await fetch(clip.url)).arrayBuffer());
      const r2Key = `posts/${postId}/short.mp4`;
      await putObject(r2Key, mp4, "video/mp4");
      const url = await presignedGet(r2Key);

      await convex.mutation(api.spend.log, {
        day: today(),
        service: clip.provider,
        model: `seedance-lite${clip.credits ? ` (${clip.credits}cr)` : ""}`,
        costPence: clip.costPence,
        ref: postId,
      });
      await convex.mutation(api.posts.attachResult, {
        id: postId,
        slides: [{ r2Key, url, prompt: motion, role: "video" }],
      });
      logger.log("short ready", { postId });
      return { postId, url };
    } catch (err) {
      await convex.mutation(api.posts.fail, {
        id: postId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
