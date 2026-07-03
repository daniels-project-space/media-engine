import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const FAL_MODEL = "fal-ai/bytedance/seedance/v1/lite/image-to-video";
const EST_PENCE_PER_CLIP = 40;

const DEFAULT_MOTION =
  "Natural breathing motion only. Subtle fabric movement. No hair flying, no morphing, no warping. Camera completely locked.";

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
    const convex = new ConvexHttpClient(CONVEX_URL);

    const settings = await convex.query(api.settings.all, {});
    const cap = Number(settings.dailyCapPence ?? 500);
    const spend = await convex.query(api.spend.forDay, { day: today() });
    if (spend.totalPence + EST_PENCE_PER_CLIP > cap) {
      throw new AbortTaskRunError(`daily budget cap: ${spend.totalPence}p + ${EST_PENCE_PER_CLIP}p > ${cap}p`);
    }

    const templates = await convex.query(api.prompts.list, {});
    const motion =
      payload.motionPrompt ?? templates.find((t) => t.category === "motion")?.body ?? DEFAULT_MOTION;

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

    const { FAL_KEY } = await vaultService("fal");
    if (!FAL_KEY) throw new AbortTaskRunError("vault fal/FAL_KEY missing");

    try {
      const submit = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
        method: "POST",
        headers: { authorization: `Key ${FAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: motion,
          image_url: payload.imageUrl,
          resolution: "720p",
          duration: "5",
        }),
      });
      if (!submit.ok) throw new Error(`fal submit HTTP ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
      // fal returns canonical polling URLs (base path differs from the model path) — always use them.
      const sub = (await submit.json()) as { request_id: string; status_url: string; response_url: string };
      logger.log("fal queued", { request_id: sub.request_id });

      let videoUrl: string | null = null;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await fetch(sub.status_url, { headers: { authorization: `Key ${FAL_KEY}` } });
        if (!st.ok) throw new Error(`fal status HTTP ${st.status}: ${(await st.text()).slice(0, 200)}`);
        const sd = (await st.json()) as { status: string };
        if (sd.status === "COMPLETED") {
          const res = await fetch(sub.response_url, { headers: { authorization: `Key ${FAL_KEY}` } });
          if (!res.ok) throw new Error(`fal result HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const rd = (await res.json()) as { video?: { url?: string } };
          videoUrl = rd.video?.url ?? null;
          break;
        }
        if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error(`fal render failed: ${JSON.stringify(sd)}`);
      }
      if (!videoUrl) throw new Error("fal render timed out");

      const mp4 = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
      const r2Key = `posts/${postId}/short.mp4`;
      await putObject(r2Key, mp4, "video/mp4");
      const url = await presignedGet(r2Key);

      await convex.mutation(api.spend.log, {
        day: today(),
        service: "fal",
        model: FAL_MODEL,
        costPence: EST_PENCE_PER_CLIP,
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
