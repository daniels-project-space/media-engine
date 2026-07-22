import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { chat } from "../lib/llm";
import { aiEnabled } from "../lib/ai-gate";
import { putObject, presignedGet } from "../lib/storage";
import { higgsGenerateAudio } from "../lib/higgsfield";

const exec = promisify(execFile);
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// Aspect presets: reframe one master video into the platform shapes.
const FORMATS: Record<string, { w: number; h: number; label: string }> = {
  reel: { w: 1080, h: 1920, label: "9:16 Reel/Story/TikTok" },
  feed: { w: 1080, h: 1350, label: "4:5 Feed" },
  square: { w: 1080, h: 1080, label: "1:1 Square" },
  wide: { w: 1920, h: 1080, label: "16:9 YouTube" },
};

type Payload = {
  sourcePostId: string;
  formats?: (keyof typeof FORMATS)[]; // default all
  captionVariants?: number; // how many caption/hook variants (default 3)
  freshMusic?: boolean; // regenerate a new music bed per remix
  publish?: boolean; // if true, mark remixes approved (autopilot then posts them)
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function streamTo(url: string, out: string) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), createWriteStream(out));
}

// Takes ONE finished post (video or image carousel) and fans it out into many
// platform formats × caption variants, each saved as its own new post. This is
// the 1-content → many-posts multiplier.
export const remixContent = task({
  id: "remix-content",
  maxDuration: 1800,
  machine: "large-1x",
  run: async (payload: Payload) => {
    if (!(await aiEnabled())) throw new AbortTaskRunError("AI generation is paused");
    const convex = new ConvexHttpClient(CONVEX_URL);
    const source = await convex.query(api.posts.get, { id: payload.sourcePostId as Id<"posts"> });
    if (!source) throw new AbortTaskRunError("source post not found");
    const slides = (source.slides ?? []).filter((s) => s.r2Key);
    if (slides.length === 0) throw new AbortTaskRunError("source has no rendered media");

    const formats = payload.formats ?? (["reel", "feed", "square"] as (keyof typeof FORMATS)[]);
    const nCaptions = payload.captionVariants ?? 3;
    const isVideo = Boolean(slides[0].r2Key?.endsWith(".mp4"));

    // 1) Caption/hook variants through the subscription-authenticated Codex
    // CLI. Disabled runs return above, before any Convex or provider request.
    let captions: { hook: string; caption: string }[] = [
      { hook: source.hook ?? source.title ?? "", caption: source.caption ?? "" },
    ];
    try {
      const t = await chat({
        system: "Reply ONLY with a JSON array. No markdown.",
        user: `Rewrite this ad into ${nCaptions} distinct scroll-stopping variants, each with a different angle/hook. Keep the product accurate. NO hashtags, keyword-rich caption, first line is a hook, end with a question CTA.\nOriginal: ${source.caption ?? source.title}\nJSON: [{"hook": "...", "caption": "..."}]`,
        maxTokens: 1500,
      });
      const slice = t.slice(t.indexOf("["), t.lastIndexOf("]") + 1);
      const parsed = JSON.parse(slice) as { hook: string; caption: string }[];
      if (parsed.length) captions = parsed.slice(0, nCaptions);
    } catch {
      logger.warn("caption remix failed — using original");
    }

    // 2) For video sources: download once, reframe into each format. For image
    //    carousels: reframe the cover. Then cross with caption variants → posts.
    const dir = await mkdtemp(path.join(tmpdir(), "remix-"));
    let srcVideo: string | null = null;
    if (isVideo) {
      srcVideo = path.join(dir, "src.mp4");
      await streamTo(await presignedGet(slides[0].r2Key!), srcVideo);
    }

    // Optional fresh music bed for video remixes.
    let musicPath: string | null = null;
    if (isVideo && payload.freshMusic) {
      const m = await higgsGenerateAudio("sonilo_music", "fresh upbeat social-ad music bed, glossy driving, no vocals", 8);
      if (m) { musicPath = path.join(dir, "m.mp3"); await streamTo(m, musicPath); }
    }

    const created: string[] = [];
    for (const fmt of formats) {
      const F = FORMATS[fmt];
      let outKey: string;
      if (isVideo && srcVideo) {
        const out = path.join(dir, `${fmt}.mp4`);
        const vf = `scale=${F.w}:${F.h}:force_original_aspect_ratio=increase,crop=${F.w}:${F.h},fps=30,setsar=1,format=yuv420p`;
        if (musicPath) {
          await exec(FFMPEG, ["-y", "-i", srcVideo, "-i", musicPath, "-vf", vf, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out]);
        } else {
          await exec(FFMPEG, ["-y", "-i", srcVideo, "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", out]);
        }
        outKey = `posts/remix-${source._id}/${fmt}.mp4`;
        await putObject(outKey, await readFile(out), "video/mp4");
      } else {
        // image: reframe cover
        const srcImg = path.join(dir, "cover.png");
        await streamTo(await presignedGet(slides[0].r2Key!), srcImg);
        const out = path.join(dir, `${fmt}.jpg`);
        await exec(FFMPEG, ["-y", "-i", srcImg, "-vf", `scale=${F.w}:${F.h}:force_original_aspect_ratio=increase,crop=${F.w}:${F.h}`, out]);
        outKey = `posts/remix-${source._id}/${fmt}.jpg`;
        await putObject(outKey, await readFile(out), "image/jpeg");
      }
      const url = await presignedGet(outKey);

      // Cross each format with each caption variant.
      for (const cap of captions) {
        const platform = fmt === "wide" ? "youtube" : "instagram";
        const kind = isVideo ? (fmt === "reel" ? "reel" : "image") : "image";
        const postId = (await convex.mutation(api.posts.create, {
          streamSlug: source.streamSlug,
          personaId: source.personaId,
          platform,
          kind: kind as "reel" | "image",
          title: `${source.title ?? "remix"} · ${F.label}`,
          hook: cap.hook,
          caption: cap.caption,
          slides: [{ r2Key: outKey, url, prompt: `remix ${fmt}`, role: isVideo ? "video" : undefined }],
        })) as Id<"posts">;
        await convex.mutation(api.posts.attachResult, {
          id: postId,
          slides: [{ r2Key: outKey, url, prompt: `remix ${fmt}`, role: isVideo ? "video" : undefined }],
        });
        if (payload.publish) await convex.mutation(api.posts.approve, { id: postId });
        created.push(postId);
      }
    }

    if (musicPath) await convex.mutation(api.spend.log, { day: today(), service: "higgsfield", model: "remix music", costPence: 0, ref: source._id });
    logger.log("remix done", { formats: formats.length, captions: captions.length, created: created.length });
    return { source: source._id, created: created.length, formats, captions: captions.length };
  },
});
