import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk";
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
  /** Durable, private R2 key from the approved Convex plan; never a URL. */
  imageKey?: string;
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
  /** The only task inputs: an admitted render job and its one-time capability. */
  renderJobId: string;
  dispatchToken: string;
};

type ClaimedExecution = {
  job: { id: Id<"renderJobs">; kind: "draft" | "final"; planVersion: number };
  project: {
    id: Id<"adProjects">;
    buyer: string;
    title: string;
    narrative?: { corePromise: string; arc: { beat: string; purpose: string }[]; cta: string };
    shots: Array<{
      kind?: string;
      imageKey?: string;
      motion: string;
      beat?: string;
      imagePrompt?: string;
      seconds: number;
      cardTitle?: string;
      cardSub?: string;
    }>;
  };
  referenceKey: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function requiredDispatchValue(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new AbortTaskRunError(`generate-ad requires a valid ${field}`);
  }
  return value;
}

function asClaimedExecution(value: unknown): ClaimedExecution {
  if (!value || typeof value !== "object") throw new AbortTaskRunError("render claim returned no approved execution context");
  const candidate = value as Partial<ClaimedExecution>;
  if (
    !candidate.job ||
    !candidate.project ||
    typeof candidate.job.id !== "string" ||
    (candidate.job.kind !== "draft" && candidate.job.kind !== "final") ||
    typeof candidate.project.id !== "string" ||
    typeof candidate.project.title !== "string" ||
    !Array.isArray(candidate.project.shots) ||
    typeof candidate.referenceKey !== "string" ||
    !candidate.referenceKey.startsWith("products/client/")
  ) {
    throw new AbortTaskRunError("render claim returned malformed execution data");
  }
  return candidate as ClaimedExecution;
}

function canonicalScenes(execution: ClaimedExecution): Scene[] {
  const shots = execution.project.shots;
  if (shots.length === 0 || shots.length > 6) {
    throw new Error("approved storyboard must contain between one and six shots");
  }
  return shots.map((shot, index) => {
    const seconds = shot.seconds;
    if (!Number.isFinite(seconds) || seconds <= 0 || typeof shot.motion !== "string" || !shot.motion.trim() || shot.motion.length > 500) {
      throw new Error(`approved storyboard shot ${index + 1} is invalid`);
    }
    if (shot.kind === "card") {
      if (seconds < 2 || seconds > 4) throw new Error(`approved end card ${index + 1} must be 2–4 seconds`);
      return {
        kind: "card" as const,
        motion: "hold clean brand end card",
        cardTitle: shot.cardTitle ?? execution.project.title,
        cardSub: shot.cardSub ?? execution.project.narrative?.cta,
        seconds,
      };
    }
    if (shot.imageKey !== execution.referenceKey || seconds < 4 || seconds > 15) {
      throw new Error(`approved footage shot ${index + 1} must use the verified client reference for 4–15 seconds`);
    }
    return {
      kind: "i2v" as const,
      imageKey: execution.referenceKey,
      motion: shot.motion,
      intent: shot.beat ?? shot.imagePrompt ?? execution.project.title,
      seconds,
    };
  });
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
 * cards and assembly remain deterministic and local. No non-Seedance model is
 * allowed to consume the connected subscription credits.
 */
export const generateAd = task({
  id: "generate-ad",
  maxDuration: 3600,
  machine: "large-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const jobId = requiredDispatchValue(payload.renderJobId, "renderJobId", 128) as Id<"renderJobs">;
    const dispatchToken = requiredDispatchValue(payload.dispatchToken, "dispatchToken", 128);
    const convex = new ConvexHttpClient(CONVEX_URL);
    const renderServiceToken = await creativeServiceToken();
    let execution: ClaimedExecution | null = null;
    let lifecycleFailureRecorded = false;

    const failRenderLifecycle = async (err: unknown): Promise<void> => {
      if (!execution || lifecycleFailureRecorded) return;
      try {
        await convex.action(api.creativeGateway.failRender, {
          serviceToken: renderServiceToken,
          payload: {
            jobId: execution.job.id,
            triggerRunId: ctx.run.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        lifecycleFailureRecorded = true;
      } catch (lifecycleErr) {
        logger.error("could not record claimed render job failure", {
          renderJobId: execution.job.id,
          error: lifecycleErr instanceof Error ? lifecycleErr.message : String(lifecycleErr),
        });
      }
    };

    try {
      // This is intentionally the first non-log side effect. A direct Trigger
      // invocation without the private one-time capability cannot read a plan,
      // create a post, access R2, or reach a billable renderer.
      const claim = await convex.action(api.creativeGateway.claimRenderExecution, {
        serviceToken: renderServiceToken,
        payload: { jobId, dispatchToken, triggerRunId: ctx.run.id },
      });
      execution = asClaimedExecution(claim);
      const scenes = canonicalScenes(execution);

      // Non-billable MCP manifest verification happens before the post ledger
      // or any media side effect. It currently fails closed until the exact
      // Seedance tool contract has been reviewed.
      await primeHiggsfield();

      const concept = `creative-${execution.project.id}-${execution.job.kind}-v${execution.job.planVersion}`;
      const tag = buildVariantTag({
        concept,
        hook: execution.project.narrative?.arc[0]?.beat ?? execution.project.narrative?.corePromise,
        variantId: ctx.run.id.slice(-8),
      });
      const postId = (await convex.action(api.creativeGateway.createRenderPost, {
        serviceToken: renderServiceToken,
        payload: {
          jobId: execution.job.id,
          triggerRunId: ctx.run.id,
          variantTag: tag.variantTag,
          concept: tag.concept,
          hookId: tag.hookId,
          variantId: tag.variantId,
        },
      })) as Id<"posts">;

      let higgsCreditsUsed = 0;
      let motionScoreSum = 0;
      let motionScoreCount = 0;
      const dir = await mkdtemp(path.join(tmpdir(), "ad-"));

      const renderScene = async (scene: Scene, index: number): Promise<string> => {
        const duration = scene.seconds ?? 0;
        logger.log(`scene ${index + 1}/${scenes.length} (${scene.kind ?? "i2v"})`);
        if (scene.kind === "card") {
          const norm = path.join(dir, `norm-${index}.mp4`);
          await makeCard(FFMPEG, norm, scene.cardTitle ?? execution?.project.title ?? "", scene.cardSub, duration);
          await putObject(`creative/${postId}/scene-${index + 1}.mp4`, await readFile(norm), "video/mp4");
          return norm;
        }

        if (!scene.imageKey) throw new Error(`scene ${index + 1}: approved reference image is required`);
        const source = await fetch(await presignedGet(scene.imageKey, 60 * 60));
        if (!source.ok) throw new Error(`scene ${index + 1}: reference image HTTP ${source.status}`);
        const firstBytes = Buffer.from(await source.arrayBuffer());
        const sourceType = source.headers.get("content-type")?.split(";", 1)[0] ?? "image/png";
        const firstContentType = sourceType.startsWith("image/") ? sourceType : "image/png";
        const firstKey = `creative/${postId}/scene-${index + 1}-a.png`;
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
        if (score < 45) throw new Error(`scene ${index + 1} failed the Seedance motion quality gate`);

        await putObject(`creative/${postId}/scene-${index + 1}.mp4`, await readFile(norm), "video/mp4");
        return norm;
      };

      const scenePaths: string[] = [];
      for (let index = 0; index < scenes.length; index++) {
        scenePaths.push(await renderScene(scenes[index], index));
      }

      const listFile = path.join(dir, "list.txt");
      await writeFile(listFile, scenePaths.map((scenePath) => `file '${scenePath}'`).join("\n"));
      const silent = path.join(dir, "cut.mp4");
      await exec(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

      const final = path.join(dir, "final.mp4");
      await exec(FFMPEG, ["-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", final]);

      const r2Key = `creative/${postId}/ad.mp4`;
      await putObject(r2Key, await readFile(final), "video/mp4");
      const url = await presignedGet(r2Key);
      await convex.action(api.creativeGateway.completeRender, {
        serviceToken: renderServiceToken,
        payload: {
          jobId: execution.job.id,
          triggerRunId: ctx.run.id,
          postId,
          creditsUsed: higgsCreditsUsed,
          slides: [{ r2Key, url, prompt: execution.project.title, role: "video" }],
          qcScore: motionScoreCount > 0 ? Math.round(motionScoreSum / motionScoreCount) : undefined,
        },
      });
      logger.log("ad ready", { postId, url, variantTag: tag.variantTag, higgsCreditsUsed });
      return { postId, url, variantTag: tag.variantTag, estimatePence: 0, higgsCreditsUsed };
    } catch (err) {
      await failRenderLifecycle(err);
      throw err;
    }
  },
});
