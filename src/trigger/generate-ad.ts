import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";
import { renderClip, VIDEO_MODELS, primeHiggsfield } from "../lib/video-router";

const exec = promisify(execFile);
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// Verified fal model ids (2026-07-04 research) with estimated cost in pence per 5s clip.
const MODELS: Record<string, { id: string; pence: number }> = {
  "kling-pro": { id: "fal-ai/kling-video/v2.6/pro/image-to-video", pence: 30 },
  "kling-turbo": { id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", pence: 30 },
  "seedance-lite": { id: "fal-ai/bytedance/seedance/v1/lite/image-to-video", pence: 16 },
  "veo-lite": { id: "fal-ai/veo3.1/lite/image-to-video", pence: 35 },
  "veo-flf": { id: "fal-ai/veo3.1/first-last-frame-to-video", pence: 90 },
  lipsync: { id: "fal-ai/kling-video/ai-avatar/v2/standard", pence: 50 },
};
const IMG_PENCE = 8;
const VO_PENCE = 5;

type Scene = {
  kind?: "i2v" | "flf" | "lipsync";
  model: keyof typeof MODELS;
  imagePrompt?: string; // for flf: the FIRST frame
  imageUrl?: string; // client-supplied or pre-generated image — skips generation
  lastImagePrompt?: string; // flf only: the LAST frame
  motion: string; // motion/video prompt (lipsync: ignored)
};

type Payload = {
  title: string;
  streamSlug?: string;
  voScript?: string;
  voiceId?: string;
  caption?: string;
  scenes: Scene[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function falQueue(
  key: string,
  model: string,
  body: Record<string, unknown>,
): Promise<string> {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`fal ${model} HTTP ${submit.status}: ${(await submit.text()).slice(0, 400)}`);
  const sub = (await submit.json()) as { status_url: string; response_url: string };
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(sub.status_url, { headers: { authorization: `Key ${key}` } });
    if (!st.ok) throw new Error(`fal status HTTP ${st.status}`);
    const sd = (await st.json()) as { status: string };
    if (sd.status === "COMPLETED") {
      const res = await fetch(sub.response_url, { headers: { authorization: `Key ${key}` } });
      const rd = (await res.json()) as { video?: { url?: string } };
      if (!rd.video?.url) throw new Error(`fal ${model}: no video url in result`);
      return rd.video.url;
    }
    if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error(`fal ${model} failed: ${JSON.stringify(sd).slice(0, 200)}`);
  }
  throw new Error(`fal ${model} timed out`);
}

const SAFETY_CLAUSE =
  " Fully clothed in modest everyday clothing, tasteful family-friendly commercial photography, no suggestive posing.";

async function genImageOnce(apiKey: string, prompt: string): Promise<Buffer> {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1536", quality: "medium", moderation: "low", n: 1 }),
  });
  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`gpt-image-2 HTTP ${r.status}: ${detail.slice(0, 250)}`);
    (err as Error & { safety?: boolean }).safety = detail.includes("safety");
    throw err;
  }
  const data = (await r.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
}

// gpt-image-2's safety filter false-positives on beauty/fitness prompts; one
// softened retry recovers the fluke instead of failing the whole ad.
async function genImage(apiKey: string, prompt: string): Promise<Buffer> {
  try {
    return await genImageOnce(apiKey, prompt);
  } catch (err) {
    if ((err as Error & { safety?: boolean }).safety) {
      return await genImageOnce(apiKey, prompt + SAFETY_CLAUSE);
    }
    throw err;
  }
}

// Produces a stitched 9:16 video ad: per-scene image gen -> fal image-to-video,
// optional ElevenLabs voiceover, ffmpeg normalize+concat+mix -> R2 -> ready post.
export const generateAd = task({
  id: "generate-ad",
  maxDuration: 3600,
  machine: "medium-1x", // ffmpeg 1080x1920 x264 OOMs the default small machine
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const streamSlug = payload.streamSlug ?? "client-ads";

    const estimate =
      payload.scenes.reduce((sum, s) => sum + MODELS[s.model].pence + IMG_PENCE * (s.kind === "flf" ? 2 : 1), 0) +
      (payload.voScript ? VO_PENCE : 0);
    const settings = await convex.query(api.settings.all, {});
    const cap = Number(settings.dailyCapPence ?? 500);
    const spend = await convex.query(api.spend.forDay, { day: today() });
    if (spend.totalPence + estimate > cap) {
      throw new AbortTaskRunError(`budget: ${spend.totalPence}p spent + ~${estimate}p > ${cap}p cap`);
    }

    const generating = await convex.query(api.posts.byStatus, { status: "generating" });
    const failed = await convex.query(api.posts.byStatus, { status: "failed" });
    const prior = [...generating, ...failed].find((p) => p.externalId === ctx.run.id);
    const postId =
      prior?._id ??
      ((await convex.mutation(api.posts.create, {
        streamSlug,
        platform: "instagram",
        kind: "reel",
        title: payload.title,
        caption: payload.caption,
        slides: payload.scenes.map((s) => ({ prompt: s.motion, role: s.kind ?? "i2v" })),
        externalId: ctx.run.id,
      })) as Id<"posts">);
    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });

    const { OPENAI_API_KEY } = await vaultService("openai");
    const { FAL_KEY } = await vaultService("fal");
    if (!OPENAI_API_KEY || !FAL_KEY) throw new AbortTaskRunError("openai or fal key missing");

    try {
      const dir = await mkdtemp(path.join(tmpdir(), "ad-"));

      // Voiceover first — lipsync scenes need the audio URL as input.
      let voPath: string | null = null;
      let voUrl: string | null = null;
      if (payload.voScript) {
        const el = await vaultService("elevenlabs");
        const elKey = el.ELEVENLABS_API_KEY ?? el.ELEVEN_API_KEY ?? Object.values(el)[0];
        const voice = payload.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
          method: "POST",
          headers: { "xi-api-key": elKey, "content-type": "application/json" },
          body: JSON.stringify({ text: payload.voScript, model_id: "eleven_multilingual_v2" }),
        });
        if (!r.ok) throw new Error(`elevenlabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const mp3 = Buffer.from(await r.arrayBuffer());
        voPath = path.join(dir, "vo.mp3");
        await writeFile(voPath, mp3);
        const voKey = `posts/${postId}/vo.mp3`;
        await putObject(voKey, mp3, "audio/mpeg");
        voUrl = await presignedGet(voKey);
        await convex.mutation(api.spend.log, { day: today(), service: "elevenlabs", model: "tts", costPence: VO_PENCE, ref: postId });
      }

      // Render one scene end-to-end: image -> video (routed) -> normalized 9:16 clip.
      // Scenes run concurrently so a 4-scene ad finishes in ~one scene's wall-time
      // instead of the sum (the 30-min-timeout fix).
      const renderScene = async (scene: Scene, i: number): Promise<string> => {
        logger.log(`scene ${i + 1}/${payload.scenes.length} (${scene.model})`);
        const model = MODELS[scene.model];

        let firstUrl: string;
        let firstBytes: Buffer;
        if (scene.imageUrl) {
          firstUrl = scene.imageUrl;
          firstBytes = Buffer.from(await (await fetch(scene.imageUrl)).arrayBuffer());
        } else {
          if (!scene.imagePrompt) throw new Error(`scene ${i + 1}: needs imagePrompt or imageUrl`);
          firstBytes = await genImage(OPENAI_API_KEY, scene.imagePrompt);
          const firstKey = `posts/${postId}/scene-${i + 1}-a.png`;
          await putObject(firstKey, firstBytes, "image/png");
          firstUrl = await presignedGet(firstKey);
          await convex.mutation(api.spend.log, { day: today(), service: "openai", model: "gpt-image-2", costPence: IMG_PENCE, ref: postId });
        }

        let videoUrl: string;
        if (scene.kind === "flf" && scene.lastImagePrompt) {
          // First↔last-frame morph stays on fal (its FLF endpoints; HF param shape differs).
          const lastImg = await genImage(OPENAI_API_KEY, scene.lastImagePrompt);
          const lastKey = `posts/${postId}/scene-${i + 1}-b.png`;
          await putObject(lastKey, lastImg, "image/png");
          const lastUrl = await presignedGet(lastKey);
          await convex.mutation(api.spend.log, { day: today(), service: "openai", model: "gpt-image-2", costPence: IMG_PENCE, ref: postId });
          try {
            videoUrl = await falQueue(FAL_KEY, model.id, { prompt: scene.motion, first_frame_url: firstUrl, last_frame_url: lastUrl });
          } catch (err) {
            if (String(err).includes("422")) {
              videoUrl = await falQueue(FAL_KEY, model.id, { prompt: scene.motion, image_url: firstUrl, end_image_url: lastUrl });
            } else throw err;
          }
          await convex.mutation(api.spend.log, { day: today(), service: "fal", model: model.id, costPence: model.pence, ref: postId });
        } else if (scene.kind === "lipsync") {
          if (!voUrl) throw new Error("lipsync scene requires voScript");
          videoUrl = await falQueue(FAL_KEY, model.id, { image_url: firstUrl, audio_url: voUrl });
          await convex.mutation(api.spend.log, { day: today(), service: "fal", model: model.id, costPence: model.pence, ref: postId });
        } else {
          // Standard image-to-video: Higgsfield credits FIRST, fal fallback.
          const clip = await renderClip({
            model: scene.model as keyof typeof VIDEO_MODELS,
            imageUrl: firstUrl,
            imageBytes: firstBytes,
            motion: scene.motion,
            durationSeconds: 5,
            aspectRatio: "9:16",
          });
          videoUrl = clip.url;
          await convex.mutation(api.spend.log, {
            day: today(),
            service: clip.provider,
            model: `${scene.model}${clip.credits ? ` (${clip.credits}cr)` : ""}`,
            costPence: clip.costPence,
            ref: postId,
          });
        }

        const raw = path.join(dir, `raw-${i}.mp4`);
        await writeFile(raw, Buffer.from(await (await fetch(videoUrl)).arrayBuffer()));
        const norm = path.join(dir, `norm-${i}.mp4`);
        await exec(FFMPEG, [
          "-y", "-i", raw,
          "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p",
          "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", norm,
        ]);
        // Persist the paid clip — a later stitch failure must never re-cost the render.
        await putObject(`posts/${postId}/scene-${i + 1}.mp4`, await readFile(norm), "video/mp4");
        return norm;
      };

      // Refresh the Higgsfield token once up front so the concurrent scenes below
      // share it instead of each racing to rotate the single-use refresh token.
      await primeHiggsfield();
      const scenePaths = await Promise.all(payload.scenes.map((scene, i) => renderScene(scene, i)));

      // Concat scenes, lay voiceover over the whole cut.
      const listFile = path.join(dir, "list.txt");
      await writeFile(listFile, scenePaths.map((p) => `file '${p}'`).join("\n"));
      const silent = path.join(dir, "cut.mp4");
      await exec(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

      const final = path.join(dir, "final.mp4");
      if (voPath) {
        // apad makes the VO stream infinite, -shortest then cuts at the VIDEO end —
        // a short voiceover can no longer truncate the cut (the original 3s bug).
        await exec(FFMPEG, [
          "-y", "-i", silent, "-i", voPath,
          "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
          "-af", "apad", "-shortest",
          "-movflags", "+faststart", final,
        ]);
      } else {
        await exec(FFMPEG, ["-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", final]);
      }

      const r2Key = `posts/${postId}/ad.mp4`;
      await putObject(r2Key, await readFile(final), "video/mp4");
      const url = await presignedGet(r2Key);
      await convex.mutation(api.posts.attachResult, {
        id: postId,
        slides: [{ r2Key, url, prompt: payload.title, role: "video" }],
      });
      logger.log("ad ready", { postId, url });
      return { postId, url, estimatePence: estimate };
    } catch (err) {
      await convex.mutation(api.posts.fail, { id: postId, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },
});
