import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const convex = new ConvexHttpClient(CONVEX_URL);
const media = (key?: string) => (key ? `/api/media/${key}` : undefined);

export const metadata: Metadata = {
  title: "AI Creative Studio — UGC Ads, Product Video, Faceless Content | Media Engine",
  description: "AI video ads, product content and faceless channels — directed by a human, accelerated by AI. Accurate, fast, and built to convert.",
};

export default async function Services() {
  const services = await convex.query(api.services.list, {}).catch(() => []);
  const active = services.filter((s) => s.active);

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="size-7 bg-signal text-void display font-extrabold grid place-items-center text-xs">ME</span>
          <span className="display font-bold tracking-tight text-sm">MEDIA ENGINE</span>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="text-signal text-[11px] tracking-[0.3em] mb-4 uppercase">AI Creative Studio</div>
        <h1 className="display font-extrabold text-4xl sm:text-6xl leading-[1.03] tracking-tight mb-5">Directed, not just generated.</h1>
        <p className="text-ink-dim text-lg max-w-xl mx-auto leading-relaxed">AI video ads, product content and faceless channels — human creative direction, AI speed. Accurate to your brand, fast, and built to convert.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20 grid md:grid-cols-3 gap-5">
        {active.map((s) => (
          <Link key={s.slug} href={`/services/${s.slug}`} className="group border border-line-2 bg-panel rounded-md overflow-hidden hover:border-signal transition">
            {media(s.heroClipKey) && (
              <video src={media(s.heroClipKey)} muted loop playsInline autoPlay className="w-full aspect-video object-cover" />
            )}
            <div className="p-5">
              <div className="font-bold text-lg mb-1 group-hover:text-signal transition">{s.name}</div>
              <p className="text-ink-dim text-sm leading-relaxed mb-4">{s.tagline}</p>
              <div className="text-signal text-xs display font-bold tracking-widest">VIEW & GET A SAMPLE →</div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
