// Shared types for the campaign orchestrator. Pure data — the LLM fills these.

export type ProductProfile = {
  productName: string;
  oneLiner: string;
  category: "app_launch" | "ecommerce" | "fiverr_service" | "personal_brand" | "saas" | "content" | "other";
  audience: string; // ideal customer profile
  painPoints: string[];
  valueProps: string[];
  differentiators: string[];
  tone: string;
  keywords: string[]; // seed terms for SEO research
  competitors: string[];
  suggestedChannels: string[];
  referenceImageKeys: string[]; // R2 keys pulled from the product URL (not rendered)
  brandColors?: string[];
  notes?: string;
};

export type PlannedStep = {
  order: number;
  kind:
    | "research"
    | "understand"
    | "strategy"
    | "build_funnel"
    | "create_discount"
    | "schedule_posts"
    | "cold_email"
    | "influencer_brief"
    | "community_post"
    | "analytics_check"
    | "adjust";
  channel?: string;
  paid: boolean;
  estCostPence: number;
  scheduledOffsetHours?: number; // when to run, relative to launch
  payload?: Record<string, unknown>;
  label: string;
};

export type ContentItem = {
  day: number;
  channel: string;
  format: string; // carousel | reel | tweet | story | email | community_post
  angle: string;
  caption: string;
  hook: string;
  usesModel?: string; // references an existing model/LoRA name — NOT a render request
  referenceKey?: string;
};

export type FunnelSpec = {
  slug: string;
  headline: string;
  subhead: string;
  valueProps: { header: string; body: string }[];
  ctaText: string;
  discountBlurb?: string;
};

export type CampaignPlan = {
  objective: string;
  summary: string;
  channelMix: { channel: string; role: string; paid: boolean; weight: number }[];
  budgetSplit: { channel: string; pence: number }[];
  contentCalendar: ContentItem[];
  funnel: FunnelSpec;
  discount?: { code: string; percentOff?: number; amountOffPence?: number; blurb: string };
  messagingAngles: string[];
  coldEmail?: { subjectLines: string[]; body: string; targetDescription: string };
  influencerBrief?: { targetNiche: string; ask: string; deliverables: string[] };
  kpis: string[];
  steps: PlannedStep[];
  risks?: string[];
};
