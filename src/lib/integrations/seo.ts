import { vaultTry } from "./gate";

// SEO / market-intel adapter. Read-only research, so no live gate. Prefers
// DataForSEO (cheapest at volume) and falls back to Serper.dev (generous free
// tier). If neither key is present it returns an "unconfigured" report so the
// orchestrator can still produce a plan (it just flags the gap) instead of dying.

export type Keyword = { keyword: string; volume?: number; cpcPence?: number; competition?: number };
export type SerpItem = { title: string; url: string; snippet?: string; position?: number };
export type IntelResult<T> = { source: string; configured: boolean; data: T; note?: string };

const DFS = "https://api.dataforseo.com/v3";
const SERPER = "https://google.serper.dev";

/** Keyword ideas + volumes for a seed term. */
export async function keywords(seed: string, locationCode = 2826 /* UK */): Promise<IntelResult<Keyword[]>> {
  const { DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD } = await vaultTry("dataforseo");
  if (DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD) {
    try {
      const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
      const r = await fetch(`${DFS}/keywords_data/google_ads/keywords_for_keywords/live`, {
        method: "POST",
        headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
        body: JSON.stringify([{ keywords: [seed], location_code: locationCode, language_code: "en" }]),
      });
      const j = (await r.json()) as { tasks?: { result?: { keyword: string; search_volume?: number; cpc?: number; competition?: number }[] }[] };
      const rows = j.tasks?.[0]?.result ?? [];
      const data = rows.slice(0, 40).map((k) => ({
        keyword: k.keyword,
        volume: k.search_volume,
        cpcPence: k.cpc != null ? Math.round(k.cpc * 100) : undefined,
        competition: k.competition,
      }));
      return { source: "dataforseo", configured: true, data };
    } catch (e) {
      return { source: "dataforseo", configured: true, data: [], note: `error: ${e instanceof Error ? e.message : e}` };
    }
  }
  return { source: "none", configured: false, data: [], note: "no DataForSEO key in vault — keyword volumes unavailable" };
}

/** Live SERP for a query (competitor + landscape scan). */
export async function serp(query: string): Promise<IntelResult<SerpItem[]>> {
  const { SERPER_API_KEY } = await vaultTry("serper");
  if (SERPER_API_KEY) {
    try {
      const r = await fetch(`${SERPER}/search`, {
        method: "POST",
        headers: { "X-API-KEY": SERPER_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ q: query, gl: "uk", num: 10 }),
      });
      const j = (await r.json()) as { organic?: { title: string; link: string; snippet?: string; position?: number }[] };
      const data = (j.organic ?? []).map((o) => ({ title: o.title, url: o.link, snippet: o.snippet, position: o.position }));
      return { source: "serper", configured: true, data };
    } catch (e) {
      return { source: "serper", configured: true, data: [], note: `error: ${e instanceof Error ? e.message : e}` };
    }
  }
  return { source: "none", configured: false, data: [], note: "no Serper key in vault — SERP scan unavailable" };
}
