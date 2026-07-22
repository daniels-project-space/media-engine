import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";
import { renderClip, VIDEO_MODELS, primeHiggsfield } from "../lib/video-router";
import { higgsGenerateAudio } from "../lib/higgsfield";
import { scoreImage } from "../lib/vision";
import { buildVariantTag } from "../lib/variant";
import { aiEnabled } from "../lib/ai-gate";
import { IMAGE_WORKFLOW_PAUSED_REASON, needsGeneratedImage } from "../lib/image-workflow";
import sharp from "sharp";
import * as opentype from "opentype.js";

const exec = promisify(execFile);
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// Verified fal model ids (2026-07-04 research) with estimated cost in pence per 5s clip.
const MODELS: Record<string, { id: string; pence: number }> = {
  "kling-pro": { id: "fal-ai/kling-video/v2.6/pro/image-to-video", pence: 30 },
  "kling-turbo": { id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", pence: 30 },
  "seedance-lite": { id: "fal-ai/bytedance/seedance/v1/lite/image-to-video", pence: 16 },
  "seedance-draft": { id: "bytedance/seedance-2.0/image-to-video", pence: 20 },
  "seedance-4k": { id: "bytedance/seedance-2.0/image-to-video", pence: 250 },
  "veo-lite": { id: "fal-ai/veo3.1/lite/image-to-video", pence: 35 },
  "veo-flf": { id: "fal-ai/veo3.1/first-last-frame-to-video", pence: 90 },
  lipsync: { id: "fal-ai/kling-video/ai-avatar/v2/standard", pence: 50 },
};
const VO_PENCE = 5;

type Scene = {
  kind?: "i2v" | "flf" | "lipsync" | "card";
  model: keyof typeof MODELS;
  imagePrompt?: string; // legacy generated-frame requests are paused
  imageUrl?: string; // approved existing image required for every non-card scene
  lastImagePrompt?: string; // legacy generated end-frame requests are paused
  motion: string; // motion/video prompt (lipsync: ignored)
  // card kind: deterministic ffmpeg text card (sharp brand text — never AI-generated).
  cardTitle?: string;
  cardSub?: string;
  // QC intent override (defaults to imagePrompt). What the render should depict.
  intent?: string;
  // Per-scene clip length (seconds). Overrides the quick-mode uniform trim, so a
  // planned 10s shot renders full-length. Seedance 2.0 supports 4–15s.
  seconds?: number;
};

type Payload = {
  title: string;
  streamSlug?: string;
  voScript?: string;
  voiceId?: string;
  caption?: string;
  scenes: Scene[];
  // Quick UGC mode (default): short hard-cut edit, AI music bed + whoosh SFX, no VO.
  quick?: boolean;
  segSeconds?: number; // per-scene trim in quick mode (default 1.4)
  musicPrompt?: string; // brand-fit music vibe
  bestOf?: number; // retained for payload compatibility; approved assets need no candidates
  concept?: string; // campaign/concept for variant tagging (default: title)
  hook?: string; // hook line for variant tagging
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

// The container has no system fonts, so we embed the font in the card SVG. The
// brand font is bundled via trigger.config additionalFiles; resolve it robustly.
import { existsSync } from "node:fs";
function brandFont(): string | null {
  const candidates = [
    path.join(process.cwd(), "assets/brand.ttf"),
    "/app/assets/brand.ttf",
    path.join(process.cwd(), "../assets/brand.ttf"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

// Convert a line of text to a centered SVG <path> using the bundled font's glyph
// outlines — pure vector, no font-loading at render time, so it renders identically
// in any container (the Trigger sharp/resvg couldn't load an embedded @font-face).
function textPath(font: opentype.Font, text: string, cy: number, fontSize: number, fill: string): string {
  const scale = fontSize / font.unitsPerEm;
  const width = font.getAdvanceWidth(text, fontSize);
  const x = 540 - width / 2;
  const ascent = font.ascender * scale;
  const p = font.getPath(text, x, cy + ascent / 2 - fontSize * 0.1, fontSize);
  return `<path d="${p.toPathData(2)}" fill="${fill}"/>`;
}

// Deterministic brand text card: glyph-outline SVG → PNG (sharp) → looped clip.
// AI-generated text cards garble; this never does.
async function makeCard(
  ffmpeg: string,
  out: string,
  title: string,
  sub: string | undefined,
  seconds: number,
): Promise<void> {
  const fontPath = brandFont();
  let inner = "";
  if (fontPath) {
    const font = opentype.parse(
      (await readFile(fontPath)).buffer.slice(0) as ArrayBuffer,
    );
    inner = textPath(font, title.toUpperCase(), 900, 116, "#ffffff");
    if (sub) inner += textPath(font, sub.toUpperCase(), 1010, 40, "#d7ff3e");
  }
  const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="1920" fill="#0a0b0d"/><rect x="0" y="952" width="1080" height="4" fill="#d7ff3e"/>${inner}</svg>`;
  const png = path.join(path.dirname(out), `card-${path.basename(out)}.png`);
  await sharp(Buffer.from(svg)).png().toFile(png);
  await promisify(execFile)(ffmpeg, [
    "-y", "-loop", "1", "-i", png, "-t", String(seconds),
    "-vf", "fps=30,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "20", out,
  ]);
}

// Produces a stitched 9:16 video ad from approved source images -> image-to-video,
// optional ElevenLabs voiceover, ffmpeg normalize+concat+mix -> R2 -> ready post.
export const generateAd = task({
  id: "generate-ad",
  maxDuration: 3600,
  machine: "large-1x", // 4 concurrent 1080x1920 x264 encodes need the RAM headroom
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    // No equal-quality replacement for generated image frames is configured.
    // Existing approved source assets and deterministic cards continue to work.
    if (!(await aiEnabled())) throw new AbortTaskRunError("AI generation is paused");
    if (payload.scenes.some(needsGeneratedImage)) throw new AbortTaskRunError(IMAGE_WORKFLOW_PAUSED_REASON);
    const convex = new ConvexHttpClient(CONVEX_URL);
    const streamSlug = payload.streamSlug ?? "client-ads";
    const quick = payload.quick !== false; // quick UGC is the default
    const seg = payload.segSeconds ?? 1.4; // per-scene trim in quick mode
    // Each scene's clip length: explicit scene.seconds wins (planned shots), else the
    // quick-mode uniform trim, else 5s. Cumulative offsets drive the SFX cut points.
    const sceneDur = (s: Scene): number => s.seconds ?? (quick ? seg : 5);
    const sceneOffset = (idx: number): number =>
      payload.scenes.slice(0, idx).reduce((sum, s) => sum + sceneDur(s), 0);
    const totalDur = payload.scenes.reduce((sum, s) => sum + sceneDur(s), 0);
    const tag = buildVariantTag({
      concept: payload.concept ?? payload.title,
      hook: payload.hook ?? payload.caption,
      variantId: ctx.run.id.slice(-8),
    });

    const estimate =
      payload.scenes.reduce(
        (sum, s) => sum + (s.kind === "card" ? 0 : (MODELS[s.model]?.pence ?? 30)),
        0,
      ) + (payload.voScript ? VO_PENCE : 0);
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
        hook: payload.hook,
        caption: payload.caption,
        slides: payload.scenes.map((s) => ({ prompt: s.motion, role: s.kind ?? "i2v" })),
        externalId: ctx.run.id,
        variantTag: tag.variantTag,
        // Store the RAW concept for exact linking (studio-<id>-draft, order-<id>);
        // the variantTag embeds the slugged form for readability. (tag.concept is
        // truncated to 18 chars and must NOT be the link key.)
        concept: payload.concept ?? tag.concept,
        hookId: tag.hookId,
        variantId: tag.variantId,
      })) as Id<"posts">);
    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });

    const { FAL_KEY } = await vaultService("fal");
    if (!FAL_KEY) throw new AbortTaskRunError("fal key missing");

    try {
      const dir = await mkdtemp(path.join(tmpdir(), "ad-"));

      // Voiceover first — lipsync scenes need the audio URL as input.
      // Skipped in quick mode (music + SFX carry the ad instead of narration).
      let voPath: string | null = null;
      let voUrl: string | null = null;
      if (payload.voScript && !quick) {
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
        logger.log(`scene ${i + 1}/${payload.scenes.length} (${scene.kind ?? scene.model})`);
        const model = MODELS[scene.model];

        // Brand text card — deterministic ffmpeg, no AI (sharp correct typography).
        if (scene.kind === "card") {
          const norm = path.join(dir, `norm-${i}.mp4`);
          await makeCard(FFMPEG, norm, scene.cardTitle ?? "", scene.cardSub, sceneDur(scene));
          await putObject(`posts/${postId}/scene-${i + 1}.mp4`, await readFile(norm), "video/mp4");
          return norm;
        }

        let firstUrl: string;
        let firstBytes: Buffer;
        const intent = scene.intent ?? scene.imagePrompt ?? scene.motion;
        if (scene.imageUrl) {
          firstUrl = scene.imageUrl;
          firstBytes = Buffer.from(await (await fetch(scene.imageUrl)).arrayBuffer());
        } else throw new AbortTaskRunError(IMAGE_WORKFLOW_PAUSED_REASON);

        let videoUrl: string;
        if (scene.kind === "lipsync") {
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
            durationSeconds: Math.round(sceneDur(scene)),
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
        // Stream to disk — a whole 4K clip in a Buffer was the OOM source.
        const resp = await fetch(videoUrl);
        if (!resp.ok || !resp.body) throw new Error(`clip download HTTP ${resp.status}`);
        await pipeline(Readable.fromWeb(resp.body as import("node:stream/web").ReadableStream), createWriteStream(raw));
        const norm = path.join(dir, `norm-${i}.mp4`);
        await exec(FFMPEG, [
          "-y", "-i", raw,
          // Trim to the scene's planned length (quick uniform trim, or explicit seconds).
          ...(quick || scene.seconds ? ["-t", String(sceneDur(scene))] : []),
          "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p",
          "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", norm,
        ]);

        // Drift guard: i2v can warp the subject away from the source (the ARRI clip
        // stopped looking like a camera). QC the clip's last frame; if it drifted off
        // the intent, fall back to a slow Ken-Burns push on the real still — the
        // product then stays 100% accurate.
        if (scene.kind !== "flf") {
          const lastFrame = path.join(dir, `lf-${i}.jpg`);
          await exec(FFMPEG, ["-y", "-sseof", "-0.2", "-i", norm, "-frames:v", "1", lastFrame]);
          const lf = await readFile(lastFrame);
          const { score, issues } = await scoreImage(`data:image/jpeg;base64,${lf.toString("base64")}`, intent);
          logger.log(`scene ${i + 1} motion QC: last-frame score ${score}${issues ? " — " + issues : ""}`);
          if (score < 45) {
            logger.warn(`scene ${i + 1} drifted (score ${score}) — Ken-Burns fallback on the real still`);
            const stillPng = path.join(dir, `still-${i}.png`);
            await writeFile(stillPng, firstBytes);
            const dur = sceneDur(scene);
            await exec(FFMPEG, [
              "-y", "-loop", "1", "-i", stillPng, "-t", String(dur),
              "-vf", `scale=1350:2400,zoompan=z='min(zoom+0.0009,1.12)':d=${Math.round(dur * 30)}:s=1080x1920:fps=30,setsar=1,format=yuv420p`,
              "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", norm,
            ]);
          }
        }

        // Persist the paid clip — a later stitch failure must never re-cost the render.
        await putObject(`posts/${postId}/scene-${i + 1}.mp4`, await readFile(norm), "video/mp4");
        return norm;
      };

      // Refresh the Higgsfield token once up front so the sequential scenes below
      // reuse it instead of each rotating the single-use refresh token.
      await primeHiggsfield();

      // Sequential: HF serializes jobs anyway, and one image+video+ffmpeg in flight
      // at a time keeps peak memory flat (concurrent 1080p encodes were the OOM).
      const scenePaths: string[] = [];
      for (let i = 0; i < payload.scenes.length; i++) {
        scenePaths.push(await renderScene(payload.scenes[i], i));
      }

      // Concat scenes, lay voiceover over the whole cut.
      const listFile = path.join(dir, "list.txt");
      await writeFile(listFile, scenePaths.map((p) => `file '${p}'`).join("\n"));
      const silent = path.join(dir, "cut.mp4");
      await exec(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

      const final = path.join(dir, "final.mp4");
      if (quick) {
        // Quick UGC audio: AI music bed + whoosh SFX on each cut (Higgsfield), no VO.
        const videoDur = totalDur;
        const musicPrompt =
          payload.musicPrompt ??
          "upbeat modern commercial music bed, glossy and driving, no vocals, social-ad energy";
        const [musicUrl, whooshUrl] = await Promise.all([
          higgsGenerateAudio("sonilo_music", musicPrompt, Math.ceil(videoDur) + 1),
          higgsGenerateAudio("mirelo_text_to_audio", "fast clean cinematic whoosh transition swoosh, short punchy", 1),
        ]);

        if (musicUrl) {
          const musicPath = path.join(dir, "music.mp3");
          await pipeline(
            Readable.fromWeb((await fetch(musicUrl)).body as import("node:stream/web").ReadableStream),
            createWriteStream(musicPath),
          );
          const inputs = ["-i", silent, "-i", musicPath];
          const amix = [`[1:a]volume=0.9,atrim=0:${videoDur.toFixed(2)},afade=t=out:st=${(videoDur - 0.4).toFixed(2)}:d=0.4[music]`];
          const labels = ["[music]"];
          if (whooshUrl) {
            const whooshPath = path.join(dir, "whoosh.mp3");
            await pipeline(
              Readable.fromWeb((await fetch(whooshUrl)).body as import("node:stream/web").ReadableStream),
              createWriteStream(whooshPath),
            );
            let idx = 2;
            for (let k = 1; k < payload.scenes.length; k++) {
              const t = Math.round(sceneOffset(k) * 1000);
              inputs.push("-i", whooshPath);
              amix.push(`[${idx}:a]adelay=${t}|${t},volume=0.6[w${k}]`);
              labels.push(`[w${k}]`);
              idx++;
            }
          }
          const fc = `${amix.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0[a]`;
          await exec(FFMPEG, [
            "-y", ...inputs, "-filter_complex", fc,
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest",
            "-movflags", "+faststart", final,
          ]);
          await convex.mutation(api.spend.log, { day: today(), service: "higgsfield", model: "audio (music+sfx)", costPence: 0, ref: postId });
        } else {
          await exec(FFMPEG, ["-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", final]);
        }
      } else if (voPath) {
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
      logger.log("ad ready", { postId, url, variantTag: tag.variantTag });
      return { postId, url, variantTag: tag.variantTag, estimatePence: estimate };
    } catch (err) {
      await convex.mutation(api.posts.fail, { id: postId, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },
});
