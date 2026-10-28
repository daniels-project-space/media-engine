import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MARKETING_PLATFORMS = [
  "instagram",
  "x",
  "reddit",
  "googleads",
  "metaads",
] as const;
export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];
export type MarketingMode = "off" | "draft" | "automatic";
export const MAX_PROJECTS = 50;
export const MAX_CHANNELS = 10;
export const MAX_CONTENT_ROWS = 200;
export const INTEGRATION_LIMIT_USD_CENTS = 3_000;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function snapshotHash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(stableJson(value))));
}

export function money(value: number, name = "allowance"): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000)
    throw new Error(
      `${name} must be non-negative integer minor currency units`,
    );
  return value;
}

export function text(value: string, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`${name} is required (maximum ${max} characters)`);
  return value.trim();
}

export function website(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !url.hostname.includes(".") ||
    /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(url.hostname) ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":")
  )
    throw new Error(
      "Use a public HTTPS website without credentials, fragments or custom ports",
    );
  return url.toString();
}

export function monthKey(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** Current graduated pricing; refreshed from provider evidence before activation. */
export function integrationBaseMinor(accountCount: number): number {
  if (
    !Number.isSafeInteger(accountCount) ||
    accountCount < 0 ||
    accountCount > 2_000
  )
    throw new Error("Provider account inventory is invalid");
  return (
    Math.max(0, Math.min(accountCount, 10) - 2) * 600 +
    Math.max(0, Math.min(accountCount, 100) - 10) * 300 +
    Math.max(0, accountCount - 100) * 100
  );
}

/** Conservative rounding in USD cents, including the separate X URL-write rate. */
export function publishCostMinor(
  platform: MarketingPlatform,
  content: string,
): number {
  return platform === "x" ? (/https?:\/\//i.test(content) ? 20 : 2) : 0;
}

export function assertAvailable(
  limit: number,
  spent: number,
  held: number,
  requested: number,
): void {
  [limit, spent, held, requested].forEach((value) => money(value));
  if (spent + held + requested > limit)
    throw new Error("Allowance exhausted; no external action was admitted");
}

export function accountPlatform(value: string): MarketingPlatform {
  const mapped =
    value === "twitter"
      ? "x"
      : value === "google"
        ? "googleads"
        : value === "facebook-ads"
          ? "metaads"
          : value;
  if (!(MARKETING_PLATFORMS as readonly string[]).includes(mapped))
    throw new Error("Unsupported marketing account platform");
  return mapped as MarketingPlatform;
}

export function assertOwned(
  projectId: string,
  record: { projectId: string } | null | undefined,
): void {
  if (!record || record.projectId !== projectId)
    throw new Error("Resource does not belong to this marketing project");
}

export function trackingUrl(
  url: string,
  projectId: string,
  campaignId: string,
  source: string,
): string {
  const parsed = new URL(website(url));
  parsed.searchParams.set("utm_source", source);
  parsed.searchParams.set(
    "utm_medium",
    source === "googleads" || source === "metaads" ? "paid" : "social",
  );
  parsed.searchParams.set("utm_campaign", campaignId);
  parsed.searchParams.set("utm_content", projectId);
  return parsed.toString();
}

export function safeAssetKey(projectId: string, key: string): string {
  if (
    !key.startsWith(`marketing/${projectId}/`) ||
    key.includes("..") ||
    key.includes("\\") ||
    key.length > 500 ||
    /[\u0000-\u001f]/.test(key)
  )
    throw new Error("Media must belong to this project's controlled R2 assets");
  return key;
}

/** Find a proposed local publication time in the project's timezone; account for DST offsets. */
export function localPublicationTime(
  now: number,
  dayOffset: number,
  timezone: string,
  localTime = "09:00",
): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime))
    throw new Error("Publication time must use 24-hour HH:MM format");
  const [hour, minute] = localTime.split(":").map(Number);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value]),
  );
  const target = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + dayOffset,
    hour,
    minute,
  );
  let candidate = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(candidate)
        .map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    candidate += target - observed;
  }
  return candidate > now + 5 * 60_000
    ? candidate
    : localPublicationTime(now, dayOffset + 1, timezone, localTime);
}

/** Free, explicitly labelled brand templates. No model or fabricated claims. */
export function composeBrandPost(
  project: {
    name: string;
    offer: string;
    audience: string;
    facts: string[];
    website: string;
    goal: "signup" | "lead" | "purchase";
  },
  platform: "instagram" | "x" | "reddit",
  ordinal: number,
  url: string,
) {
  const fact = project.facts[ordinal % project.facts.length];
  const introductions = [
    `Meet ${project.name}`,
    `A closer look at ${project.name}`,
    `Explore ${project.name}`,
    `${project.name}: the details`,
    `For people exploring ${project.name}`,
    `Discover the offer from ${project.name}`,
    `This week at ${project.name}`,
  ];
  const title = introductions[ordinal % introductions.length];
  if (platform === "x") {
    const full = `${title}\n\n${fact}\n\n${url}`;
    return {
      title,
      content:
        full.length <= 280
          ? full
          : `${project.name}\n\nExplore the offer:\n${url}`,
    };
  }
  if (platform === "reddit")
    return {
      title,
      content: `${project.name} is our project for ${project.audience}.\n\n${project.offer}\n\n${fact}\n\nDetails: ${url}\n\nDisclosure: we are promoting our own project.`,
    };
  return { title, content: `${title}\n\n${fact}\n\nExplore the offer: ${url}` };
}
