import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { vaultService } from "@/lib/vault";
import { syncStore } from "@/lib/orchestrator/store";

export const maxDuration = 60;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// Connect + sync a Shopify store so campaigns become product-aware.
// POST { domain?, name? } → connects (defaults domain to vault SHOPIFY_STORE_DOMAIN)
// and pulls the catalogue with per-product channel plans. GET → stores + counts.

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { domain?: string; name?: string };
  const cx = new ConvexHttpClient(CONVEX_URL);
  let domain = body.domain;
  if (!domain) {
    try {
      domain = (await vaultService("shopify")).SHOPIFY_STORE_DOMAIN;
    } catch {
      /* no vault */
    }
  }
  if (!domain) {
    return NextResponse.json(
      { error: "no store domain — pass { domain } or add SHOPIFY_STORE_DOMAIN to the vault 'shopify' service" },
      { status: 400 },
    );
  }
  const storeId = await cx.mutation(api.stores.connect, { domain, name: body.name });
  const sync = await syncStore(storeId);
  return NextResponse.json({ storeId, domain, ...sync });
}

export async function GET() {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const stores = await cx.query(api.stores.list, {});
  const withCounts = await Promise.all(
    stores.map(async (s) => ({ ...s, products: await cx.query(api.products.count, { storeId: s._id as Id<"stores"> }) })),
  );
  return NextResponse.json({ stores: withCounts });
}
