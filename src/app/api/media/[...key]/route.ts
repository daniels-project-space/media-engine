import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { unstable_cache } from "next/cache";
import { api } from "../../../../../convex/_generated/api";
import { objectExists, presignedGet } from "@/lib/storage";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 15;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Only assets explicitly selected for an active public service may be served
// anonymously. Everything else under `posts/` remains private client work.
const publicServiceMediaKeys = unstable_cache(
  async () => {
    const services = await new ConvexHttpClient(CONVEX_URL).query(api.services.list, {});
    return services
      .filter((service) => service.active)
      .flatMap((service) => [service.heroClipKey, ...service.gallery.flatMap((item) => [item.clipKey, item.imageKey])])
      .filter((key): key is string => Boolean(key));
  },
  ["media-engine-public-service-media"],
  { revalidate: 300 },
);

// Stable media URL. Client work is private; only deliberate public service
// examples plus explicit demo/reference prefixes can become signed redirects.
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const objectKey = key.join("/");
  if (!objectKey || objectKey.includes("..") || objectKey.includes("\\")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const explicitPublic = ["demo/", "buildout/", "reference/"].some((prefix) => objectKey.startsWith(prefix));
  const publicServiceKey = objectKey.startsWith("posts/") && (await publicServiceMediaKeys().catch(() => [] as string[])).includes(objectKey);
  const privateKey = !explicitPublic && !publicServiceKey;
  if (privateKey) {
    const denied = requireOperator(req);
    if (denied) return denied;
  }
  // Creator renders are server-produced outputs. They remain operator-gated
  // above, but need the stable media proxy so a selected review candidate can
  // appear in the promotion desk without leaking a provider's temporary URL.
  const allowed = ["creative/", "posts/", "demo/", "buildout/", "reference/", "creator-renders/"];
  const engineImage = /^projects\/media-engine\/jobs\/hosted-[a-f0-9]{32}\/generation-[a-f0-9]{32}\/[a-f0-9]{64}\/generation\.(?:png|jpg|webp)$/.test(objectKey);
  if (!engineImage && !allowed.some((prefix) => objectKey.startsWith(prefix))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    if (!(await objectExists(objectKey))) return NextResponse.json({ error: "not found" }, { status: 404 });
    const url = await presignedGet(objectKey, 60 * 60); // 1h is plenty for a redirect
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
