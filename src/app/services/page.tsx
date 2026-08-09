import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const convex = new ConvexHttpClient(CONVEX_URL);
const media = (key?: string) => (key ? `/api/media/${key}` : undefined);

const capabilityPillars = ["Original", "Multi-format", "Motion-first"];
const formatStatements = [
  { number: "01", title: "Proof, in motion.", detail: "Built to earn the pause." },
  { number: "02", title: "Three worlds. In motion.", detail: "UGC, product, and channel-native stories." },
  { number: "03", title: "Made for the full frame.", detail: "Every crop is composed, never clipped." },
];

export const metadata: Metadata = {
  title: "AI Creative Studio — UGC Ads, Product Video, Faceless Content | Media Engine",
  description: "AI video ads, product content and faceless channels — directed by a human, accelerated by AI. Accurate, fast, and built to convert.",
};

export default async function Services() {
  const services = await convex.query(api.services.list, {}).catch(() => []);
  const active = services.filter((s) => s.active);

  return (
    <div className="min-h-screen bg-void text-ink services-page">
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="size-7 bg-signal text-void display font-extrabold grid place-items-center text-xs">ME</span>
          <span className="display font-bold tracking-tight text-sm">MEDIA ENGINE</span>
        </div>
        <a href="#formats" className="text-[10px] tracking-[0.16em] uppercase text-ink-dim hover:text-signal transition-colors">Explore formats</a>
      </header>

      <section className="services-hero max-w-6xl mx-auto px-6 pt-12 pb-8 sm:pt-20 sm:pb-12">
        <div className="services-hero-copy">
          <div className="text-signal text-[11px] tracking-[0.3em] mb-4 uppercase">AI Creative Studio</div>
          <h1 className="display font-extrabold text-4xl sm:text-6xl lg:text-7xl leading-[0.96] tracking-tight">Directed, not just generated.</h1>
          <p className="text-ink-dim text-base sm:text-lg max-w-xl leading-relaxed">Human creative direction. AI production speed. Built to land in the feed.</p>
        </div>
        <div className="service-orbit" aria-hidden="true">
          <span className="service-orbit-core" />
          <span className="service-orbit-dot service-orbit-dot-a" />
          <span className="service-orbit-dot service-orbit-dot-b" />
          <span className="service-orbit-dot service-orbit-dot-c" />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-10">
        <div className="capability-pillar-row" aria-label="Creative capability pillars">
          {capabilityPillars.map((pillar, index) => (
            <div key={pillar} className="capability-pillar">
              <span className="text-signal text-[10px] tracking-[0.18em]">0{index + 1}</span>
              <span>{pillar}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="format-statements" aria-label="Creative principles">
          {formatStatements.map((statement) => (
            <article key={statement.number} className="format-statement">
              <span className="format-statement-number">{statement.number}</span>
              <div>
                <h2 className="display font-bold text-2xl sm:text-3xl tracking-tight">{statement.title}</h2>
                <p>{statement.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="formats" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
          <div>
            <div className="text-signal text-[10px] tracking-[0.22em] uppercase mb-2">Explore service formats</div>
            <h2 className="display font-bold text-3xl sm:text-4xl tracking-tight">Choose the story shape.</h2>
          </div>
          <p className="text-ink-faint text-xs max-w-xs sm:text-right">Full-frame examples, formatted for where they live.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
        {active.map((s) => (
          <Link key={s.slug} href={`/services/${s.slug}`} className="service-format-card group">
            <div className="service-format-video">
              {media(s.heroClipKey) && (
                <video src={media(s.heroClipKey)} muted loop playsInline autoPlay preload="metadata" className="service-format-video-media" aria-label={`${s.name} example`}>
                  Your browser does not support video playback.
                </video>
              )}
              <span className="service-format-frame" aria-hidden="true" />
            </div>
            <div className="p-5 sm:p-6">
              <div className="font-bold text-lg mb-1 group-hover:text-signal transition-colors">{s.name}</div>
              <p className="text-ink-dim text-sm leading-relaxed mb-5">{s.tagline}</p>
              <div className="text-signal text-[11px] display font-bold tracking-widest">VIEW FORMAT <span aria-hidden="true">↗</span></div>
            </div>
          </Link>
        ))}
        </div>
      </section>
    </div>
  );
}
