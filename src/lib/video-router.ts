import { logger } from "@trigger.dev/sdk/v3";
import { higgsBalance, higgsGenerateVideo } from "./higgsfield";

/** The single approved image-to-video model for this workspace. */
export const CANONICAL_VIDEO_MODEL = "seedance-2" as const;
export type VideoModel = typeof CANONICAL_VIDEO_MODEL;

// Call once before a batch to validate the persisted subscription session. The
// auth helper refreshes only after a rejected access token; eagerly rotating a
// single-use refresh token here would make concurrent Trigger runs race.
export async function primeHiggsfield(): Promise<void> {
  await higgsBalance();
}

/**
 * Render a client-approved image with the linked Higgsfield subscription only.
 * There is deliberately no API-key or provider fallback in this module: a failed
 * preflight or render must surface to the operator instead of spending elsewhere.
 */
export async function renderClip(opts: {
  model: VideoModel;
  /** Retained as a caller-facing reference only; Higgsfield receives imageBytes. */
  imageUrl?: string;
  imageBytes: Buffer;
  imageContentType?: string;
  motion: string;
  durationSeconds?: number;
  aspectRatio?: string;
  /** Compatibility marker for existing internal callers; all renders are subscription-only. */
  subscriptionOnly?: true;
}): Promise<{ url: string; provider: "higgsfield"; costPence: 0; credits: number }> {
  if (opts.model !== CANONICAL_VIDEO_MODEL) {
    throw new Error(`Only ${CANONICAL_VIDEO_MODEL} is permitted for client rendering`);
  }

  const duration = opts.durationSeconds ?? 5;
  if (!Number.isFinite(duration) || duration < 4) {
    throw new Error(`Seedance 2.0 requires a finite clip duration of at least 4 seconds; received ${duration}`);
  }

  const availableCredits = await higgsBalance();
  if (availableCredits <= 0) {
    throw new Error("Higgsfield subscription credits are unavailable");
  }

  const { url, credits } = await higgsGenerateVideo({
    jobSetType: "seedance_2_0",
    prompt: opts.motion,
    imageBytes: opts.imageBytes,
    imageContentType: opts.imageContentType,
    durationSeconds: duration,
    aspectRatio: opts.aspectRatio ?? "9:16",
    availableCredits,
    requireCreditQuote: true,
  });
  logger.log(`clip via Higgsfield Seedance 2.0: ${credits} credits (${availableCredits} available before render)`);
  return { url, provider: "higgsfield", costPence: 0, credits };
}
