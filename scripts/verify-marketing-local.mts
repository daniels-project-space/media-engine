import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// This exercises the actual Next server and anonymous Convex backend. Social
// connections below are EXPLICIT LOCAL FIXTURES, never provider qualifications.
process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3108";
const backend = process.env.NEXT_PUBLIC_CONVEX_URL!;
assert.equal(
  new URL(backend).hostname,
  "127.0.0.1",
  "Local verification must never seed a cloud deployment",
);
assert.notEqual(process.env.MARKETING_PUBLISH_ENABLED, "true");
assert.notEqual(process.env.MARKETING_ADS_ENABLED, "true");
assert.notEqual(process.env.MARKETING_AUTOMATION_ENABLED, "true");
const run = randomUUID().slice(0, 8),
  alpha = `QA Alpha ${run}`,
  beta = `QA Beta ${run}`;
const proof = "/root/media-engine-marketing-proof-20261028";
await mkdir(proof, { recursive: true });
const client = new ConvexHttpClient(backend);
const gateway = makeFunctionReference<"action">("marketingGateway:call");
await client.action(gateway, {
  serviceToken: process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!,
  operation: "syncAccounts",
  payload: {
    accounts: [
      {
        providerAccountId: `fixture-alpha-${run}`,
        profileId: `fixture-alpha-profile-${run}`,
        platform: "x",
        label: `Local fixture X Alpha ${run}`,
        connected: true,
      },
      {
        providerAccountId: `fixture-beta-${run}`,
        profileId: `fixture-beta-profile-${run}`,
        platform: "x",
        label: `Local fixture X Beta ${run}`,
        connected: true,
      },
      {
        providerAccountId: `fixture-google-${run}`,
        profileId: `fixture-google-profile-${run}`,
        platform: "googleads",
        label: `Local fixture Google ${run}`,
        connected: true,
      },
    ],
    accountCount: 3,
    pricingVerifiedAt: Date.now(),
  },
});
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage(),
  errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks: string[] = [];
try {
  assert.equal((await context.request.get("/api/marketing")).status(), 401);
  checks.push("Unauthenticated marketing reads fail closed");
  const session = await context.request.post("/api/operator/session", {
    headers: {
      authorization: `Bearer ${process.env.MEDIA_ENGINE_OPERATOR_TOKEN!}`,
    },
    data: {},
  });
  assert.equal(session.status(), 200);
  await page.goto(`${origin}/marketing`);
  await expect(
    page.getByRole("heading", { name: "One project. A clear next step." }),
  ).toBeVisible();

  async function addProject(name: string, inspect: boolean) {
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page
      .getByLabel("Website", { exact: true })
      .fill("https://media-engine-seven.vercel.app/");
    if (inspect) {
      await page
        .getByRole("button", { name: "Import name and offer from URL" })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Website metadata imported" }),
      ).toBeVisible({ timeout: 20_000 });
      assert.notEqual(
        await page.getByLabel("Project name", { exact: true }).inputValue(),
        "",
      );
      checks.push(
        "Actual public website metadata imported through DNS-pinned inspection",
      );
    }
    await page.getByLabel("Project name", { exact: true }).fill(name);
    await page
      .getByLabel("What is the offer?", { exact: true })
      .fill(
        "A local end-to-end verification project. Never publish this fixture.",
      );
    await page
      .getByLabel("Who is it for?", { exact: true })
      .fill("The operator testing project isolation");
    await page
      .getByLabel("Monthly advertising allowance — separate from software", {
        exact: true,
      })
      .fill("10");
    await page
      .getByLabel("Confirmed product facts — one per line")
      .fill(
        "This project is a local verification fixture.\nIt is isolated from the production database.\nPublic publishing is disabled.",
      );
    await page
      .getByLabel(
        "I confirm the product facts, offer and usage rights are accurate.",
      )
      .check();
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const tokenSection = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Save the server conversion token",
      }),
    });
    const token = await tokenSection.locator("code").innerText();
    await page.getByRole("button", { name: "I have saved it" }).click();
    const projectId = await page
      .getByRole("combobox", { name: "Current project" })
      .inputValue();
    return { projectId, token };
  }

  const first = await addProject(alpha, true);
  await page
    .getByLabel("Connected account", { exact: true })
    .selectOption({ label: `X · Local fixture X Alpha ${run}` });
  await page
    .getByLabel("Channel mode", { exact: true })
    .selectOption("automatic");
  await page.getByLabel(/I authorise this account/).check();
  await page.getByRole("button", { name: "Save channel policy" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: `Local fixture X Alpha ${run}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Content & calendar", exact: true })
    .click();
  await page.getByRole("button", { name: "Prepare first / next week" }).click();
  await expect(page.locator("article")).toHaveCount(3);
  const firstDraft = page.locator("article").first();
  await firstDraft.getByText("Edit draft", { exact: true }).click();
  await firstDraft
    .getByLabel("Draft title", { exact: true })
    .fill("Reviewed local fixture title");
  await firstDraft
    .getByLabel("Draft content", { exact: true })
    .fill(
      "A revised local fixture. Publishing remains disabled. https://media-engine-seven.vercel.app/",
    );
  await firstDraft.getByRole("button", { name: "Save draft version" }).click();
  await expect(
    page.getByRole("heading", { name: "Reviewed local fixture title" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve exact version" })
    .first()
    .click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  checks.push(
    "UI creates a real project, channel policy, weekly drafts, a reviewed draft version and an immutable approval in local Convex",
  );
  // Ads account access itself remains an explicit LOCAL fixture. The UI below
  // exercises a local campaign proposal only; no provider is contacted.
  const setup = (await client.action(gateway, {
    serviceToken: process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!,
    operation: "listWorkspace",
    payload: { projectId: first.projectId },
  })) as { accounts: Array<{ _id: string; providerAccountId: string }> };
  const google = setup.accounts.find(
    (account) => account.providerAccountId === `fixture-google-${run}`,
  )!;
  await client.action(gateway, {
    serviceToken: process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!,
    operation: "saveChannel",
    payload: {
      projectId: first.projectId,
      accountId: google._id,
      mode: "automatic",
      communityApproved: false,
      adAccountId: "123456",
      authorisedUntil: Date.now() + 86_400_000,
    },
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("Prepare a Google Search or Meta website campaign", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Headline — maximum 30 characters for Search")
    .fill("A truthful fixture");
  await page
    .getByLabel("Description — maximum 90 characters for Search")
    .fill("A local campaign proposal. No ads run.");
  await page
    .getByLabel("Google keywords — comma separated")
    .fill("local fixture");
  await page
    .getByLabel("Target countries — country codes, comma separated")
    .fill("US");
  await page.getByLabel("Daily budget (USD)").fill("1");
  await page.getByLabel("Duration in days").fill("1");
  await page.getByRole("button", { name: "Save campaign proposal" }).click();
  await expect(page.locator("article")).toHaveCount(4);
  await expect(
    page.getByText("Budget and duration", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/\$4.00 maximum admitted exposure/),
  ).toBeVisible();
  checks.push(
    "UI previews the actual local Search template, targeting and conservative exposure; no advertising is activated",
  );
  // Explicit local database fixture for a stopped campaign. This is not a
  // provider status proof or a real invoice, and never calls the publisher.
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/marketing") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Start project automation" }).click(),
  ]);
  await page
    .getByRole("button", { name: "Content & calendar", exact: true })
    .click();
  await page
    .locator("article")
    .filter({ hasText: "Paid campaign" })
    .getByRole("button", { name: "Approve exact version" })
    .click();
  await expect(page.getByText("approved", { exact: true })).toHaveCount(2);
  const stored = await (
    await context.request.get(`/api/marketing?projectId=${first.projectId}`)
  ).json();
  const proposal = stored.items.find(
    (item: { kind: string }) => item.kind === "ad",
  );
  const invoke = (operation: string, payload: unknown) =>
    client.action(gateway, {
      serviceToken: process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!,
      operation,
      payload,
    });
  await invoke("claimItem", {
    projectId: first.projectId,
    itemId: proposal._id,
    workerRunId: `local-fixture-${run}`,
  });
  await invoke("recordOutcome", {
    projectId: first.projectId,
    itemId: proposal._id,
    status: "paused",
    providerId: `fixture-ad-${run}`,
    providerCampaignId: `fixture-campaign-${run}`,
    providerStatusReadAt: Date.now(),
    metrics: {
      impressions: 0,
      clicks: 0,
      spendMinor: 0,
      currency: "USD",
      capturedAt: Date.now(),
    },
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("Reconcile final advertising billing", { exact: true })
    .click();
  await page
    .getByLabel("Final platform invoice reference")
    .fill(`LOCAL-FIXTURE-INVOICE-${run}`);
  await page.getByLabel(/I reviewed the final platform invoice/).check();
  await page
    .getByRole("button", {
      name: "Record final invoice and release unused hold",
    })
    .click();
  await expect(
    page.getByText(
      new RegExp(
        `Operator-confirmed final invoice: LOCAL-FIXTURE-INVOICE-${run}`,
      ),
    ),
  ).toBeVisible();
  checks.push(
    "Local UI records a fixture final-invoice confirmation and releases its unused exposure without external financial execution",
  );
  await page.screenshot({
    path: `${proof}/desktop-content.png`,
    fullPage: true,
  });

  const second = await addProject(beta, false);
  await page
    .getByRole("button", { name: "Content & calendar", exact: true })
    .click();
  await expect(page.locator("article")).toHaveCount(0);
  const snapshot = await (
    await context.request.get(`/api/marketing?projectId=${second.projectId}`)
  ).json();
  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.channels.length, 0);
  assert(!JSON.stringify(snapshot).includes("conversionTokenHash"));
  assert.equal(snapshot.readiness.publishingEnabled, false);
  assert.equal(snapshot.readiness.advertisingEnabled, false);
  checks.push(
    "Second project has independent channels/content; conversion credential digests remain private",
  );

  const event = {
    projectId: second.projectId,
    eventId: `signup-${run}`,
    event: "signup",
    valueMinor: 0,
    currency: "USD",
    occurredAt: Date.now(),
  };
  const conversion = await context.request.post("/api/marketing/conversions", {
    headers: { authorization: `Bearer ${second.token}` },
    data: event,
  });
  assert.equal(conversion.status(), 200);
  const duplicate = await context.request.post("/api/marketing/conversions", {
    headers: { authorization: `Bearer ${second.token}` },
    data: event,
  });
  assert.equal((await duplicate.json()).reused, true);
  const foreign = await context.request.post("/api/marketing/conversions", {
    headers: { authorization: `Bearer ${second.token}` },
    data: { ...event, projectId: first.projectId },
  });
  assert.equal(foreign.status(), 400);
  checks.push(
    "Real HTTP conversion intake deduplicates events and rejects another project's credential",
  );
  const privateInspection = await context.request.post(
    "/api/marketing/inspect",
    { data: { url: "https://127.0.0.1/" } },
  );
  assert.equal(privateInspection.status(), 400);
  checks.push("Private-address URL inspection is blocked");

  await page.getByRole("button", { name: "Results", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Verified conversions this month", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${proof}/desktop-results.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${proof}/mobile-results.png`,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile content must not overflow horizontally",
  );
  checks.push("Desktop/mobile results render without horizontal overflow");

  await page
    .getByRole("combobox", { name: "Current project" })
    .selectOption(first.projectId);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: alpha, exact: true }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/marketing") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Pause & cancel queue" }).click(),
  ]);
  const paused = await (
    await context.request.get(`/api/marketing?projectId=${first.projectId}`)
  ).json();
  assert(
    paused.items.every((item: { status: string }) =>
      ["cancelled", "paused"].includes(item.status),
    ),
  );
  assert.equal(
    paused.projects.find(
      (project: { _id: string }) => project._id === first.projectId,
    ).openItemCount,
    0,
  );
  checks.push(
    "Pause atomically cancels local approved/draft work without remote calls",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${proof}/local-e2e.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        localBackend: backend,
        projects: [first.projectId, second.projectId],
        checks,
        browserErrors: errors,
        providerQualification:
          "NOT EXERCISED; local provider-account fixtures only",
        paidOrPublicWrites: 0,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks, proof }));
} finally {
  await browser.close();
}
