import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Global OpenRouter (LLM) kill switch. Reads the `aiEnabled` settings flag. Every
// OpenRouter call site checks this first so all LLM spend can be paused in one place.
// Fails OPEN on a read error (a transient Convex blip shouldn't disable AI when it's
// meant to be on — the stored flag is the reliable control).
export async function aiEnabled(): Promise<boolean> {
  try {
    return await new ConvexHttpClient(CONVEX_URL).query(api.settings.aiEnabled, {});
  } catch {
    return true;
  }
}
