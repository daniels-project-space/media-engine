// FTC / AI disclosure gate. Sponsored, gifted, affiliate, and AI-generated
// content must be labelled — liability sits with the brand regardless of who/what
// made it. This is a hard, deterministic gate applied before any caption ships.

export type DisclosureContext = {
  paid?: boolean; // paid partnership / sponsored
  gifted?: boolean; // free product to a creator
  affiliate?: boolean; // affiliate/commission link
  aiGenerated?: boolean; // asset is AI-generated
};

export type DisclosureCheck = { required: boolean; missing: string[]; tags: string[] };

/** What disclosure this content requires, and whether the caption already has it. */
export function checkDisclosure(caption: string, ctx: DisclosureContext): DisclosureCheck {
  const lc = caption.toLowerCase();
  const need: { tag: string; present: boolean }[] = [];
  if (ctx.paid) need.push({ tag: "#ad", present: /#ad\b|#sponsored|paid partnership/.test(lc) });
  else if (ctx.gifted) need.push({ tag: "#gifted", present: /#gifted|#ad\b|gifted by/.test(lc) });
  if (ctx.affiliate) need.push({ tag: "affiliate", present: /affiliate|commission|earn from/.test(lc) });
  if (ctx.aiGenerated) need.push({ tag: "AI-generated", present: /ai[- ]generated|made with ai|#ai\b/.test(lc) });
  const missing = need.filter((n) => !n.present).map((n) => n.tag);
  return { required: need.length > 0, missing, tags: need.map((n) => n.tag) };
}

/** Append any missing disclosure so the caption is compliant. Idempotent. */
export function ensureDisclosure(caption: string, ctx: DisclosureContext): string {
  const { missing } = checkDisclosure(caption, ctx);
  if (!missing.length) return caption;
  const parts: string[] = [];
  if (missing.includes("#ad")) parts.push("#ad");
  if (missing.includes("#gifted")) parts.push("#gifted");
  if (missing.includes("affiliate")) parts.push("Contains affiliate links.");
  if (missing.includes("AI-generated")) parts.push("Made with AI.");
  return `${caption.trimEnd()}\n\n${parts.join(" ")}`.trim();
}
