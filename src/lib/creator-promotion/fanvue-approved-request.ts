import { z } from "zod";

import { vaultService } from "../vault";
import {
  authorizeActionForAccount,
  requiredCapabilitiesForAction,
  type ProviderAccountCapabilityGrant,
  type VerifiedApprovedCreatorPromotionAction,
  verifyApprovedCreatorPromotionAction,
} from "./contracts";
import {
  FANVUE_SYSTEM_OAUTH_SCOPES,
  fanvueScopesForCapabilities,
} from "./fanvue-oauth-readiness";
import {
  checkFanvueApprovedDispatchHealth,
  FANVUE_VAULT_TOKEN_RESOLVER,
  isProviderReadyForApprovedDispatch,
  type ProviderConfigHealth,
  type ProviderEnvironment,
} from "./provider-health";

/**
 * Server-only Fanvue request builder.
 *
 * This module never exposes a browser-callable action. A trusted audited
 * worker may turn a descriptor into one HTTP request only after it claims an
 * individually approved ledger entry. The fixed base URL and request paths
 * below are official Fanvue REST endpoints.
 */

export const FANVUE_API_ORIGIN = "https://api.fanvue.com";
export const FANVUE_DEFAULT_API_VERSION = "2025-06-26";

export const FanvueApiVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type FanvueApiVersion = z.infer<typeof FanvueApiVersionSchema>;

const FanvueConnectionIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

declare const serverProvidedFanvueAccessToken: unique symbol;
/** Opaque token accepted only after a server-runtime check. */
export type ServerProvidedFanvueAccessToken = string & {
  readonly [serverProvidedFanvueAccessToken]: true;
};

/**
 * Converts a token obtained by a server-side OAuth credential resolver into
 * an opaque token. This module never reads access tokens from browser input,
 * process environment, local storage, or a password field.
 */
export function requireServerProvidedFanvueAccessToken(
  value: unknown,
): ServerProvidedFanvueAccessToken {
  assertServerRuntime();
  const parsed = z.string().trim().min(20).max(8_192).safeParse(value);
  if (!parsed.success) {
    throw new Error("Fanvue dispatcher requires a non-empty server-provided OAuth access token");
  }
  return parsed.data as ServerProvidedFanvueAccessToken;
}

/** Fixed vault key for one OAuth-connected Fanvue creator connection. */
export function fanvueAccessTokenVaultKey(connectionId: string): string {
  const parsed = FanvueConnectionIdentifierSchema.safeParse(connectionId);
  if (!parsed.success) throw new Error("Fanvue connection identity is invalid");
  return `FANVUE_ACCESS_TOKEN_${parsed.data}`;
}

type AccountVaultReader = typeof vaultService;

/**
 * Resolves a per-connection OAuth access token exclusively inside a trusted
 * worker. The client secret, refresh token, and token value never enter
 * Convex, the browser, logs, or action receipts.
 */
export async function resolveFanvueAccessToken(
  connectionId: string,
  env: ProviderEnvironment = process.env,
  readVault: AccountVaultReader = vaultService,
): Promise<ServerProvidedFanvueAccessToken> {
  const health = checkFanvueApprovedDispatchHealth(env);
  if (!health.canDispatchApprovedActions) {
    throw new Error(`Fanvue approved dispatch is ${health.status}`);
  }
  if (env.FANVUE_ACCESS_TOKEN_RESOLVER?.trim() !== FANVUE_VAULT_TOKEN_RESOLVER) {
    throw new Error("Fanvue token resolver is not the approved server vault resolver");
  }
  const token = (await readVault("media-engine-accounts"))[fanvueAccessTokenVaultKey(connectionId)]?.trim();
  return requireServerProvidedFanvueAccessToken(token);
}

export type FanvueApprovedDispatchContext = Readonly<{
  /** Branded result of `verifyApprovedCreatorPromotionAction`. */
  approvedAction: VerifiedApprovedCreatorPromotionAction;
  account: ProviderAccountCapabilityGrant;
  accessToken: ServerProvidedFanvueAccessToken;
  apiVersion: FanvueApiVersion;
  providerHealth: ProviderConfigHealth;
}>;

export type FanvueApprovedRequest = Readonly<{
  method: "POST";
  url: string;
  headers: Readonly<{
    Authorization: string;
    "Content-Type": "application/json";
    "X-Fanvue-API-Version": FanvueApiVersion;
  }>;
  body: Readonly<Record<string, unknown>>;
  /** Retained for the dispatcher ledger; not sent as an undocumented header. */
  actionId: string;
  idempotencyKey: string;
}>;

/**
 * Builds (but never executes) a request for one approved Fanvue action.
 *
 * It accepts neither arbitrary request URLs nor arbitrary JSON bodies, so the
 * only possible requests are the provider's documented post, reply, and
 * tracking-link endpoints. Mass-message, account-creation, and browser-driven
 * operations are intentionally absent.
 */
export function buildFanvueApprovedRequestForDispatcher(
  context: FanvueApprovedDispatchContext,
  now = new Date(),
): FanvueApprovedRequest {
  assertServerRuntime();
  if (!isProviderReadyForApprovedDispatch(context.providerHealth)) {
    throw new Error("Fanvue is not configured for approved dispatch");
  }
  if (context.providerHealth.provider !== "fanvue") {
    throw new Error("Fanvue dispatcher received the wrong provider health record");
  }
  if (!FanvueApiVersionSchema.safeParse(context.apiVersion).success) {
    throw new Error("Fanvue dispatcher received an invalid API version");
  }

  // Revalidate at the final boundary to protect against an unsafe type cast.
  const approval = verifyApprovedCreatorPromotionAction(context.approvedAction, now);
  if (!approval.ok) {
    throw new Error(`Fanvue action approval is not valid: ${approval.errors.join("; ")}`);
  }
  if (approval.action.provider !== "fanvue") {
    throw new Error("Fanvue dispatcher only accepts Fanvue actions");
  }

  const accountAuthorization = authorizeActionForAccount(approval.action, context.account);
  if (!accountAuthorization.ok) {
    throw new Error(`Fanvue account is not authorized: ${accountAuthorization.errors.join("; ")}`);
  }

  // A local capability intent is not a provider grant. The callback/credential
  // resolver must have recorded the actual Fanvue OAuth scopes before an
  // approved descriptor can be built. System scopes are required to establish
  // OAuth but are not resource permissions for a provider action.
  const systemScopes = new Set<string>(FANVUE_SYSTEM_OAUTH_SCOPES);
  const requiredResourceScopes = fanvueScopesForCapabilities(
    requiredCapabilitiesForAction(approval.action),
  ).filter((scope) => !systemScopes.has(scope));
  const grantedScopes = new Set(context.account.scopes);
  const missingScopes = requiredResourceScopes.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Fanvue OAuth grant lacks required scope(s): ${missingScopes.join(", ")}`);
  }

  const request = requestForFanvueAction(approval.action, context.apiVersion, context.accessToken);
  return Object.freeze({
    ...request,
    actionId: approval.action.actionId,
    idempotencyKey: approval.action.idempotencyKey,
  });
}

function requestForFanvueAction(
  action: Extract<VerifiedApprovedCreatorPromotionAction, { provider: "fanvue" }>,
  apiVersion: FanvueApiVersion,
  accessToken: ServerProvidedFanvueAccessToken,
): Omit<FanvueApprovedRequest, "actionId" | "idempotencyKey"> {
  const headers = Object.freeze({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json" as const,
    "X-Fanvue-API-Version": apiVersion,
  });

  switch (action.type) {
    case "fanvue.create_post": {
      const { creatorUserUuid, priceCents, ...payload } = action.payload;
      return {
        method: "POST",
        url: officialFanvueUrl(`/creators/${creatorUserUuid}/posts`),
        headers,
        body: compactUndefined({ ...payload, price: priceCents }),
      };
    }
    case "fanvue.reply_to_inbound": {
      const payload = action.payload;
      return {
        method: "POST",
        url: officialFanvueUrl(
          `/creators/${payload.creatorUserUuid}/chats/${payload.recipientUserUuid}/message`,
        ),
        headers,
        body: compactUndefined({
          text: payload.text,
          mediaUuids: payload.mediaUuids,
          mediaPreviewUuid: payload.mediaPreviewUuid,
          price: payload.priceCents,
          templateUuid: payload.templateUuid,
        }),
      };
    }
    case "fanvue.create_tracking_link": {
      const { creatorUserUuid, ...payload } = action.payload;
      return {
        method: "POST",
        url: officialFanvueUrl(`/creators/${creatorUserUuid}/tracking-links`),
        headers,
        body: payload,
      };
    }
  }
}

function officialFanvueUrl(path: string): string {
  return new URL(path, FANVUE_API_ORIGIN).toString();
}

function compactUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Fanvue approved requests are server-only");
  }
}
