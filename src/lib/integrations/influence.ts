import { vaultTry } from "./gate";

// Influencer discovery adapter (Modash). Read-only research, so no live gate —
// but discovery genuinely needs a key (Modash is sales-gated, no free self-serve
// in 2026). Returns configured:false with an empty list when the key is absent,
// so the orchestrator degrades gracefully to "brief ready, sourcing pending".

export type Creator = {
  handle: string;
  platform: string;
  followers?: number;
  engagementRate?: number;
  email?: string;
  url?: string;
};
export type DiscoverResult = { source: string; configured: boolean; data: Creator[]; note?: string };

/** Find creators in a niche on a platform. Best-effort against Modash's discovery API. */
export async function discover(
  niche: string,
  platform = "instagram",
  opts?: { minFollowers?: number; maxFollowers?: number; limit?: number },
): Promise<DiscoverResult> {
  const { MODASH_API_KEY } = await vaultTry("modash");
  if (!MODASH_API_KEY) {
    return { source: "none", configured: false, data: [], note: "no Modash key in vault (service 'modash' / MODASH_API_KEY) — influencer sourcing pending" };
  }
  try {
    const r = await fetch(`https://api.modash.io/v1/${platform}/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${MODASH_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        page: 0,
        limit: opts?.limit ?? 15,
        filter: {
          influencer: {
            followers: { min: opts?.minFollowers ?? 10_000, max: opts?.maxFollowers ?? 200_000 },
            relevance: [`#${niche.replace(/\s+/g, "")}`],
          },
        },
      }),
    });
    const j = (await r.json()) as {
      lookalikes?: { userId?: string; profile?: { username?: string; followers?: number; engagementRate?: number; url?: string } }[];
      error?: boolean; message?: string;
    };
    if (j.error) return { source: "modash", configured: true, data: [], note: j.message ?? "modash error" };
    const data = (j.lookalikes ?? []).map((l) => ({
      handle: l.profile?.username ?? l.userId ?? "unknown",
      platform,
      followers: l.profile?.followers,
      engagementRate: l.profile?.engagementRate,
      url: l.profile?.url,
    }));
    return { source: "modash", configured: true, data };
  } catch (e) {
    return { source: "modash", configured: true, data: [], note: `modash error: ${e instanceof Error ? e.message : e}` };
  }
}
