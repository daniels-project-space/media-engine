import { z } from "zod";

import {
  CREATOR_PROMOTION_PROVIDERS,
  CreatorPromotionProviderSchema,
  type CreatorPromotionProvider,
} from "./contracts";

/**
 * Static, secret-safe provider readiness checks. These checks do not make a
 * network request and deliberately return a non-ready state when a required
 * secret, callback URL, API version, or server credential resolver is absent.
 */

export const ProviderConfigurationStatusSchema = z.enum([
  "ready",
  "not_configured",
  "misconfigured",
]);
export type ProviderConfigurationStatus = z.infer<typeof ProviderConfigurationStatusSchema>;

export const ProviderConfigHealthSchema = z
  .object({
    provider: CreatorPromotionProviderSchema,
    status: ProviderConfigurationStatusSchema,
    canConnectAccounts: z.boolean(),
    canDispatchApprovedActions: z.boolean(),
    missing: z.array(z.string()).readonly(),
    invalid: z.array(z.string()).readonly(),
    notes: z.array(z.string()).readonly(),
  })
  .strict();
export type ProviderConfigHealth = z.infer<typeof ProviderConfigHealthSchema>;

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export const META_INSTAGRAM_CONFIG_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_API_VERSION",
  "META_OAUTH_REDIRECT_URI",
  "META_WEBHOOK_VERIFY_TOKEN",
  /** Reference to a server-only vault lookup, never an access token itself. */
  "META_ACCESS_TOKEN_RESOLVER",
] as const;

/**
 * The only token resolver understood by the Creator Promotion Meta worker.
 * It is an opaque deployment setting, never an access token, and keeps the
 * per-connection credential in Media Engine's server-only account vault.
 */
export const META_INSTAGRAM_VAULT_TOKEN_RESOLVER = "media-engine-accounts:v1";

/** A publish worker needs no OAuth client secret: it resolves an already-issued
 * per-account token from the server vault immediately before the request. */
export const META_INSTAGRAM_DISPATCH_CONFIG_KEYS = [
  "META_GRAPH_API_VERSION",
  "META_ACCESS_TOKEN_RESOLVER",
] as const;

export const FANVUE_CONFIG_KEYS = [
  "FANVUE_CLIENT_ID",
  "FANVUE_CLIENT_SECRET",
  "FANVUE_API_VERSION",
  "FANVUE_OAUTH_REDIRECT_URI",
  "FANVUE_WEBHOOK_SIGNING_SECRET",
  /** Keeps all provider writes behind the approved server worker. */
  "FANVUE_APPROVED_DISPATCHER",
  /** Reference to a server-only OAuth-token lookup, never an access token. */
  "FANVUE_ACCESS_TOKEN_RESOLVER",
] as const;

export const POSTIZ_CONFIG_KEYS = [
  /** Keeps the scheduler behind the approved server dispatcher. */
  "POSTIZ_APPROVED_DISPATCHER",
  /** Opaque declaration that the worker reads the fixed `postiz` vault bucket. */
  "POSTIZ_API_KEY_RESOLVER",
] as const;

/** Server-only Postiz credentials live in vault service `postiz`, never in a browser or Trigger env. */
export const POSTIZ_VAULT_API_KEY_RESOLVER = "postiz:v1";
/** Per-connection Fanvue OAuth access tokens live in the approved account vault. */
export const FANVUE_VAULT_TOKEN_RESOLVER = "fanvue:account-v1";

/** Official, fixed upstream origins. They are not configurable at runtime. */
export const OFFICIAL_PROVIDER_ORIGINS = {
  metaGraph: "https://graph.facebook.com",
  fanvueApi: "https://api.fanvue.com",
  fanvueOAuth: "https://auth.fanvue.com",
} as const;

export function checkMetaInstagramProviderHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  const missing = requiredValues(env, META_INSTAGRAM_CONFIG_KEYS);
  const invalid: string[] = [];

  const version = valueOf(env, "META_GRAPH_API_VERSION");
  if (version && !/^v\d+\.\d+$/.test(version)) {
    invalid.push("META_GRAPH_API_VERSION must look like vNN.NN");
  }
  validateCallbackUrl(valueOf(env, "META_OAUTH_REDIRECT_URI"), "META_OAUTH_REDIRECT_URI", env, invalid);
  validateOpaqueResolver(valueOf(env, "META_ACCESS_TOKEN_RESOLVER"), "META_ACCESS_TOKEN_RESOLVER", invalid);
  if (valueOf(env, "META_ACCESS_TOKEN_RESOLVER") && valueOf(env, "META_ACCESS_TOKEN_RESOLVER") !== META_INSTAGRAM_VAULT_TOKEN_RESOLVER) {
    invalid.push(`META_ACCESS_TOKEN_RESOLVER must equal ${META_INSTAGRAM_VAULT_TOKEN_RESOLVER}`);
  }
  validateSecret(valueOf(env, "META_APP_SECRET"), "META_APP_SECRET", invalid, 16);
  validateSecret(valueOf(env, "META_WEBHOOK_VERIFY_TOKEN"), "META_WEBHOOK_VERIFY_TOKEN", invalid, 16);

  const health = createHealth("meta_instagram", missing, invalid, [
    "Only official OAuth-connected Professional Instagram accounts are supported.",
    "Per-account access tokens must be resolved by a server-only credential resolver.",
    "Creator Promotion records OAuth connection intent only; the verified OAuth callback remains a separately operated server boundary.",
  ]);
  // This workspace deliberately has no browser OAuth callback. It may dispatch
  // only accounts whose official connection metadata was completed by that
  // separate trusted boundary.
  return { ...health, canConnectAccounts: false };
}

/**
 * Narrow worker gate for an already connected official account. The worker
 * does not need OAuth client credentials, but it does require an explicit API
 * version and the fixed server-only resolver contract.
 */
export function checkMetaInstagramApprovedDispatchHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  const missing = requiredValues(env, META_INSTAGRAM_DISPATCH_CONFIG_KEYS);
  const invalid: string[] = [];
  const version = valueOf(env, "META_GRAPH_API_VERSION");
  if (version && !/^v\d+\.\d+$/.test(version)) {
    invalid.push("META_GRAPH_API_VERSION must look like vNN.NN");
  }
  const resolver = valueOf(env, "META_ACCESS_TOKEN_RESOLVER");
  validateOpaqueResolver(resolver, "META_ACCESS_TOKEN_RESOLVER", invalid);
  if (resolver && resolver !== META_INSTAGRAM_VAULT_TOKEN_RESOLVER) {
    invalid.push(`META_ACCESS_TOKEN_RESOLVER must equal ${META_INSTAGRAM_VAULT_TOKEN_RESOLVER}`);
  }
  const health = createHealth("meta_instagram", missing, invalid, [
    "Dispatch is limited to an already connected official Professional Instagram account.",
    "The worker resolves the access token from the server-only Media Engine account vault at request time.",
  ]);
  return { ...health, canConnectAccounts: false };
}

export function checkFanvueProviderHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  const missing = requiredValues(env, FANVUE_CONFIG_KEYS);
  const invalid: string[] = [];

  const version = valueOf(env, "FANVUE_API_VERSION");
  if (version && !/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    invalid.push("FANVUE_API_VERSION must use the documented YYYY-MM-DD format");
  }
  validateCallbackUrl(valueOf(env, "FANVUE_OAUTH_REDIRECT_URI"), "FANVUE_OAUTH_REDIRECT_URI", env, invalid);
  const resolver = valueOf(env, "FANVUE_ACCESS_TOKEN_RESOLVER");
  validateOpaqueResolver(resolver, "FANVUE_ACCESS_TOKEN_RESOLVER", invalid);
  if (resolver && resolver !== FANVUE_VAULT_TOKEN_RESOLVER) {
    invalid.push(`FANVUE_ACCESS_TOKEN_RESOLVER must equal ${FANVUE_VAULT_TOKEN_RESOLVER}`);
  }
  if (valueOf(env, "FANVUE_APPROVED_DISPATCHER") && valueOf(env, "FANVUE_APPROVED_DISPATCHER") !== "server_only") {
    invalid.push("FANVUE_APPROVED_DISPATCHER must equal server_only");
  }
  validateSecret(valueOf(env, "FANVUE_CLIENT_SECRET"), "FANVUE_CLIENT_SECRET", invalid, 16);
  validateSecret(valueOf(env, "FANVUE_WEBHOOK_SIGNING_SECRET"), "FANVUE_WEBHOOK_SIGNING_SECRET", invalid, 16);

  const health = createHealth("fanvue", missing, invalid, [
    "Fanvue uses OAuth access tokens; no API key or account password is accepted by this integration boundary.",
    "Each creator connection resolves its OAuth token from the fixed server-only account vault bucket.",
    "Only individually approved tracking-link creation is installed; messages, posts, payments, and account creation remain outside this worker.",
  ]);
  return {
    ...health,
    canDispatchApprovedActions: health.status === "ready" && valueOf(env, "CREATOR_FANVUE_TRACKING_LINKS_ENABLED") === "true",
  };
}

/** Narrow worker gate. The explicit environment gate controls Fanvue writes. */
export function checkFanvueApprovedDispatchHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  return checkFanvueProviderHealth(env);
}

export function checkPostizProviderHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  const missing = requiredValues(env, POSTIZ_CONFIG_KEYS);
  const invalid: string[] = [];
  const resolver = valueOf(env, "POSTIZ_API_KEY_RESOLVER");
  validateOpaqueResolver(resolver, "POSTIZ_API_KEY_RESOLVER", invalid);
  if (resolver && resolver !== POSTIZ_VAULT_API_KEY_RESOLVER) {
    invalid.push(`POSTIZ_API_KEY_RESOLVER must equal ${POSTIZ_VAULT_API_KEY_RESOLVER}`);
  }
  if (valueOf(env, "POSTIZ_APPROVED_DISPATCHER") && valueOf(env, "POSTIZ_APPROVED_DISPATCHER") !== "server_only") {
    invalid.push("POSTIZ_APPROVED_DISPATCHER must equal server_only");
  }

  const health = createHealth("postiz", missing, invalid, [
    "Postiz is optional and may only receive scheduled content through the approved server dispatcher.",
    "POSTIZ_URL and POSTIZ_API_KEY are resolved from the fixed server-only `postiz` vault bucket.",
    "Each dispatch reconciles its frozen integration ID against Postiz before media upload or scheduling.",
  ]);
  return {
    ...health,
    // The explicit gate controls only side effects. It should not make an
    // operator unable to connect or inspect accounts in Postiz.
    canDispatchApprovedActions: health.status === "ready" && valueOf(env, "CREATOR_POSTIZ_SCHEDULE_ENABLED") === "true",
  };
}

/**
 * Narrow worker gate. Vault credentials are intentionally checked only inside
 * the server worker, immediately before the official Postiz request.
 */
export function checkPostizApprovedDispatchHealth(
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  return checkPostizProviderHealth(env);
}

export function checkCreatorPromotionProviderHealth(
  provider: CreatorPromotionProvider,
  env: ProviderEnvironment = process.env,
): ProviderConfigHealth {
  switch (provider) {
    case "meta_instagram":
      return checkMetaInstagramProviderHealth(env);
    case "fanvue":
      return checkFanvueProviderHealth(env);
    case "postiz":
      return checkPostizProviderHealth(env);
  }
}

export function checkAllCreatorPromotionProviders(
  env: ProviderEnvironment = process.env,
): Record<CreatorPromotionProvider, ProviderConfigHealth> {
  return Object.fromEntries(
    CREATOR_PROMOTION_PROVIDERS.map((provider) => [
      provider,
      checkCreatorPromotionProviderHealth(provider, env),
    ]),
  ) as Record<CreatorPromotionProvider, ProviderConfigHealth>;
}

/** A dispatcher must call this before accepting any provider side effect. */
export function isProviderReadyForApprovedDispatch(health: ProviderConfigHealth): boolean {
  return health.status === "ready" && health.canDispatchApprovedActions;
}

function createHealth(
  provider: CreatorPromotionProvider,
  missing: string[],
  invalid: string[],
  notes: string[],
): ProviderConfigHealth {
  const status: ProviderConfigurationStatus = invalid.length > 0
    ? "misconfigured"
    : missing.length > 0
      ? "not_configured"
      : "ready";

  return {
    provider,
    status,
    canConnectAccounts: status === "ready",
    canDispatchApprovedActions: status === "ready",
    missing,
    invalid,
    notes,
  };
}

function requiredValues(env: ProviderEnvironment, keys: readonly string[]): string[] {
  return keys.filter((key) => !valueOf(env, key));
}

function valueOf(env: ProviderEnvironment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function validateSecret(
  value: string | undefined,
  name: string,
  invalid: string[],
  minimumLength: number,
): void {
  if (value && value.length < minimumLength) {
    invalid.push(`${name} is unexpectedly short`);
  }
}

function validateOpaqueResolver(value: string | undefined, name: string, invalid: string[]): void {
  if (value && !/^[A-Za-z0-9_.:-]{3,160}$/.test(value)) {
    invalid.push(`${name} must be a server-side resolver identifier, not a URL or token`);
  }
}

function validateCallbackUrl(
  value: string | undefined,
  name: string,
  env: ProviderEnvironment,
  invalid: string[],
): void {
  if (!value) return;
  try {
    const url = new URL(value);
    const isLocalDevelopment = env.NODE_ENV !== "production" && isLocalHost(url.hostname);
    if (url.protocol !== "https:" && !isLocalDevelopment) {
      invalid.push(`${name} must use HTTPS outside local development`);
    }
    if (url.username || url.password || url.search || url.hash) {
      invalid.push(`${name} must not contain credentials, a query string, or a fragment`);
    }
  } catch {
    invalid.push(`${name} must be a valid URL`);
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
