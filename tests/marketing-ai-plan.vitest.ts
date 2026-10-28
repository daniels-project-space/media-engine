import { describe, expect, it } from "vitest";
import { generateMarketingPlan } from "../src/lib/marketing/ai-plan";

const brief = { name: "Alpha", website: "https://alpha.example", offer: "A planning tool", audience: "Designers", facts: ["Has a free trial"], goal: "signup", tone: "clear", timezone: "Europe/Zurich", cadence: 3 };
const valid = { audience: "Designers", positioning: "Planning tool", objective: "Trial signups",
  channels: [{ name: "instagram", rationale: "Visual examples" }], pillars: ["Practical advice"],
  assumptions: ["Designers may value speed"], missingInformation: ["Conversion rate"],
  experiments: [{ hypothesis: "Examples increase clicks", measure: "Clicks", stopCondition: "After two weeks" }],
  calendar: [1, 14].map(day => ({ day, channel: "instagram", format: "video", rationale: "Introduce feature", caption: "Explore the tool", hashtags: ["#design"], videoScript: "Hook, demo, CTA" })) };

describe("AI marketing planner", () => {
  it("uses confirmed project facts and labels missing external research", async () => {
    const result = await generateMarketingPlan(brief, async (options) => {
      expect(options.user).toContain("Has a free trial");
      expect(options.system).toContain("untrusted data");
      return JSON.stringify(valid);
    });
    expect(result.sources).toContain("No independent market research");
    expect(JSON.parse(result.calendar)).toHaveLength(2);
  });
  it("rejects invalid or incomplete model output", async () => {
    await expect(generateMarketingPlan(brief, async () => "not json")).rejects.toThrow();
    await expect(generateMarketingPlan(brief, async () => JSON.stringify({ ...valid, calendar: [valid.calendar[0]] }))).rejects.toThrow(/two-week/);
  });
});
