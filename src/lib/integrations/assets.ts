import { vaultTry } from "./gate";
import { putObject } from "../storage";

// Brand-asset puller — "understand the app I'm talking about" without rendering.
// Microlink turns a product URL into a screenshot + OG image + logo + palette +
// description. These are REFERENCE stills we can hand to influencers / drop into
// funnels — pulled, never generated. Reads are always allowed (no live gate).

export type BrandPull = {
  url: string;
  title?: string;
  description?: string;
  publisher?: string;
  lang?: string;
  imageUrl?: string; // best OG/hero image
  logoUrl?: string;
  screenshotUrl?: string;
  colors?: string[];
  /** R2 keys of anything we mirrored into our own bucket */
  savedKeys: string[];
};

const MICROLINK = "https://api.microlink.io";

/** Pull brand/reference material for a product URL. Optionally mirror stills to R2. */
export async function pullBrand(url: string, opts?: { mirror?: boolean }): Promise<BrandPull> {
  const { MICROLINK_API_KEY } = await vaultTry("microlink");
  const qs = new URLSearchParams({
    url,
    screenshot: "true",
    meta: "true",
    palette: "true",
  });
  const headers: Record<string, string> = {};
  if (MICROLINK_API_KEY) headers["x-api-key"] = MICROLINK_API_KEY;

  const out: BrandPull = { url, savedKeys: [] };
  try {
    const r = await fetch(`${MICROLINK}/?${qs}`, { headers, cache: "no-store" });
    const j = (await r.json()) as {
      status?: string;
      data?: {
        title?: string;
        description?: string;
        publisher?: string;
        lang?: string;
        image?: { url?: string; palette?: string[] };
        logo?: { url?: string };
        screenshot?: { url?: string };
      };
    };
    const d = j.data ?? {};
    out.title = d.title;
    out.description = d.description;
    out.publisher = d.publisher;
    out.lang = d.lang;
    out.imageUrl = d.image?.url;
    out.logoUrl = d.logo?.url;
    out.screenshotUrl = d.screenshot?.url;
    out.colors = d.image?.palette;
  } catch (e) {
    out.description = `microlink pull failed: ${e instanceof Error ? e.message : String(e)}`;
    return out;
  }

  if (opts?.mirror) {
    const host = safeHost(url);
    for (const [label, srcUrl] of [
      ["hero", out.imageUrl],
      ["shot", out.screenshotUrl],
      ["logo", out.logoUrl],
    ] as const) {
      if (!srcUrl) continue;
      try {
        const res = await fetch(srcUrl);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (res.headers.get("content-type") ?? "image/png").split("/")[1]?.split(";")[0] ?? "png";
        const key = `ref/${host}/${label}-${buf.length}.${ext}`;
        await putObject(key, buf, res.headers.get("content-type") ?? "image/png");
        out.savedKeys.push(key);
      } catch {
        /* best effort — a missing still never blocks understanding */
      }
    }
  }
  return out;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_");
  } catch {
    return "unknown";
  }
}
