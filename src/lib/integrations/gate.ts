import { ConvexHttpClient } from "convex/browser";
import type { VaultService } from "../vault";
import { api } from "../../../convex/_generated/api";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// ─────────────────────────────────────────────────────────────────────────────
// Live/dry-run gate. Every outward side-effect (posting, emailing, minting a
// discount, DMing an influencer) routes through an adapter that first asks
// `isLive()`. Default is DRY-RUN: the action is simulated and logged, nothing
// leaves the building. It flips live only when the `liveMode` setting is true.
// A missing integration key ALSO forces dry-run (adapters call `haveKey`).
// This is the master safety switch for the whole ad-agency spine.
// ─────────────────────────────────────────────────────────────────────────────

export type GateResult<T = unknown> = {
  /** true = simulated, no external call made */
  dryRun: boolean;
  /** false = a hard failure (missing config, bad response) */
  ok: boolean;
  /** human-readable "what happened / what would happen" */
  detail: string;
  data?: T;
  costPence?: number;
};

let cached: { at: number; live: boolean } | null = null;

/** Global live switch. Cached 30s to avoid hammering Convex from tight loops. */
export async function isLive(): Promise<boolean> {
  if (process.env.MEDIA_ENGINE_FORCE_DRYRUN === "1") return false;
  const now = Date.now();
  if (cached && now - cached.at < 30_000) return cached.live;
  try {
    const client = new ConvexHttpClient(CONVEX_URL);
    const row = await client.query(api.settings.all, {});
    const live = Boolean((row as Record<string, unknown>)?.liveMode);
    cached = { at: now, live };
    return live;
  } catch {
    // Fail CLOSED: if we can't confirm live mode, stay in dry-run (safe default).
    return false;
  }
}

/** Read a service's secrets from the vault, returning {} instead of throwing. */
export async function vaultTry(
  service: VaultService,
): Promise<Record<string, string>> {
  try {
    const { vaultService } = await import("../vault");
    return await vaultService(service);
  } catch {
    return {};
  }
}

/** Convenience: a simulated (dry-run) success result. */
export function simulated<T = never>(detail: string, data?: T, costPence = 0): GateResult<T> {
  return { dryRun: true, ok: true, detail: `[dry-run] ${detail}`, data, costPence };
}

/** Convenience: a "cannot run — missing config" blocked result (still dry-run). */
export function blocked<T = never>(detail: string): GateResult<T> {
  return { dryRun: true, ok: false, detail: `[blocked] ${detail}` };
}

/** Convenience: a live success result. */
export function live<T = never>(detail: string, data?: T, costPence = 0): GateResult<T> {
  return { dryRun: false, ok: true, detail, data, costPence };
}
