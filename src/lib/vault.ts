const VAULT_URL = "https://fantastic-roadrunner-485.convex.cloud";

export async function vaultService(service: string): Promise<Record<string, string>> {
  const r = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "secrets:listByService",
      args: { service },
      format: "json",
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`vault ${service}: HTTP ${r.status}`);
  const { value } = (await r.json()) as {
    value: { keyName: string; value: string }[];
  };
  return Object.fromEntries((value ?? []).map((s) => [s.keyName, s.value]));
}

export async function vaultKey(service: string, keyName: string): Promise<string> {
  const keys = await vaultService(service);
  const v = keys[keyName];
  if (!v) throw new Error(`vault ${service}/${keyName}: not found`);
  return v;
}
