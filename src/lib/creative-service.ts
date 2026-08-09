import { vaultService } from "@/lib/vault";

/**
 * Credential used exclusively for server/Trigger -> Convex creative gateway
 * calls. It is intentionally never sent to the browser. Environment first
 * keeps local development simple; production can keep it in the existing vault.
 */
export async function creativeServiceToken(): Promise<string> {
  const direct = process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
  if (direct && direct.length >= 32) return direct;

  const vault = await vaultService("media-engine").catch(() => ({} as Record<string, string>));
  const token = vault.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
  if (!token || token.length < 32) {
    throw new Error(
      "MEDIA_ENGINE_CONVEX_SERVICE_TOKEN is not configured; creative work is deliberately disabled until the server and Convex share it",
    );
  }
  return token;
}
