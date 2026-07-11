import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getProducts } from "../integrations/shopify";
import { planChannels, planStore } from "../product-channels";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Sync a store's catalogue into Convex, computing each product's channel plan so
// campaigns targeting the store are product-aware. Read-only against Shopify.
export async function syncStore(storeId: string): Promise<{ ok: boolean; products: number; note?: string; topChannels?: string[] }> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const id = storeId as Id<"stores">;
  const store = await cx.query(api.stores.get, { id });
  if (!store) return { ok: false, products: 0, note: "store not found" };

  const res = await getProducts({ domain: store.domain });
  if (!res.configured) return { ok: false, products: 0, note: res.note };
  if (res.note && res.products.length === 0) return { ok: false, products: 0, note: res.note };

  const rollup = planStore(res.products);
  await cx.mutation(api.products.bulkUpsert, {
    storeId: id,
    products: res.products.map((p) => ({
      externalId: p.externalId,
      title: p.title,
      handle: p.handle,
      productType: p.productType,
      tags: p.tags,
      pricePence: p.pricePence,
      currency: p.currency,
      imageUrls: p.imageUrls,
      collections: p.collections,
      status: p.status,
      channelPlan: planChannels(p),
    })),
  });
  await cx.mutation(api.stores.markSynced, { id });
  return { ok: true, products: res.products.length, topChannels: rollup.topChannels };
}

/** Build a product-context block for the strategist from a store's synced catalogue. */
export async function productContextFor(storeId: string): Promise<string> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const id = storeId as Id<"stores">;
  const store = await cx.query(api.stores.get, { id });
  const products = await cx.query(api.products.forStore, { storeId: id });
  if (!products.length) return "";
  const lines = products.slice(0, 40).map((p) => {
    const cp = (p.channelPlan ?? {}) as { channels?: string[]; aovBand?: string; category?: string; angle?: string };
    const price = p.pricePence != null ? `£${(p.pricePence / 100).toFixed(2)}` : "?";
    return `• ${p.title} (${price}, ${cp.category ?? "?"}/${cp.aovBand ?? "?"}) → channels: ${(cp.channels ?? []).join(", ")}; angle: ${cp.angle ?? ""}`;
  });
  return [
    `STORE: ${store?.name ?? store?.domain} — ${products.length} products.`,
    `Plan marketing for THESE real products on the channels each one fits (mapping below is authoritative):`,
    ...lines,
  ].join("\n");
}
