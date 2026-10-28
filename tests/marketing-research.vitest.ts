import { expect, it } from "vitest";
import { researchWebsiteFacts } from "../src/lib/marketing/website";

it("extracts bounded attributed page content without scripts or styles", () => {
  const result = researchWebsiteFacts(`<title>Source title</title><meta name="description" content="Public description"><script>hidden script content</script><style>hidden style</style><h1>Useful source heading for a project</h1><p>Source material is an attributed claim, not a verified product fact.</p>`, "https://example.com/");
  expect(result.url).toBe("https://example.com/");
  expect(result.title).toBe("Source title");
  expect(result.excerpt).toContain("Useful source heading");
  expect(result.excerpt).not.toContain("hidden script");
  expect(result.excerpt.length).toBeLessThanOrEqual(4000);
});
