import { isLive, vaultTry, simulated, blocked, live, type GateResult } from "./gate";

// Shopify Admin GraphQL adapter — identifies a store's real catalogue so the
// strategist plans marketing for the ACTUAL products, and mints real discount
// codes. Reads are always allowed (understanding the store is safe); minting a
// discount is a side-effect → gated. Mirrors the dropship-ai pattern
// (X-Shopify-Access-Token, Admin GraphQL). Creds in vault service "shopify":
//   SHOPIFY_STORE_DOMAIN (e.g. snuffloe.myshopify.com), SHOPIFY_ADMIN_TOKEN,
//   SHOPIFY_API_VERSION (default 2026-01).

export type ShopProduct = {
  externalId: string;
  title: string;
  handle?: string;
  productType?: string;
  tags: string[];
  pricePence?: number;
  currency?: string;
  imageUrls: string[];
  collections: string[];
  status?: string;
};
export type StoreConfig = { domain: string; token: string; apiVersion: string };

async function storeConfig(override?: Partial<StoreConfig>): Promise<StoreConfig | null> {
  const v = await vaultTry("shopify");
  const domain = override?.domain ?? v.SHOPIFY_STORE_DOMAIN;
  const token = override?.token ?? v.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) return null;
  return { domain, token, apiVersion: override?.apiVersion ?? v.SHOPIFY_API_VERSION ?? "2026-01" };
}

async function gql<T>(cfg: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://${cfg.domain}/admin/api/${cfg.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": cfg.token, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!r.ok || j.errors) throw new Error(`shopify: ${JSON.stringify(j.errors ?? j).slice(0, 240)}`);
  return j.data as T;
}

const PRODUCTS_QUERY = `
query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle productType tags status
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      featuredImage { url }
      media(first: 6) { nodes { ... on MediaImage { image { url } } } }
      collections(first: 8) { nodes { title } }
    }
  }
}`;

type ProductsResp = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    nodes: {
      id: string; title: string; handle?: string; productType?: string; tags?: string[]; status?: string;
      priceRangeV2?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
      featuredImage?: { url?: string };
      media?: { nodes?: { image?: { url?: string } }[] };
      collections?: { nodes?: { title?: string }[] };
    }[];
  };
};

/** Pull the store's catalogue. Returns { configured, products }. */
export async function getProducts(
  override?: Partial<StoreConfig>,
): Promise<{ configured: boolean; domain?: string; products: ShopProduct[]; note?: string }> {
  const cfg = await storeConfig(override);
  if (!cfg) return { configured: false, products: [], note: "no Shopify creds in vault (service 'shopify')" };
  try {
    const out: ShopProduct[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const d = await gql<ProductsResp>(cfg, PRODUCTS_QUERY, { cursor });
      for (const n of d.products.nodes) {
        const amt = n.priceRangeV2?.minVariantPrice?.amount;
        const imgs = [n.featuredImage?.url, ...(n.media?.nodes ?? []).map((m) => m.image?.url)].filter(Boolean) as string[];
        out.push({
          externalId: n.id,
          title: n.title,
          handle: n.handle,
          productType: n.productType || undefined,
          tags: n.tags ?? [],
          pricePence: amt ? Math.round(parseFloat(amt) * 100) : undefined,
          currency: n.priceRangeV2?.minVariantPrice?.currencyCode,
          imageUrls: [...new Set(imgs)],
          collections: (n.collections?.nodes ?? []).map((c) => c.title ?? "").filter(Boolean),
          status: n.status,
        });
      }
      if (!d.products.pageInfo.hasNextPage) break;
      cursor = d.products.pageInfo.endCursor;
    }
    return { configured: true, domain: cfg.domain, products: out };
  } catch (e) {
    return { configured: true, domain: cfg.domain, products: [], note: e instanceof Error ? e.message : String(e) };
  }
}

/** Mint a Shopify discount code (side-effect → gated). */
export async function createDiscount(input: {
  code: string;
  percentOff: number;
  startsAt?: number;
  endsAt?: number;
}): Promise<GateResult<{ code: string; externalId?: string }>> {
  const doing = `mint Shopify code ${input.code} (${input.percentOff}% off)`;
  if (!(await isLive())) return simulated(doing, { code: input.code });
  const cfg = await storeConfig();
  if (!cfg) return blocked("no Shopify creds in vault (service 'shopify')");
  const mutation = `
mutation($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field message }
  }
}`;
  try {
    const d = await gql<{
      discountCodeBasicCreate: { codeDiscountNode?: { id?: string }; userErrors?: { message?: string }[] };
    }>(cfg, mutation, {
      input: {
        title: input.code,
        code: input.code,
        startsAt: new Date(input.startsAt ?? Date.now()).toISOString(),
        endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : undefined,
        customerSelection: { all: true },
        customerGets: { value: { percentage: input.percentOff / 100 }, items: { all: true } },
        appliesOncePerCustomer: true,
      },
    });
    const errs = d.discountCodeBasicCreate.userErrors ?? [];
    if (errs.length) return blocked(`shopify discount: ${errs.map((e) => e.message).join("; ")}`);
    return live(`minted ${input.code}`, { code: input.code, externalId: d.discountCodeBasicCreate.codeDiscountNode?.id });
  } catch (e) {
    return blocked(`shopify discount error: ${e instanceof Error ? e.message : e}`);
  }
}
