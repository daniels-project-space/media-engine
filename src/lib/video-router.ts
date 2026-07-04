import { logger } from "@trigger.dev/sdk/v3";
import { vaultService } from "./vault";
import { higgsBalance, higgsGenerateVideo } from "./higgsfield";

// Friendly model name -> Higgsfield job_set_type (credits) + fal fallback id (pence).
// Higgsfield is tried FIRST whenever the account has credits; fal is the fallback.
export const VIDEO_MODELS: Record<
  string,
  { hf: string; hfDuration?: number; fal: string; falPence: number; hfExtra?: Record<string, unknown> }
> = {
  "kling-pro": { hf: "kling3_0", fal: "fal-ai/kling-video/v2.6/pro/image-to-video", falPence: 30, hfExtra: { mode: "std" } },
  "kling-turbo": { hf: "kling3_0_turbo", fal: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", falPence: 30 },
  "kling-26": { hf: "kling2_6", fal: "fal-ai/kling-video/v2.6/pro/image-to-video", falPence: 30 },
  "seedance-lite": { hf: "seedance1_5", fal: "fal-ai/bytedance/seedance/v1/lite/image-to-video", falPence: 16 },
  "seedance-pro": { hf: "seedance_2_0", fal: "fal-ai/bytedance/seedance/v1/pro/image-to-video", falPence: 74 },
  "veo-lite": { hf: "veo3_1_lite", fal: "fal-ai/veo3.1/lite/image-to-video", falPence: 35 },
};

async function falImageToVideo(
  falKey: string,
  modelId: string,
  imageUrl: string,
  motion: string,
  durationSeconds: number,
): Promise<string> {
  const submit = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: { authorization: `Key ${falKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: motion, image_url: imageUrl, duration: String(durationSeconds) }),
  });
  if (!submit.ok) throw new Error(`fal ${modelId} HTTP ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const sub = (await submit.json()) as { status_url: string; response_url: string };
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(sub.status_url, { headers: { authorization: `Key ${falKey}` } });
    if (!st.ok) continue;
    const sd = (await st.json()) as { status: string };
    if (sd.status === "COMPLETED") {
      const res = await fetch(sub.response_url, { headers: { authorization: `Key ${falKey}` } });
      const rd = (await res.json()) as { video?: { url?: string } };
      if (!rd.video?.url) throw new Error(`fal ${modelId}: no video url in result`);
      return rd.video.url;
    }
    if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error(`fal ${modelId} failed`);
  }
  throw new Error(`fal ${modelId} timed out`);
}

// Routes one image-to-video clip: Higgsfield credits first, fal fallback.
// Returns the result mp4 URL plus which provider ran and its cost, for the spend ledger.
export async function renderClip(opts: {
  model: keyof typeof VIDEO_MODELS;
  imageUrl: string;
  imageBytes: Buffer;
  motion: string;
  durationSeconds?: number;
  aspectRatio?: string;
}): Promise<{ url: string; provider: "higgsfield" | "fal"; costPence: number; credits: number }> {
  const m = VIDEO_MODELS[opts.model];
  const duration = opts.durationSeconds ?? 5;

  // 1) Higgsfield first — only if the account currently has credits.
  try {
    const balance = await higgsBalance();
    if (balance > 0) {
      const { url, credits } = await higgsGenerateVideo({
        jobSetType: m.hf,
        prompt: opts.motion,
        imageBytes: opts.imageBytes,
        durationSeconds: m.hfDuration ?? duration,
        aspectRatio: opts.aspectRatio ?? "9:16",
        extraParams: m.hfExtra,
      });
      logger.log(`clip via higgsfield (${m.hf}), ${credits} credits, ${balance} left`);
      return { url, provider: "higgsfield", costPence: 0, credits };
    }
    logger.warn(`higgsfield balance ${balance} — falling back to fal`);
  } catch (err) {
    logger.warn(`higgsfield failed (${String(err).slice(0, 120)}) — falling back to fal`);
  }

  // 2) fal fallback.
  const { FAL_KEY } = await vaultService("fal");
  if (!FAL_KEY) throw new Error("higgsfield unavailable and fal key missing");
  const url = await falImageToVideo(FAL_KEY, m.fal, opts.imageUrl, opts.motion, duration);
  logger.log(`clip via fal (${m.fal}), ~${m.falPence}p`);
  return { url, provider: "fal", costPence: m.falPence, credits: 0 };
}
