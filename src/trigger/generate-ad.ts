import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { putObject, presignedGet } from "../lib/storage";
import { CANONICAL_VIDEO_MODEL, renderClip, primeHiggsfield } from "../lib/video-router";
import { higgsGenerateAudio } from "../lib/higgsfield";
import { creativeServiceToken } from "../lib/creative-service";
import { scoreImage } from "../lib/vision";
import { buildVariantTag } from "../lib/variant";
import sharp from "sharp";
import * as opentype from "opentype.js";

const exec = promisify(execFile);
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

type Scene = {
  kind?: "i2v" | "card";
  model: typeof CANONICAL_VIDEO_MODEL;
  /** A client-approved product or reference image, never a generated frame. */
  imageUrl?: string;
  motion: string;
  // Card kind: deterministic Sharp/FFmpeg typography, never AI-generated text.
  cardTitle?: string;
  cardSub?: string;
  // QC intent override (defaults to the supplied motion direction).
  intent?: string;
  // Per-scene clip length. Seedance 2.0 clips must be 4–15 seconds.
  seconds?: number;
};

type Payload = {
  title: string;
  streamSlug?: string;
  caption?: string;
  scenes: Scene[];
  // Higgsfield music/SFX mixes the final cut when enabled. There is no third-party audio fallback.
  quick?: boolean;
  segSeconds?: number;
  musicPrompt?: string;
  concept?: string;
  hook?: string;
  /** Must be true. Any legacy caller fails closed. */
  subscriptionOnly?: true;
  projectId?: string;
  renderJobId?: string;
  renderKind?: "draft" | "final";
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// The container has no system fonts, so cards use bundled glyph outlines and
// always render identically in local and Trigger containers.
function brandFont(): string | null {
  const candidates = [
    path.join(process.cwd(), "assets/brand.ttf"),
    "/app/assets/brand.ttf",
    path.join(process.cwd(), "../assets/brand.ttf"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function textPath(font: opentype.Font, text: string, cy: number, fontSize: number, fill: string): string {
  const scale = fontSize / font.unitsPerEm;
  const width = font.getAdvanceWidth(text, fontSize);
  const x = 540 - width / 2;
  const ascent = font.ascender * scale;
  const glyphs = font.getPath(text, x, cy + ascent / 2 - fontSize * 0.1, fontSize);
  return `<path d="${glyphs.toPathData(2)}" fill="${fill}"/>`;
}

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
    const font = opentype.parse((await readFile(fontPath)).buffer.slice(0) as ArrayBuffer);
    inner = textPath(font, title.toUpperCase(), 900, 116, "#ffffff");
    if (sub) inner += textPath(font, sub.toUpperCase(), 1010, 40, "#d7ff3e");
  }
  const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="1920" fill="#0a0b0d"/><rect x="0" y="952" width="1080" height="4" fill="#d7ff3e"/>${inner}</svg>`;
  const png = path.join(path.dirname(out), `card-${path.basename(out)}.png`);
  await sharp(Buffer.from(svg)).png().toFile(png);
  await exec(ffmpeg, [
    "-y", "-loop", "1", "-i", png, "-t", String(seconds),
    "-vf", "fps=30,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "20", out,
  ]);
}

/**
 * Stitches an approved-reference marketing video. Each moving scene is rendered
 * by Higgsfield Seedance 2.0 against a quoted subscription-credit balance; brand
 * cards, Higgsfield audio, and visual drift QC remain deterministic and local.
 */
export const generateAd = task({
  id: "generate-ad",
  maxDuration: 3600,
  machine: "large-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const renderServiceToken = payload.renderJobId ? await creativeServiceToken() : undefined;
    let lifecycleFailureRecorded = false;
    const failRenderLifecycle = async (err: unknown): Promise<void> => {
      if (!payload.renderJobId || !renderServiceToken || lifecycleFailureRecorded) return;
      try {
        await convex.action(api.creativeGateway.failRender, {
          serviceToken: renderServiceToken,
          payload: {
            jobId: payload.renderJobId as Id<"renderJobs">,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        lifecycleFailureRecorded = true;
      } catch (lifecycleErr) {
        logger.error("could not record render job failure", {
          renderJobId: payload.renderJobId,
          error: lifecycleErr instanceof Error ? lifecycleErr.message : String(lifecycleErr),
        });
      }
    };
    const abortRender = async (message: string): Promise<never> => {
      const error = new AbortTaskRunError(message);
      await failRenderLifecycle(error);
      throw error;
    };

    if (payload.subscriptionOnly !== true) {
      await abortRender("generate-ad accepts only Higgsfield subscription-credit render plans");
    }
    if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) {
      await abortRender("render requires at least one scene");
    }
    const invalidScene = payload.scenes.find((scene) => {
      const seconds = scene.seconds ?? payload.segSeconds ?? 5;
      return (
        scene.model !== CANONICAL_VIDEO_MODEL ||
        (scene.kind !== undefined && scene.kind !== "i2v" && scene.kind !== "card") ||
        (!Number.isFinite(seconds) || seconds <= 0) ||
        (scene.kind !== "card" && (!scene.imageUrl || seconds < 4 || seconds > 15))
      );
    });
    if (invalidScene) {
      await abortRender(
        "every moving scene requires an approved reference image, Higgsfield Seedance 2.0, and a 4–15 second duration",
      );
    }

    const streamSlug = payload.streamSlug ?? "client-ads";
    const quick = payload.quick !== false;
    const seg = payload.segSeconds ?? 5;
    const sceneDur = (scene: Scene): number => scene.seconds ?? (quick ? seg : 5);
    const sceneOffset = (index: number): number =>
      payload.scenes.slice(0, index).reduce((sum, scene) => sum + sceneDur(scene), 0);
    const totalDur = payload.scenes.reduce((sum, scene) => sum + sceneDur(scene), 0);
    const tag = buildVariantTag({
      concept: payload.concept ?? payload.title,
      hook: payload.hook ?? payload.caption,
      variantId: ctx.run.id.slice(-8),
    });

    const generating = await convex.query(api.posts.byStatus, { status: "generating" });
    const failed = await convex.query(api.posts.byStatus, { status: "failed" });
    const prior = [...generating, ...failed].find((post) => post.externalId === ctx.run.id);
    const postId =
      prior?._id ??
      ((await convex.mutation(api.posts.create, {
        streamSlug,
        platform: "instagram",
        kind: "reel",
        title: payload.title,
        hook: payload.hook,
        caption: payload.caption,
        slides: payload.scenes.map((scene) => ({ prompt: scene.motion, role: scene.kind ?? "i2v" })),
        externalId: ctx.run.id,
        variantTag: tag.variantTag,
        concept: payload.concept ?? tag.concept,
        hookId: tag.hookId,
        variantId: tag.variantId,
      })) as Id<"posts">);
    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });

    let higgsCreditsUsed = 0;
    let motionScoreSum = 0;
    let motionScoreCount = 0;

    try {
      const dir = await mkdtemp(path.join(tmpdir(), "ad-"));

      const renderScene = async (scene: Scene, index: number): Promise<string> => {
        logger.log(`scene ${index + 1}/${payload.scenes.length} (${scene.kind ?? scene.model})`);
        const duration = sceneDur(scene);
        if (scene.kind === "card") {
          const norm = path.join(dir, `norm-${index}.mp4`);
          await makeCard(FFMPEG, norm, scene.cardTitle ?? "", scene.cardSub, duration);
          await putObject(`posts/${postId}/scene-${index + 1}.mp4`, await readFile(norm), "video/mp4");
          return norm;
        }

        if (!scene.imageUrl) throw new Error(`scene ${index + 1}: approved reference image is required`);
        const source = await fetch(scene.imageUrl);
        if (!source.ok) throw new Error(`scene ${index + 1}: reference image HTTP ${source.status}`);
        const firstBytes = Buffer.from(await source.arrayBuffer());
        const sourceType = source.headers.get("content-type")?.split(";", 1)[0] ?? "image/png";
        const firstContentType = sourceType.startsWith("image/") ? sourceType : "image/png";
        const firstKey = `posts/${postId}/scene-${index + 1}-a.png`;
        await putObject(firstKey, firstBytes, firstContentType);
        const firstUrl = await presignedGet(firstKey);

        const clip = await renderClip({
          model: CANONICAL_VIDEO_MODEL,
          imageUrl: firstUrl,
          imageBytes: firstBytes,
          imageContentType: firstContentType,
          motion: scene.motion,
          durationSeconds: duration,
          aspectRatio: "9:16",
        });
        higgsCreditsUsed += clip.credits;
        await convex.mutation(api.spend.log, {
          day: today(),
          service: "higgsfield",
          model: `seedance_2_0 (${clip.credits}cr)`,
          costPence: 0,
          ref: postId,
        });

        const raw = path.join(dir, `raw-${index}.mp4`);
        const response = await fetch(clip.url);
        if (!response.ok || !response.body) throw new Error(`clip download HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(raw));
        const norm = path.join(dir, `norm-${index}.mp4`);
        await exec(FFMPEG, [
          "-y", "-i", raw, "-t", String(duration),
          "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p",
          "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", norm,
        ]);

        // Drift guard: if image-to-video stops matching the approved product,
        // retain product accuracy with a deterministic Ken-Burns fallback.
        const lastFrame = path.join(dir, `lf-${index}.jpg`);
        await exec(FFMPEG, ["-y", "-sseof", "-0.2", "-i", norm, "-frames:v", "1", lastFrame]);
        const lastFrameBytes = await readFile(lastFrame);
        const { score, issues } = await scoreImage(
          `data:image/jpeg;base64,${lastFrameBytes.toString("base64")}`,
          scene.intent ?? scene.motion,
        );
        motionScoreSum += score;
        motionScoreCount++;
        logger.log(`scene ${index + 1} motion QC: last-frame score ${score}${issues ? ` — ${issues}` : ""}`);
        if (score < 45) {
          logger.warn(`scene ${index + 1} drifted (score ${score}) — Ken-Burns fallback on approved still`);
          const still = path.join(dir, `still-${index}.png`);
          await writeFile(still, firstBytes);
          await exec(FFMPEG, [
            "-y", "-loop", "1", "-i", still, "-t", String(duration),
            "-vf", `scale=1350:2400,zoompan=z='min(zoom+0.0009,1.12)':d=${Math.round(duration * 30)}:s=1080x1920:fps=30,setsar=1,format=yuv420p`,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", norm,
          ]);
        }

        await putObject(`posts/${postId}/scene-${index + 1}.mp4`, await readFile(norm), "video/mp4");
        return norm;
      };

      await primeHiggsfield();
      const scenePaths: string[] = [];
      for (let index = 0; index < payload.scenes.length; index++) {
        scenePaths.push(await renderScene(payload.scenes[index], index));
      }

      const listFile = path.join(dir, "list.txt");
      await writeFile(listFile, scenePaths.map((scenePath) => `file '${scenePath}'`).join("\n"));
      const silent = path.join(dir, "cut.mp4");
      await exec(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

      const final = path.join(dir, "final.mp4");
      if (quick) {
        const musicPrompt = payload.musicPrompt ?? "upbeat modern commercial music bed, glossy and driving, no vocals, social-ad energy";
        const [musicUrl, whooshUrl] = await Promise.all([
          higgsGenerateAudio("sonilo_music", musicPrompt, Math.ceil(totalDur) + 1),
          higgsGenerateAudio("mirelo_text_to_audio", "fast clean cinematic whoosh transition swoosh, short punchy", 1),
        ]);
        if (musicUrl) {
          const musicResponse = await fetch(musicUrl);
          if (!musicResponse.ok || !musicResponse.body) throw new Error(`Higgsfield music download HTTP ${musicResponse.status}`);
          const musicPath = path.join(dir, "music.mp3");
          await pipeline(Readable.fromWeb(musicResponse.body as import("node:stream/web").ReadableStream), createWriteStream(musicPath));
          const inputs = ["-i", silent, "-i", musicPath];
          const mixes = [`[1:a]volume=0.9,atrim=0:${totalDur.toFixed(2)},afade=t=out:st=${Math.max(0, totalDur - 0.4).toFixed(2)}:d=0.4[music]`];
          const labels = ["[music]"];
          if (whooshUrl) {
            const whooshResponse = await fetch(whooshUrl);
            if (!whooshResponse.ok || !whooshResponse.body) throw new Error(`Higgsfield SFX download HTTP ${whooshResponse.status}`);
            const whooshPath = path.join(dir, "whoosh.mp3");
            await pipeline(Readable.fromWeb(whooshResponse.body as import("node:stream/web").ReadableStream), createWriteStream(whooshPath));
            let inputIndex = 2;
            for (let sceneIndex = 1; sceneIndex < payload.scenes.length; sceneIndex++) {
              const delay = Math.round(sceneOffset(sceneIndex) * 1000);
              inputs.push("-i", whooshPath);
              mixes.push(`[${inputIndex}:a]adelay=${delay}|${delay},volume=0.6[w${sceneIndex}]`);
              labels.push(`[w${sceneIndex}]`);
              inputIndex++;
            }
          }
          await exec(FFMPEG, [
            "-y", ...inputs, "-filter_complex", `${mixes.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0[a]`,
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", final,
          ]);
          await convex.mutation(api.spend.log, { day: today(), service: "higgsfield", model: "audio (music+sfx)", costPence: 0, ref: postId });
        } else {
          await exec(FFMPEG, ["-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", final]);
        }
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
      if (motionScoreCount > 0) {
        await convex.mutation(api.posts.setQc, { id: postId, qcScore: Math.round(motionScoreSum / motionScoreCount) });
      }
      if (payload.renderJobId && renderServiceToken) {
        await convex.action(api.creativeGateway.completeRender, {
          serviceToken: renderServiceToken,
          payload: { jobId: payload.renderJobId as Id<"renderJobs">, postId, creditsUsed: higgsCreditsUsed },
        });
      }
      logger.log("ad ready", { postId, url, variantTag: tag.variantTag, higgsCreditsUsed });
      return { postId, url, variantTag: tag.variantTag, estimatePence: 0, higgsCreditsUsed };
    } catch (err) {
      await convex.mutation(api.posts.fail, { id: postId, error: err instanceof Error ? err.message : String(err) });
      await failRenderLifecycle(err);
      throw err;
    }
  },
});
