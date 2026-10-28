import { describe, expect, it, vi } from "vitest";
import { discoverResearchUrls } from "../src/lib/marketing/discovery";

const input = { apiKey: "tvly-fixture0123456789", offer: "A tool for production planning", audience: "independent filmmakers", ownWebsite: "https://my-project.example/" };
const free = { key: { usage: 0, limit: 1000 }, account: { current_plan: "Researcher", plan_usage: 0, plan_limit: 1000, paygo_limit: 0 } };

describe("free-only research discovery", () => {
  it("checks account limits before one bounded basic search and filters unsafe URLs", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(free))).mockResolvedValueOnce(new Response(JSON.stringify({ results: [
      { url: "https://competitor.example/a" }, { url: "http://unsafe.example" }, { url: "https://127.0.0.1/" }, { url: "https://my-project.example/" }, { url: "https://competitor.example/a" },
    ] }))) as unknown as typeof fetch;
    expect(await discoverResearchUrls(input, fetcher)).toEqual(["https://competitor.example/a"]);
    const calls = vi.mocked(fetcher).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("https://api.tavily.com/usage");
    const body = JSON.parse(String(calls[1][1]?.body));
    expect(body).toMatchObject({ search_depth: "basic", max_results: 5, auto_parameters: false, include_raw_content: false });
    expect(JSON.stringify(body)).not.toContain(input.apiKey);
  });
  it.each([
    { ...free, account: { ...free.account, paygo_limit: 1 } },
    { ...free, account: { ...free.account, current_plan: "Bootstrap" } },
    { ...free, account: { ...free.account, plan_usage: 1000 } },
  ])("never searches if the free-only usage check fails", async usage => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(usage))) as unknown as typeof fetch;
    await expect(discoverResearchUrls(input, fetcher)).rejects.toThrow(/free plan/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
