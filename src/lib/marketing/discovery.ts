import { z } from "zod";
import { website } from "../../../convex/marketingPolicy";

const usageSchema = z.object({
  key: z.object({ usage: z.number().int().nonnegative(), limit: z.number().int().positive() }),
  account: z.object({ current_plan: z.string(), plan_usage: z.number().int().nonnegative(),
    plan_limit: z.number().int().positive(), paygo_limit: z.number().int().nonnegative() }),
});
const searchSchema = z.object({ results: z.array(z.object({ url: z.string().max(700) })).max(20) });

async function readJson(response: Response) {
  if (!response.ok) throw new Error("Research search provider request failed");
  const text = await response.text();
  if (text.length > 200_000) throw new Error("Research search response exceeds limit");
  return JSON.parse(text) as unknown;
}

/** One basic search after a fresh free-plan/no-paygo check. No automatic retries. */
export async function discoverResearchUrls(input: { apiKey: string; offer: string; audience: string; ownWebsite: string }, fetcher: typeof fetch = fetch) {
  if (!/^tvly-[A-Za-z0-9_-]{12,200}$/.test(input.apiKey)) throw new Error("Research search is not configured");
  const headers = { authorization: `Bearer ${input.apiKey}`, accept: "application/json" };
  const usage = usageSchema.parse(await readJson(await fetcher("https://api.tavily.com/usage", {
    headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000),
  })));
  if (!["researcher", "free"].includes(usage.account.current_plan.toLowerCase()) || usage.account.paygo_limit !== 0 ||
      usage.account.plan_usage >= usage.account.plan_limit || usage.key.usage >= usage.key.limit)
    throw new Error("Research discovery requires a verified free plan with pay-as-you-go disabled and available credits");
  const query = `${input.offer.slice(0, 150)} ${input.audience.slice(0, 100)} alternatives and market`.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  if (query.length < 12) throw new Error("The project brief needs more detail before market discovery");
  const response = await fetcher("https://api.tavily.com/search", { method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false, auto_parameters: false }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  const result = searchSchema.parse(await readJson(response));
  const ownHost = new URL(website(input.ownWebsite)).hostname;
  const urls = new Set<string>();
  for (const item of result.results) {
    try {
      const url = website(item.url);
      if (new URL(url).hostname !== ownHost) urls.add(url);
    } catch { /* Unsafe or unsupported links never reach the fetcher. */ }
    if (urls.size === 3) break;
  }
  return [...urls];
}
