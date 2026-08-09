const VAULT_URL = "https://fantastic-roadrunner-485.convex.cloud";

// This process is intentionally not a general Project Hub vault client. Keep
// this list small and local to Media Engine so persisted/user-controlled data
// cannot turn a vault lookup into a cross-project secret read. In particular,
// `openai` is deliberately not a capability of this runtime.
export const VAULT_SERVICES = [
  "ayrshare",
  "cloudflare",
  "dataforseo",
  "elevenlabs",
  "fal",
  "media-engine",
  "media-engine-accounts",
  "microlink",
  "modash",
  "postiz",
  "resend",
  "serper",
  "shopify",
  "smartlead",
  "stripe",
  "trigger",
] as const;

export type VaultService = (typeof VAULT_SERVICES)[number];

const VAULT_SERVICE_SET = new Set<string>(VAULT_SERVICES);

export function vaultServiceName(service: string): VaultService {
  if (VAULT_SERVICE_SET.has(service)) return service as VaultService;
  throw new Error(`vault service is not permitted for media-engine: ${service}`);
}

// Social account records are editable persisted data. They may only select
// Media Engine's account-token bucket, never an arbitrary central-vault
// service. Missing is kept backward compatible with the historical default.
export function accountTokenVaultService(service: string | undefined): "media-engine-accounts" {
  if (service === undefined || service === "media-engine-accounts") return "media-engine-accounts";
  throw new Error("account token service is not permitted for media-engine");
}

export async function vaultService(service: VaultService): Promise<Record<string, string>> {
  // Retain a runtime check as TypeScript types do not protect deployed JSON or
  // future JavaScript callers.
  const permittedService = vaultServiceName(service);
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const r = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "secrets:listByService",
      args: { service: permittedService, vaultToken },
      format: "json",
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`vault ${permittedService}: HTTP ${r.status}`);
  const { value } = (await r.json()) as {
    value: { keyName: string; value: string }[];
  };
  return Object.fromEntries((value ?? []).map((s) => [s.keyName, s.value]));
}

export async function vaultKey(service: VaultService, keyName: string): Promise<string> {
  const keys = await vaultService(service);
  const v = keys[keyName];
  if (!v) throw new Error(`vault ${service}/${keyName}: not found`);
  return v;
}

export type VaultCredentialBundle = { value: string; revision: number };

let higgsfieldCapabilityCheck: Promise<void> | null = null;

/**
 * The durable renderer session must never be read with a root or wildcard Vault
 * bearer. Verify the deployed credential once per process before touching the
 * fixed OAuth bundle; a misconfigured deployment fails closed instead.
 */
async function verifyHiggsfieldVaultCapability(): Promise<void> {
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const response = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "vaultAuth:whoami", args: { vaultToken }, format: "json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("vault media-engine capability check failed");
  const result = (await response.json()) as { value?: unknown };
  const identity = result.value as { name?: unknown; canWrite?: unknown; services?: unknown } | undefined;
  if (
    !identity ||
    identity.name !== "media-engine" ||
    identity.canWrite !== true ||
    !Array.isArray(identity.services) ||
    !identity.services.includes("higgsfield") ||
    identity.services.some((policy) => typeof policy !== "string" || policy.includes("*"))
  ) {
    throw new Error("VAULT_ACCESS_TOKEN is not the required scoped media-engine Higgsfield capability");
  }
}

async function requireHiggsfieldVaultCapability(): Promise<void> {
  if (!higgsfieldCapabilityCheck) {
    higgsfieldCapabilityCheck = verifyHiggsfieldVaultCapability().catch((error) => {
      higgsfieldCapabilityCheck = null;
      throw error;
    });
  }
  await higgsfieldCapabilityCheck;
}

async function vaultBundleCall<T>(
  kind: "query" | "mutation",
  path: "secrets:getCredentialBundle" | "secrets:rotateCredentialBundle",
  args: Record<string, unknown>,
): Promise<T> {
  await requireHiggsfieldVaultCapability();
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const response = await fetch(`${VAULT_URL}/api/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args: { ...args, vaultToken }, format: "json" }),
    cache: "no-store",
  });
  if (!response.ok) {
    // Provider error bodies can contain internal policy details. The caller
    // only needs the safe status to decide whether to surface a reconnect.
    throw new Error(`vault credential bundle ${path}: HTTP ${response.status}`);
  }
  const result = (await response.json()) as { value?: T };
  if (!("value" in result)) throw new Error(`vault credential bundle ${path}: malformed response`);
  return result.value as T;
}

/** Reads only Media Engine's fixed Higgsfield MCP OAuth bundle and CAS revision. */
export async function vaultHiggsfieldSession(): Promise<VaultCredentialBundle | null> {
  const value = await vaultBundleCall<unknown>("query", "secrets:getCredentialBundle", {});
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { value?: unknown }).value !== "string" ||
    typeof (value as { revision?: unknown }).revision !== "number"
  ) {
    throw new Error("vault Higgsfield session: malformed response");
  }
  return value as VaultCredentialBundle;
}

/**
 * Rotates the complete MCP token bundle under compare-and-swap. This deliberately
 * has no generic service/key API: a renderer can never use it to overwrite an
 * unrelated credential.
 */
export async function rotateHiggsfieldSession(value: string, expectedRevision: number | null): Promise<{ created: boolean; revision: number }> {
  if (!value || Buffer.byteLength(value, "utf8") > 32 * 1024) {
    throw new Error("vault Higgsfield session: refusing an empty or oversized bundle");
  }
  const result = await vaultBundleCall<unknown>("mutation", "secrets:rotateCredentialBundle", { value, expectedRevision });
  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as { created?: unknown }).created !== "boolean" ||
    typeof (result as { revision?: unknown }).revision !== "number"
  ) {
    throw new Error("vault Higgsfield session: malformed rotation response");
  }
  return result as { created: boolean; revision: number };
}
