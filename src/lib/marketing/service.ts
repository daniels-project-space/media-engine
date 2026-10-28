import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { creativeServiceToken } from "../creative-service";
import { vaultService } from "../vault";
import { ZernioClient } from "./zernio";

const gateway = makeFunctionReference<
  "action",
  { serviceToken: string; operation: string; payload: unknown },
  unknown
>("marketingGateway:call");

export async function marketingCall<T>(
  operation: string,
  payload: unknown,
): Promise<T> {
  const client = new ConvexHttpClient(
    process.env.NEXT_PUBLIC_CONVEX_URL ??
      "https://blissful-sardine-231.convex.cloud",
  );
  return (await client.action(gateway, {
    serviceToken: await creativeServiceToken(),
    operation,
    payload,
  })) as T;
}

export async function providerClient() {
  const apiKey =
    process.env.ZERNIO_API_KEY?.trim() ||
    (
      await vaultService("media-engine").catch(
        () => ({}) as Record<string, string>,
      )
    ).ZERNIO_API_KEY;
  if (!apiKey)
    throw new Error(
      "ZERNIO_API_KEY is not configured; connect an existing account before provider qualification",
    );
  return new ZernioClient(apiKey);
}

export function assertCurrentProviderPricing(now = Date.now()): number {
  const pricingVerifiedAt = Date.parse(
    process.env.MARKETING_PRICING_VERIFIED_AT ?? "",
  );
  if (
    !Number.isFinite(pricingVerifiedAt) ||
    pricingVerifiedAt > now ||
    pricingVerifiedAt < now - 30 * 86_400_000
  )
    throw new Error(
      "Set MARKETING_PRICING_VERIFIED_AT after checking current Zernio pricing and X usage rates",
    );
  return pricingVerifiedAt;
}

export async function refreshProviderAccounts() {
  const pricingVerifiedAt = assertCurrentProviderPricing();
  const client = await providerClient();
  const [inventory, billing] = await Promise.all([
    client.listAccounts(),
    client.billingSnapshot(),
  ]);
  if (
    billing.accountCount <
    inventory.accounts.filter((account) => account.connected).length
  )
    throw new Error(
      "Team billing account count differs from the active connected inventory",
    );
  return marketingCall("syncAccounts", {
    ...inventory,
    accountCount: billing.accountCount,
    billing,
    pricingVerifiedAt,
  });
}

export function authorisedAccount(accountId: string, kind: "post" | "ad") {
  const key =
    kind === "post" ? "MARKETING_PUBLISH_ENABLED" : "MARKETING_ADS_ENABLED";
  const accounts = new Set(
    (process.env.MARKETING_AUTHORISED_ACCOUNT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    process.env[key] !== "true" ||
    process.env.MARKETING_ZERNIO_QUALIFIED !== "true" ||
    !accounts.has(accountId)
  )
    throw new Error(
      `${key} and account-specific live qualification are required; no provider write was made`,
    );
}

export function marketingReadiness() {
  return {
    provider: "zernio" as const,
    qualified: process.env.MARKETING_ZERNIO_QUALIFIED === "true",
    publishingEnabled: process.env.MARKETING_PUBLISH_ENABLED === "true",
    advertisingEnabled: process.env.MARKETING_ADS_ENABLED === "true",
    generationMode: "brand_templates" as const,
    generationCostMinor: 0,
    integrationLimitMinor: 3_000,
    integrationCurrency: "USD",
    researchDiscoveryEnabled: process.env.MARKETING_TAVILY_DISCOVERY_ENABLED === "true",
  };
}

export async function boundedJson(
  request: Request,
  limit = 64 * 1024,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new Error("Request exceeds the size limit");
  if (!request.body) throw new Error("A JSON request body is required");
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Request exceeds the size limit");
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function publicFailure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Marketing request failed";
  return message
    .replace(/Bearer\s+\S+|(?:sk|zrk|zernio)[-_][A-Za-z0-9_-]+/gi, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 500);
}
