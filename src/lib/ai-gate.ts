import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Global generation kill switch. This is intentionally fail-closed: a missing
// setting, malformed value, or Convex read failure must never permit a provider
// request that could consume credits.
export async function aiEnabled(): Promise<boolean> {
  try {
    return (await new ConvexHttpClient(CONVEX_URL).query(api.settings.aiEnabled, {})) === true;
  } catch {
    return false;
  }
}
