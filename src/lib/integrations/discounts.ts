import { isLive, vaultTry, simulated, blocked, live, type GateResult } from "./gate";

// Discount-code adapter (Stripe promotion_codes). A Stripe promo code needs a
// coupon first, then a customer-facing code that maps to it. Minting a code is a
// real side-effect → DRY-RUN unless isLive() AND the Stripe key exists. In
// dry-run we still return the requested code so funnels can display it while the
// campaign is being previewed.

export type DiscountInput = {
  code: string;
  percentOff?: number;
  amountOffPence?: number;
  currency?: string; // default gbp
  maxRedemptions?: number;
  expiresAt?: number; // epoch ms
};
export type DiscountResult = { code: string; provider: string; externalId?: string };

function form(obj: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null) p.append(k, String(v));
  return p.toString();
}

export async function createDiscount(input: DiscountInput): Promise<GateResult<DiscountResult>> {
  const desc = input.percentOff ? `${input.percentOff}% off` : `${(input.amountOffPence ?? 0) / 100} ${(input.currency ?? "gbp").toUpperCase()} off`;
  const doing = `mint discount ${input.code} (${desc})`;
  if (!(await isLive())) return simulated(doing, { code: input.code, provider: "stripe" });

  const { STRIPE_SECRET_KEY } = await vaultTry("stripe");
  if (!STRIPE_SECRET_KEY) return blocked("no Stripe key in vault (STRIPE_SECRET_KEY)");
  const auth = { authorization: `Bearer ${STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" };
  try {
    // 1) coupon
    const couponBody = form({
      duration: "once",
      percent_off: input.percentOff,
      amount_off: input.amountOffPence,
      currency: input.amountOffPence ? (input.currency ?? "gbp") : undefined,
      max_redemptions: input.maxRedemptions,
      redeem_by: input.expiresAt ? Math.floor(input.expiresAt / 1000) : undefined,
    });
    const cr = await fetch("https://api.stripe.com/v1/coupons", { method: "POST", headers: auth, body: couponBody });
    const coupon = (await cr.json()) as { id?: string; error?: { message?: string } };
    if (!cr.ok || !coupon.id) return blocked(`stripe coupon: ${coupon.error?.message ?? "failed"}`);

    // 2) promotion code (the human-facing code)
    const pr = await fetch("https://api.stripe.com/v1/promotion_codes", {
      method: "POST",
      headers: auth,
      body: form({
        coupon: coupon.id,
        code: input.code,
        max_redemptions: input.maxRedemptions,
        expires_at: input.expiresAt ? Math.floor(input.expiresAt / 1000) : undefined,
      }),
    });
    const promo = (await pr.json()) as { id?: string; code?: string; error?: { message?: string } };
    if (!pr.ok || !promo.id) return blocked(`stripe promo: ${promo.error?.message ?? "failed"}`);
    return live(`minted ${input.code}`, { code: promo.code ?? input.code, provider: "stripe", externalId: promo.id });
  } catch (e) {
    return blocked(`stripe error: ${e instanceof Error ? e.message : e}`);
  }
}
