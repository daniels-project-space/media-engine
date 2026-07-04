import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { IntakeForm } from "@/components/intake-form";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

export const revalidate = 300; // ISR

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const convex = new ConvexHttpClient(CONVEX_URL);
const media = (key?: string) => (key ? `/api/media/${key}` : undefined);

export async function generateStaticParams() {
  try {
    const services = await convex.query(api.services.list, {});
    return services.map((s) => ({ slug: s.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await convex.query(api.services.getBySlug, { slug });
  if (!s) return { title: "Not found" };
  return { title: s.seoTitle, description: s.seoDescription, openGraph: { title: s.seoTitle, description: s.seoDescription } };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await convex.query(api.services.getBySlug, { slug });
  if (!s || !s.active) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.seoDescription,
    offers: s.pricingTiers.map((t) => ({ "@type": "Offer", name: t.name, price: t.price.replace(/[£$]/, ""), priceCurrency: "GBP" })),
  };

  return (
    <div className="min-h-screen bg-void text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* nav */}
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/services" className="flex items-center gap-2">
          <span className="size-7 bg-signal text-void display font-extrabold grid place-items-center text-xs">ME</span>
          <span className="display font-bold tracking-tight text-sm">MEDIA ENGINE</span>
        </Link>
        <a href="#start" className="bg-signal text-void display font-bold px-4 py-2 text-xs rounded-sm hover:brightness-110 transition">GET A FREE SAMPLE</a>
      </header>

      {/* hero */}
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="text-signal text-[11px] tracking-[0.3em] mb-4 uppercase">{s.tagline}</div>
          <h1 className="display font-extrabold text-4xl sm:text-5xl leading-[1.05] tracking-tight mb-5">{s.heroHeadline}</h1>
          <p className="text-ink-dim text-base leading-relaxed mb-6 max-w-lg">{s.heroSubhead}</p>
          <div className="flex flex-wrap gap-2 mb-7">
            {s.proofPoints.map((p) => (
              <span key={p} className="text-[11px] tracking-wide border border-line-2 text-ink-dim px-3 py-1.5 rounded-full">{p}</span>
            ))}
          </div>
          <a href="#start" className="inline-block bg-signal text-void display font-bold px-7 py-4 text-sm rounded-sm hover:brightness-110 transition">GET A FREE SAMPLE →</a>
        </div>
        <div className="relative">
          {media(s.heroClipKey) ? (
            <video src={media(s.heroClipKey)} autoPlay muted loop playsInline className="w-full rounded-md border border-line-2 aspect-[9/16] max-h-[560px] object-cover mx-auto shadow-2xl" />
          ) : (
            <div className="aspect-[9/16] max-h-[560px] bg-panel border border-line-2 rounded-md" />
          )}
        </div>
      </section>

      {/* how it works */}
      <section className="max-w-6xl mx-auto px-6 py-14 border-t border-line">
        <h2 className="display font-bold text-2xl mb-8">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {s.howItWorks.map((step, i) => (
            <div key={i}>
              <div className="text-signal display font-extrabold text-3xl mb-2">{String(i + 1).padStart(2, "0")}</div>
              <div className="font-bold mb-1">{step.title}</div>
              <p className="text-ink-dim text-sm leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* gallery */}
      <section className="max-w-6xl mx-auto px-6 py-14 border-t border-line">
        <h2 className="display font-bold text-2xl mb-2">Recent work</h2>
        <p className="text-ink-dim text-sm mb-8">Real output from the engine — press play.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {s.gallery.map((g, i) => (
            <div key={i}>
              {media(g.clipKey) ? (
                <video src={media(g.clipKey)} controls muted playsInline preload="metadata" className="w-full aspect-[9/16] object-cover rounded-sm border border-line-2 bg-panel" />
              ) : media(g.imageKey) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media(g.imageKey)} alt={g.label} className="w-full aspect-[9/16] object-cover rounded-sm border border-line-2" />
              ) : null}
              <div className="text-[11px] text-ink-faint mt-2">{g.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* value props */}
      <section className="max-w-6xl mx-auto px-6 py-14 border-t border-line">
        <div className="grid sm:grid-cols-3 gap-8">
          {s.valueProps.map((vp, i) => (
            <div key={i}>
              <div className="h-0.5 w-10 bg-signal mb-4" />
              <div className="font-bold text-lg mb-2">{vp.header}</div>
              <p className="text-ink-dim text-sm leading-relaxed">{vp.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* pricing */}
      <section className="max-w-6xl mx-auto px-6 py-14 border-t border-line">
        <h2 className="display font-bold text-2xl mb-8">Pricing</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {s.pricingTiers.map((t) => (
            <div key={t.name} className={`border p-6 rounded-md relative ${t.popular ? "border-signal bg-signal/5" : "border-line-2 bg-panel"}`}>
              {t.popular && <div className="absolute -top-2.5 left-6 bg-signal text-void text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-sm">MOST POPULAR</div>}
              <div className="text-[11px] tracking-widest text-ink-faint uppercase mb-2">{t.name}</div>
              <div className="display font-extrabold text-4xl mb-1">{t.price}<span className="text-ink-faint text-sm font-normal ml-1">{t.unit}</span></div>
              <ul className="mt-5 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="text-sm text-ink-dim flex gap-2"><span className="text-signal">✓</span>{f}</li>
                ))}
              </ul>
              <a href="#start" className={`block text-center mt-6 py-3 text-xs display font-bold rounded-sm transition ${t.popular ? "bg-signal text-void hover:brightness-110" : "border border-line-2 hover:border-signal"}`}>CHOOSE {t.name.toUpperCase()}</a>
            </div>
          ))}
        </div>
      </section>

      {/* faq */}
      <section className="max-w-3xl mx-auto px-6 py-14 border-t border-line">
        <h2 className="display font-bold text-2xl mb-8">FAQ</h2>
        <div className="space-y-5">
          {s.faq.map((f, i) => (
            <div key={i}>
              <div className="font-bold mb-1">{f.q}</div>
              <p className="text-ink-dim text-sm leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* intake */}
      <section id="start" className="max-w-2xl mx-auto px-6 py-16 border-t border-line">
        <h2 className="display font-extrabold text-3xl mb-2 text-center">Get a free sample</h2>
        <p className="text-ink-dim text-sm mb-8 text-center">Tell us about your product — we&apos;ll send a free concept and a quote, fast.</p>
        <IntakeForm service={s.slug} cta="GET MY FREE SAMPLE" />
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-10 border-t border-line text-center text-ink-faint text-xs">
        <Link href="/services" className="hover:text-ink">Media Engine</Link> · AI creative studio · directed, not just generated
      </footer>
    </div>
  );
}
