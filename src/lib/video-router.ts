import { logger } from "@trigger.dev/sdk/v3";
import { vaultService } from "./vault";
import { higgsBalance, higgsGenerateVideo, higgsEnsureFresh } from "./higgsfield";

// Call ONCE before a batch of concurrent renderClip() calls so the parallel
// scenes share a single token refresh instead of each racing to refresh.
export async function primeHiggsfield(): Promise<void> {
  await higgsEnsureFresh().catch(() => {});
}

// Friendly model name -> Higgsfield job_set_type (credits) + fal fallback id (pence).
// Higgsfield is tried FIRST whenever the account has credits; fal is the fallback.
// Timing measured 2026-07-04 on Higgsfield (credits · render time):
//   kling3_0 10cr/41s ✓  · kling3_0_turbo 7.5cr/172s (slow) · seedance1_5 4.8cr/68s ✓
//   veo3_1_lite 6cr/417s+ (too slow → hfSkip, go straight to fal)
// hfDuration must match each model's schema enum or the job 422s:
//   kling3_0: min 3 · kling2_6: [5,10] · seedance1_5: [4,8,12] · seedance_2_0: min 4
export const VIDEO_MODELS: Record<
  string,
  {
    hf: string;
    hfDuration?: number;
    hfSkip?: boolean;
    fal: string;
    falPence: number;
    hfExtra?: Record<string, unknown>;
    falExtra?: Record<string, unknown>;
  }
> = {
  "kling-pro": { hf: "kling3_0", hfDuration: 5, fal: "fal-ai/kling-video/v2.6/pro/image-to-video", falPence: 30, hfExtra: { mode: "std" } },
  // "turbo" on HF is 4x slower than kling3_0 std — route it to the fast one.
  "kling-turbo": { hf: "kling3_0", hfDuration: 5, fal: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", falPence: 30, hfExtra: { mode: "std" } },
  "kling-26": { hf: "kling2_6", hfDuration: 5, fal: "fal-ai/kling-video/v2.6/pro/image-to-video", falPence: 30 },
  "seedance-lite": { hf: "seedance1_5", hfDuration: 4, fal: "fal-ai/bytedance/seedance/v1/lite/image-to-video", falPence: 16 },
  "seedance-pro": { hf: "seedance_2_0", hfDuration: 5, fal: "fal-ai/bytedance/seedance/v1/pro/image-to-video", falPence: 74 },
  // Seedance 2.0 at 4K — the premium CLIENT tier (Fiverr fulfilment). HF seedance_2_0
  // first (4k mode), fal bytedance/seedance-2.0 fallback with resolution 4k.
  "seedance-4k": {
    hf: "seedance_2_0",
    hfDuration: 5,
    hfExtra: { resolution: "4k" },
    fal: "bytedance/seedance-2.0/image-to-video",
    falPence: 250,
    falExtra: { resolution: "4k" },
  },
  // HF veo renders in ~7min — too slow to block on; go straight to fal.
  "veo-lite": { hf: "veo3_1_lite", hfSkip: true, fal: "fal-ai/veo3.1/lite/image-to-video", falPence: 35 },
};

async function falImageToVideo(
  falKey: string,
  modelId: string,
  imageUrl: string,
  motion: string,
  durationSeconds: number,
  extra?: Record<string, unknown>,
): Promise<string> {
  const submit = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: { authorization: `Key ${falKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: motion, image_url: imageUrl, duration: String(durationSeconds), ...extra }),
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

  // 1) Higgsfield first — unless this model renders too slowly on HF (hfSkip) or
  //    the account is out of credits.
  try {
    const balance = m.hfSkip ? 0 : await higgsBalance();
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
  const url = await falImageToVideo(FAL_KEY, m.fal, opts.imageUrl, opts.motion, duration, m.falExtra);
  logger.log(`clip via fal (${m.fal}), ~${m.falPence}p`);
  return { url, provider: "fal", costPence: m.falPence, credits: 0 };
}
