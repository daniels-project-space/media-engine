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
  "higgsfield",
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

type VaultWritableKey = "HIGGSFIELD_ACCESS_TOKEN" | "HIGGSFIELD_REFRESH_TOKEN";

// The sole Media Engine vault mutation is the rotation of its own Higgsfield
// pair. Do not expose a generic vault writer: it could create or overwrite a
// provider credential outside this project's authority.
export async function vaultSet(
  service: "higgsfield",
  keyName: VaultWritableKey,
  value: string,
): Promise<void> {
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const listRes = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service, vaultToken }, format: "json" }),
  });
  const { value: rows } = (await listRes.json()) as { value: { _id: string; keyName: string }[] };
  for (const row of rows ?? []) {
    if (row.keyName === keyName) {
      await fetch(`${VAULT_URL}/api/mutation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "secrets:deleteOne", args: { id: row._id, vaultToken }, format: "json" }),
      });
    }
  }
  await fetch(`${VAULT_URL}/api/mutation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "secrets:bulkInsert",
      args: { vaultToken, items: [{ service, keyName, value, scopes: ["media-engine"], aliases: [], sourceFiles: [] }] },
      format: "json",
    }),
  });
}
