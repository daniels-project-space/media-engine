import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { isLive, vaultTry, simulated, blocked, live, type GateResult } from "./gate";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Swappable social-posting adapter. One interface, three backends:
//   - ayrshare : hosted, one API key, ~13 platforms (default — least infra)
//   - postiz   : OSS self-host (base URL + token), 30+ platforms, MCP-native
//   - graph    : the existing native Instagram Graph path (publish-post task)
// The backend is chosen by the `socialProvider` setting. Posting is a real
// outward side-effect, so it is DRY-RUN unless isLive() AND the backend key exist.

export type PublishInput = {
  platform: string; // instagram | x | facebook | tiktok | linkedin | reddit | ...
  caption: string;
  mediaUrls?: string[];
  when?: number; // epoch ms; omitted = post now
  postId?: string;
};
export type PublishResult = { provider: string; externalId?: string; scheduled?: boolean };

async function currentProvider(): Promise<string> {
  try {
    const s = (await new ConvexHttpClient(CONVEX_URL).query(api.settings.all, {})) as Record<string, unknown>;
    return (s.socialProvider as string) ?? "ayrshare";
  } catch {
    return "ayrshare";
  }
}

export async function publish(input: PublishInput): Promise<GateResult<PublishResult>> {
  const provider = await currentProvider();
  const doing = `post to ${input.platform} via ${provider}${input.when ? ` (scheduled ${new Date(input.when).toISOString()})` : ""}`;

  if (!(await isLive())) return simulated(doing, { provider });

  if (provider === "ayrshare") return ayrshare(input);
  if (provider === "postiz") return postiz(input);
  if (provider === "graph") {
    return blocked(
      `graph provider: Instagram posting runs through the publish-post Trigger task, not this adapter — enqueue a post instead`,
    );
  }
  return blocked(`unknown socialProvider "${provider}"`);
}

async function ayrshare(input: PublishInput): Promise<GateResult<PublishResult>> {
  const { AYRSHARE_API_KEY } = await vaultTry("ayrshare");
  if (!AYRSHARE_API_KEY) return blocked("no Ayrshare key in vault (service 'ayrshare' / AYRSHARE_API_KEY)");
  try {
    const body: Record<string, unknown> = {
      post: input.caption,
      platforms: [mapPlatform(input.platform, "ayrshare")],
    };
    if (input.mediaUrls?.length) body.mediaUrls = input.mediaUrls;
    if (input.when) body.scheduleDate = new Date(input.when).toISOString();
    const r = await fetch("https://api.ayrshare.com/api/post", {
      method: "POST",
      headers: { authorization: `Bearer ${AYRSHARE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { id?: string; status?: string; errors?: unknown };
    if (!r.ok || j.status === "error") return blocked(`ayrshare: ${JSON.stringify(j).slice(0, 200)}`);
    return live(`posted to ${input.platform} via ayrshare`, { provider: "ayrshare", externalId: j.id, scheduled: Boolean(input.when) });
  } catch (e) {
    return blocked(`ayrshare error: ${e instanceof Error ? e.message : e}`);
  }
}

async function postiz(input: PublishInput): Promise<GateResult<PublishResult>> {
  const s = await vaultTry("postiz");
  const base = s.POSTIZ_URL, token = s.POSTIZ_API_KEY;
  if (!base || !token) return blocked("no Postiz config in vault (POSTIZ_URL + POSTIZ_API_KEY)");
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/public/v1/posts`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({
        type: input.when ? "scheduled" : "now",
        date: input.when ? new Date(input.when).toISOString() : undefined,
        content: input.caption,
        media: input.mediaUrls ?? [],
        platforms: [mapPlatform(input.platform, "postiz")],
      }),
    });
    const j = (await r.json()) as { id?: string; postId?: string };
    if (!r.ok) return blocked(`postiz: ${JSON.stringify(j).slice(0, 200)}`);
    return live(`posted to ${input.platform} via postiz`, { provider: "postiz", externalId: j.id ?? j.postId, scheduled: Boolean(input.when) });
  } catch (e) {
    return blocked(`postiz error: ${e instanceof Error ? e.message : e}`);
  }
}

function mapPlatform(p: string, provider: string): string {
  const key = p.toLowerCase();
  const common: Record<string, string> = { x: "twitter", "twitter/x": "twitter" };
  const mapped = common[key] ?? key;
  if (provider === "ayrshare") return mapped; // ayrshare uses 'twitter','instagram',...
  return mapped;
}

/** Platforms the current provider can reach (advisory, for planning UIs). */
export async function supportedPlatforms(): Promise<string[]> {
  const provider = await currentProvider();
  if (provider === "postiz")
    return ["instagram", "twitter", "facebook", "tiktok", "linkedin", "youtube", "threads", "pinterest", "reddit", "bluesky", "mastodon"];
  if (provider === "graph") return ["instagram"];
  return ["instagram", "twitter", "facebook", "tiktok", "linkedin", "youtube", "threads", "pinterest", "reddit", "telegram", "bluesky"];
}
