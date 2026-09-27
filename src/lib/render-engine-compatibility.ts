/**
 * Current Render Engine project API contract (render-engine-rebuild/convex/http.ts).
 * Keep this explicit so a deployment cannot silently turn an approved client
 * reference image into an unrelated text-to-video render.
 */
export const RENDER_ENGINE_PROJECT_VIDEO = {
  path: "/client/h3-jobs",
  profileId: "minimax-h3",
  mode: "text-to-video",
  acceptsReferenceImage: false,
  durationSeconds: 5,
} as const;

export const RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE =
  "Render Engine project API currently accepts only five-second MiniMax H3 text-to-video prompts; approved Media Engine ads require the client's reference image, Seedance 2.0, and 4–15 second image-to-video clips. No render was submitted.";

/** Called at both public admission and worker execution boundaries. */
export function assertRenderEngineCanRenderApprovedAd(): void {
  throw new Error(RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE);
}
