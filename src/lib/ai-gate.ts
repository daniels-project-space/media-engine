import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

// This must be the same deployment queried by /api/health and Trigger tasks.
// A public build-time override can otherwise make the safety gate read a
// different project's enabled flag than the Media Engine state it protects.
export const MEDIA_ENGINE_CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// Global generation kill switch. This is intentionally fail-closed: a missing
// setting, malformed value, or Convex read failure must never permit a provider
// request that could consume credits.
export async function aiEnabled(): Promise<boolean> {
  // This local, fail-closed override is used by the deployed safety switch and
  // lets a disabled route return before it contacts Convex, vault, Trigger, or
  // any provider. It never enables work; it can only keep billing paused.
  if (process.env.MEDIA_ENGINE_BILLING_DISABLED === "1") return false;
  try {
    return (await new ConvexHttpClient(MEDIA_ENGINE_CONVEX_URL).query(api.settings.aiEnabled, {})) === true;
  } catch {
    return false;
  }
}
