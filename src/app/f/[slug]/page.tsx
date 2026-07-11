import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { mediaUrl } from "@/lib/media";
import FunnelCapture from "./capture";

// DB-driven funnel landing page. Rendered straight from a `funnels` row — no page
// is generated as an asset. ISR so it's fast + SEO-indexable, mirroring the
// services landing pages.
export const revalidate = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

async function getFunnel(slug: string) {
  try {
    return await new ConvexHttpClient(CONVEX_URL).query(api.funnels.getBySlug, { slug });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = await getFunnel(slug);
  if (!f) return { title: "Not found" };
  return {
    title: `${f.headline} — ${f.productName}`,
    description: f.subhead ?? f.headline,
    openGraph: {
      title: f.headline,
      description: f.subhead ?? f.headline,
      images: f.heroImageKey ? [mediaUrl(f.heroImageKey)] : undefined,
    },
  };
}

export default async function FunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = await getFunnel(slug);

  if (!f) {
    return (
      <main className="min-h-screen grid place-items-center bg-void text-ink">
        <div className="text-center">
          <div className="display font-extrabold text-2xl">Funnel not found</div>
          <div className="text-ink-faint text-xs mt-2 tracking-widest">{slug}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-void text-ink">
      {!f.published && (
        <div className="bg-amber-400/10 border-b border-amber-400/30 text-amber-400 text-[11px] tracking-[0.25em] text-center py-2">
          PREVIEW — NOT YET PUBLISHED
        </div>
      )}
      <div className="max-w-3xl mx-auto px-6 py-16 md:py-24">
        {f.heroImageKey && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(f.heroImageKey)} alt={f.productName} className="w-full max-h-72 object-cover border border-line mb-10" />
        )}
        <div className="text-xs tracking-[0.3em] text-signal mb-4">{f.productName.toUpperCase()}</div>
        <h1 className="display font-extrabold text-4xl md:text-6xl tracking-tight leading-[1.05]">{f.headline}</h1>
        {f.subhead && <p className="text-ink-dim text-lg mt-5 max-w-2xl">{f.subhead}</p>}

        {f.discountCode && (
          <div className="mt-6 inline-flex items-center gap-3 border border-signal px-4 py-2">
            <span className="text-signal display font-extrabold tracking-widest">{f.discountCode}</span>
            <span className="text-ink-dim text-xs">{f.discountBlurb ?? "launch offer"}</span>
          </div>
        )}

        <FunnelCapture slug={f.slug} ctaText={f.ctaText} ctaUrl={f.ctaUrl} />

        {f.valueProps.length > 0 && (
          <div className="grid md:grid-cols-3 gap-4 mt-16">
            {f.valueProps.map((v, i) => (
              <div key={i} className="border border-line bg-panel p-5">
                <div className="display font-bold text-base">{v.header}</div>
                <div className="text-ink-dim text-sm mt-2">{v.body}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-20 text-[10px] text-ink-faint tracking-widest">POWERED BY MEDIA ENGINE</div>
      </div>
    </main>
  );
}
