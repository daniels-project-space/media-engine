import { mutation } from "./_generated/server";

// Seeds the ad-agency knowledge base: marketing playbooks (how to market X, what
// to say, what works per category) + a model/LoRA registry derived from existing
// personas. Idempotent-ish: playbooks upsert by slug; models are only created for
// personas that don't already have a registry row. Reasoning/config only.

type PB = {
  slug: string;
  category:
    | "cold_email"
    | "fiverr_niche"
    | "branding"
    | "ig_influencer_funnel"
    | "app_launch"
    | "community"
    | "seo";
  title: string;
  channel?: string;
  description: string;
  structure: unknown;
  templates: { label: string; body: string }[];
  bestPractices: string[];
  kpis: string[];
  defaultBudgetSplit?: unknown;
};

const PLAYBOOKS: PB[] = [
  {
    slug: "cold-email-outbound",
    category: "cold_email",
    title: "Cold Email Outbound",
    channel: "email",
    description:
      "Permissionless B2B/creator outreach that leads with the prospect's problem, not your product. 3-touch sequence, one ask, plain-text feel.",
    structure: {
      sequence: [
        { day: 0, goal: "problem + proof, soft ask", lengthWords: 70 },
        { day: 3, goal: "reply-bump with a specific result / case", lengthWords: 45 },
        { day: 7, goal: "break-up + easy yes/no", lengthWords: 30 },
      ],
      deliverability: ["warm domain 2-3 wks", "<=50/day/inbox", "no images/links in email 1", "custom tracking domain"],
    },
    templates: [
      { label: "email 1 subject", body: "quick idea for {{company}}" },
      { label: "email 1 body", body: "Hi {{firstName}} — noticed {{observation}}. We help {{ICP}} {{outcome}} without {{pain}}. Worth a 10-min look? If not, no worries." },
      { label: "email 2 body", body: "Following up — {{caseStudy}}. Happy to send a 60-sec teardown of {{company}} if useful." },
      { label: "break-up", body: "Should I close the loop on this? A yes/no is totally fine." },
    ],
    bestPractices: [
      "One CTA per email; make the yes tiny.",
      "Personalise line 1 with a real observation (site, launch, post).",
      "Plain text, signature-light; looks 1:1 not blast.",
      "Segment lists tightly — relevance beats volume.",
    ],
    kpis: ["open %", "reply %", "positive-reply %", "meetings booked", "spam-complaint %"],
    defaultBudgetSplit: { tool: "smartlead", note: "cost is per-inbox, not per-send" },
  },
  {
    slug: "fiverr-niche-positioning",
    category: "fiverr_niche",
    title: "Fiverr Niche & Gig Positioning",
    channel: "fiverr",
    description:
      "Win a narrow niche on marketplaces: one sharp gig, benefit-led title, before/after proof, and packages that anchor to the middle tier.",
    structure: {
      gig: { titleFormula: "I will {{outcome}} for {{niche}} in {{turnaround}}", packages: ["Basic (hook)", "Standard (anchor, mark popular)", "Premium (whale)"] },
      firstReviews: "seed 3-5 reviews via cheap/express delivery before raising price",
      searchTags: "mirror exact buyer search terms in title + tags",
    },
    templates: [
      { label: "gig title", body: "I will create a scroll-stopping AI product ad for your {{niche}} brand" },
      { label: "first message", body: "Thanks for reaching out! To nail this in one pass: what's the product URL, the one feeling you want, and any must-have shots?" },
      { label: "delivery note", body: "Here's v1 — 1 free revision included. If it lands, a 5★ review really helps a small studio like mine 🙏" },
    ],
    bestPractices: [
      "Niche down until you're the obvious choice, then widen.",
      "Lead the gallery with a before/after — strongest converting format.",
      "Anchor pricing: make the middle package 'most popular'.",
      "Never auto-message buyers (ban risk) — draft, human sends.",
    ],
    kpis: ["impressions→clicks", "click→order %", "avg order value", "review rate", "repeat-buyer %"],
  },
  {
    slug: "brand-foundations",
    category: "branding",
    title: "Brand Foundations & Voice",
    description:
      "Fast brand spine before spend: positioning statement, 3 message pillars, tone, visual anchors. Everything downstream references this.",
    structure: {
      positioning: "For {{ICP}} who {{need}}, {{product}} is the {{category}} that {{benefit}}, unlike {{alt}}.",
      pillars: 3,
      voice: ["one adjective it IS", "one it is NOT"],
      visual: ["palette", "type feel", "reference stills"],
    },
    templates: [
      { label: "positioning", body: "For {{ICP}}, {{product}} is the {{category}} that {{benefit}} — unlike {{alt}} which {{gap}}." },
      { label: "tagline options", body: "3 options: benefit-led / emotional / category-defining" },
    ],
    bestPractices: ["Say one thing, memorably.", "Pull real reference stills from the product — don't invent a look.", "Consistency > cleverness across every touch."],
    kpis: ["message recall", "branded-search lift", "profile→follow %"],
  },
  {
    slug: "ig-influencer-funnel",
    category: "ig_influencer_funnel",
    title: "Instagram Influencer Funnel",
    channel: "instagram",
    description:
      "Creator-led funnel: seed product to matched micro-influencers, run whitelisted/organic posts to a link-in-bio → funnel → discount → email. Awareness→click→capture→convert.",
    structure: {
      funnel: ["seed to 5-15 micro creators (10-100k, high ER)", "reel/story with discount code", "link-in-bio → /f/[slug]", "email capture + code", "retarget warm list"],
      cadence: { creatorPosts: "cluster in a 3-5 day burst for algo momentum", ownedPosts: "2-3/wk carousels + 1 reel" },
      handoff: "give creator: 3 hooks, reference stills, code, do/don't, deadline",
    },
    templates: [
      { label: "creator outreach DM", body: "Hey {{name}} — love your {{niche}} content. We'd love to gift {{product}} + a paid collab. Code {{CODE}} for your audience, one reel + one story. Rate?" },
      { label: "brief hook set", body: "Hook A (problem): ... / Hook B (result): ... / Hook C (curiosity): ..." },
      { label: "caption CTA", body: "Use {{CODE}} for {{discount}} — link in bio ({{funnelUrl}})." },
    ],
    bestPractices: [
      "Micro > mega: engagement + trust convert better per £.",
      "Give creators hooks + stills, let them keep their voice.",
      "Every creator post drives to ONE link-in-bio funnel with a trackable code.",
      "Burst posting creates algorithmic momentum vs drip.",
    ],
    kpis: ["reach", "profile visits", "link clicks", "code redemptions", "email captures", "CAC per creator"],
    defaultBudgetSplit: { creators: 0.7, paidBoost: 0.2, tools: 0.1 },
  },
  {
    slug: "app-launch-sprint",
    category: "app_launch",
    title: "App Launch Sprint",
    description:
      "2-week launch: pre-buzz → launch-day blast across owned + community + creators → post-launch retention nudge. One funnel, one code, many mouths.",
    structure: {
      timeline: [
        { phase: "pre (d-7..d-1)", do: ["teasers", "waitlist funnel", "seed creators", "prep community posts"] },
        { phase: "launch (d0..d2)", do: ["multi-channel blast", "creator burst", "community posts", "cold email owned list"] },
        { phase: "post (d3..d14)", do: ["retarget", "UGC repost", "retention email", "iterate on top angle"] },
      ],
    },
    templates: [
      { label: "launch tweet", body: "{{product}} is live 🚀 {{oneLiner}}. {{CODE}} for {{discount}} → {{funnelUrl}}" },
      { label: "waitlist headline", body: "{{benefit}}. Get early access + {{discount}}." },
    ],
    bestPractices: ["Concentrate fire on launch day, don't dribble.", "Free channels first; add paid only to amplify what already works.", "Have the funnel + code live BEFORE the first post."],
    kpis: ["installs/signups", "activation %", "d1/d7 retention", "cost per install", "code redemptions"],
  },
  {
    slug: "community-seeding",
    category: "community",
    title: "Reddit & Community Seeding",
    channel: "reddit",
    description:
      "Value-first participation in niche communities. Contribute > promote (9:1). Native posts, no link-drops. Reddit only at low volume; FB Groups API is dead.",
    structure: { ratio: "9 helpful : 1 promotional", format: ["genuine question/story", "teardown/guide", "AMA when credible"], targets: "niche subs where ICP already gathers" },
    templates: [
      { label: "value post", body: "Spent 3 months on {{problem}}, here's what actually worked (with numbers)…" },
      { label: "soft mention", body: "(I built {{product}} to scratch this itch — happy to share if useful, not here to spam.)" },
    ],
    bestPractices: ["Read each sub's rules; self-promo bans are instant.", "Lead with a result or teardown, mention product only if asked.", "One account, real history — throwaways get nuked."],
    kpis: ["upvotes", "comments", "click-through", "signups attributed", "mod removals (keep at 0)"],
  },
  {
    slug: "programmatic-seo",
    category: "seo",
    title: "Programmatic SEO & Content",
    channel: "seo",
    description:
      "Capture intent at scale: cluster keywords by intent, ship comparison + use-case + alternative pages, interlink to the funnel. Compounds, doesn't decay like ads.",
    structure: { clusters: ["{{competitor}} alternative", "{{category}} for {{ICP}}", "how to {{jobToBeDone}}"], onPage: ["match search intent", "unique data/tool", "internal links to funnel"], cadence: "publish 2-3/wk, refresh winners" },
    templates: [
      { label: "title tag", body: "{{keyword}} — {{benefit}} | {{brand}}" },
      { label: "meta description", body: "{{outcome}} without {{pain}}. {{proof}}. Try {{product}}." },
    ],
    bestPractices: ["Target intent, not just volume.", "Give each page a reason to exist (data, tool, angle).", "Interlink every page to the campaign funnel."],
    kpis: ["indexed pages", "impressions", "avg position", "organic clicks", "assisted conversions"],
  },
];

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    // Playbooks — upsert by slug.
    let playbooks = 0;
    for (const p of PLAYBOOKS) {
      const existing = (await ctx.db.query("playbooks").withIndex("by_category", (q) => q.eq("category", p.category)).collect()).find(
        (x) => x.slug === p.slug,
      );
      if (existing) await ctx.db.patch(existing._id, { ...p });
      else await ctx.db.insert("playbooks", { ...p, createdAt: Date.now() });
      playbooks++;
    }

    // Models — one row per persona LoRA that isn't already registered.
    let models = 0;
    const personas = await ctx.db.query("personas").collect();
    const existingModels = await ctx.db.query("models").collect();
    for (const persona of personas) {
      if (!persona.loraUrl) continue;
      if (existingModels.some((m) => m.personaId === persona._id)) continue;
      await ctx.db.insert("models", {
        name: `${persona.name} LoRA`,
        kind: "lora",
        provider: persona.loraUrl.includes("fal.media") || persona.loraUrl.includes("fal.ai") ? "fal" : "higgsfield",
        url: persona.loraUrl,
        trigger: persona.loraTrigger,
        personaId: persona._id,
        tags: persona.niche ? [persona.niche] : [],
        status: "active",
        createdAt: Date.now(),
      });
      models++;
    }

    return { playbooks, models };
  },
});
