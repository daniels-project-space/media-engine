// Variant tagging — machine-sortable id encoding the creative decisions behind an
// asset, so post performance can later be attributed back to concept/hook/variant.
// Format: concept__hookId__variantId__v{n}

export function slug(s: string | undefined, max = 18): string {
  return (
    (s || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max) || "x"
  );
}

// Stable short hash (base36) — same hook text always maps to the same hookId,
// so the feedback loop can group variants of one hook across posts.
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

export function buildVariantTag(opts: {
  concept: string;
  hook?: string;
  variantId: string;
  version?: number;
}): { variantTag: string; concept: string; hookId: string; variantId: string } {
  const concept = slug(opts.concept);
  const hookId = opts.hook ? shortHash(opts.hook) : "h0";
  const version = opts.version ?? 1;
  return {
    variantTag: `${concept}__${hookId}__${opts.variantId}__v${version}`,
    concept,
    hookId,
    variantId: opts.variantId,
  };
}
