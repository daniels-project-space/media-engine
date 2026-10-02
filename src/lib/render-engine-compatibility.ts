/**
 * Current Render Engine project API contract (render-engine-rebuild/convex/http.ts).
 * Keep this explicit so a deployment cannot silently turn an approved client
 * reference image into an unrelated text-to-video render.
 */
export const RENDER_ENGINE_PROJECT_VIDEO = {
  path: "/client/hosted-generations",
  profileId: "seedance-2.5-i2v",
  mode: "first-frame-image-to-video",
  acceptsReferenceImage: true,
  durationSeconds: "4-15",
} as const;

export const RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE =
  "Render Engine project I2V is unavailable without an exact HTTPS project API origin; no render was admitted.";

/** Called at both public admission and worker execution boundaries. */
export function assertRenderEngineCanRenderApprovedAd(): void {
  const raw = process.env.RENDER_ENGINE_PROJECT_API_URL?.trim();
  try {
    const url = raw ? new URL(raw) : null;
    if (url?.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password) return;
  } catch { /* malformed origin fails closed */ }
  throw new Error(RENDER_ENGINE_AD_INCOMPATIBLE_MESSAGE);
}
