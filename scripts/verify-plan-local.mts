import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// Private local fixtures only. Refuse a cloud Convex URL or enabled dispatch.
process.loadEnvFile(".env.local");
const backend = process.env.NEXT_PUBLIC_CONVEX_URL!;
assert.equal(new URL(backend).hostname, "127.0.0.1");
for (const key of ["MARKETING_PUBLISH_ENABLED", "MARKETING_ADS_ENABLED", "MARKETING_AUTOMATION_ENABLED"])
  assert.notEqual(process.env[key], "true");
const run = randomUUID().slice(0, 8), client = new ConvexHttpClient(backend);
const gateway = makeFunctionReference<"action">("marketingGateway:call");
const call = async (operation: string, payload: unknown) => client.action(gateway, { serviceToken: process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!, operation, payload });
const projectId = await call("createProject", { name: `Local plan ${run}`, website: "https://example.com", offer: "Local fixture", audience: "Local testers", facts: ["This is a local test fixture"], goal: "signup", tone: "clear", timezone: "Europe/Zurich", cadence: 2, generationLimitMinor: 0, advertisingLimitMinor: 0, currency: "USD", conversionTokenHash: createHash("sha256").update(run).digest("hex") }) as string;
let workspace = await call("listWorkspace", { projectId }) as { accounts: Array<{ _id: string; providerAccountId: string }> };
let account = workspace.accounts.find(row => row.providerAccountId.startsWith("local-plan-"));
if (!account) {
  await call("syncAccounts", { accountCount: 1, pricingVerifiedAt: Date.now(), accounts: [{ providerAccountId: `local-plan-${run}`, profileId: `local-profile-${run}`, platform: "x", label: `Local plan X ${run}`, connected: true }] });
  workspace = await call("listWorkspace", { projectId }) as typeof workspace;
  account = workspace.accounts.find(row => row.providerAccountId === `local-plan-${run}`);
}
assert.ok(account, "An explicitly local X fixture must already exist");
await call("saveChannel", { projectId, accountId: account._id, mode: "draft", communityApproved: false });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext({ baseURL: "http://localhost:3108", viewport: { width: 1440, height: 1100 } });
  const session = await context.request.post("/api/operator/session", { headers: { authorization: `Bearer ${process.env.MEDIA_ENGINE_OPERATOR_TOKEN!}` }, data: {} });
  assert.equal(session.status(), 200);
  const page = await context.newPage();
  await page.goto("/marketing#projects");
  await page.getByRole("combobox", { name: "Current project" }).selectOption(projectId);
  await expect(page.getByRole("heading", { name: `Local plan ${run}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Strategy and content plan" })).toHaveCount(1);
  await expect(page.getByText(/AI safety switch: paused/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate AI plan" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discover market sources" })).toBeDisabled();
  await page.getByLabel("Public research URL").fill("https://media-engine-seven.vercel.app/");
  await page.getByRole("button", { name: "Capture source" }).click();
  await expect.poll(async () => (await call("listResearch", { projectId }) as unknown[]).length, { timeout: 20_000 }).toBe(1);
  const strategy = page.getByLabel("Strategy", { exact: true });
  await expect(strategy).toBeVisible();
  await strategy.fill("A useful local strategy for testers.");
  await page.getByLabel("14-day content plan").fill(JSON.stringify([{ day: 2, channel: "x", format: "Local introduction", rationale: "Explain the fixture", caption: "A private fixture draft", hashtags: ["#fixture"], videoScript: "Hook: local test" }]));
  await page.getByLabel("Research sources and assumptions").fill("Local fixture; no external research.");
  await page.getByRole("button", { name: "Save plan revision" }).click();
  await expect(page.getByRole("heading", { name: "Calendar drafts" })).toBeVisible();
  await expect(page.getByText("A private fixture draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save render brief" }).click();
  await expect.poll(async () => (await call("listRenderBriefs", { projectId }) as unknown[]).length).toBe(1);
  await expect(page.getByText("Local introduction · x · minimax-h3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create review draft" }).click();
  await expect.poll(async () => ((await call("listWorkspace", { projectId })) as { items: unknown[] }).items.length).toBe(1);
  const final = await call("listWorkspace", { projectId }) as { items: Array<{ status: string; content: string }> };
  assert.equal(final.items.length, 1);
  assert.equal(final.items[0].status, "draft");
  assert.match(final.items[0].content, /private fixture draft/);
  await page.screenshot({ path: "/root/media-engine-marketing-proof-20261028/local-plan-calendar.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: "Calendar drafts" })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile workspace must fit the viewport");
  await page.screenshot({ path: "/root/media-engine-marketing-proof-20261028/local-plan-calendar-mobile.png", fullPage: true });
  console.log("Local browser: plan save, render brief, calendar card and review draft passed. No public or paid writes.");
} finally { await browser.close(); }
