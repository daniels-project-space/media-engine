import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  startAuthorization,
  type OAuthClientMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/client";

/** The only Higgsfield resource this deployment is permitted to authorise. */
export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";
export const HIGGSFIELD_AUTHORIZATION_SERVER = "https://mcp.higgsfield.ai";
export const HIGGSFIELD_OAUTH_SCOPE = "openid email offline_access";
export const HIGGSFIELD_OAUTH_COOKIE = "__Host-media_engine_higgsfield_oauth";
export const HIGGSFIELD_CALLBACK_PATH = "/api/auth/higgsfield/callback";
export const HIGGSFIELD_CLIENT_METADATA_PATH = "/api/auth/higgsfield/client-metadata";

const COOKIE_VERSION = "v1";
const COOKIE_AAD = Buffer.from("media-engine:higgsfield-oauth:v1", "utf8");
const OAUTH_TTL_MS = 10 * 60 * 1000;

export type HiggsfieldSession = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  scope?: string;
  tokenType?: string;
  issuer?: string;
  idToken?: string;
};

export type PendingHiggsfieldAuthorization = {
  version: 1;
  state: string;
  codeVerifier: string;
  authorizationServerUrl: string;
  issuer: string;
  expiresAt: number;
};

/** Parses the one vault bundle without ever accepting a legacy direct-API token pair. */
export function parseHiggsfieldSession(raw: string): HiggsfieldSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      typeof candidate.accessToken !== "string" || !candidate.accessToken ||
      typeof candidate.refreshToken !== "string" || !candidate.refreshToken ||
      typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt) ||
      typeof candidate.clientId !== "string" || candidate.clientId !== higgsfieldClientMetadataUrl()
    ) {
      return null;
    }
    return {
      version: 1,
      accessToken: candidate.accessToken,
      refreshToken: candidate.refreshToken,
      expiresAt: candidate.expiresAt,
      clientId: candidate.clientId,
      ...(optionalString(candidate.scope, 4_096) ? { scope: optionalString(candidate.scope, 4_096) } : {}),
      ...(optionalString(candidate.tokenType, 128) ? { tokenType: optionalString(candidate.tokenType, 128) } : {}),
      ...(optionalString(candidate.issuer, 1_024) ? { issuer: optionalString(candidate.issuer, 1_024) } : {}),
      ...(optionalString(candidate.idToken) ? { idToken: optionalString(candidate.idToken) } : {}),
    };
  } catch {
    return null;
  }
}

function requiredSecret(): Buffer {
  const value = process.env.HIGGSFIELD_OAUTH_COOKIE_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("HIGGSFIELD_OAUTH_COOKIE_SECRET must be configured with at least 32 bytes before linking Higgsfield");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

function fixedOrigin(): URL {
  const configured = process.env.MEDIA_ENGINE_PUBLIC_ORIGIN;
  if (!configured) throw new Error("MEDIA_ENGINE_PUBLIC_ORIGIN is required for the production Higgsfield OAuth callback");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("MEDIA_ENGINE_PUBLIC_ORIGIN must be a valid HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("MEDIA_ENGINE_PUBLIC_ORIGIN must be a bare HTTPS origin");
  }
  return url;
}

export function mediaEnginePublicOrigin(): string {
  return fixedOrigin().origin;
}

export function higgsfieldCallbackUrl(): string {
  return new URL(HIGGSFIELD_CALLBACK_PATH, fixedOrigin()).toString();
}

export function higgsfieldClientMetadataUrl(): string {
  return new URL(HIGGSFIELD_CLIENT_METADATA_PATH, fixedOrigin()).toString();
}

export function higgsfieldClientMetadata(): OAuthClientMetadata & { client_id: string } {
  const origin = mediaEnginePublicOrigin();
  const clientId = higgsfieldClientMetadataUrl();
  return {
    client_id: clientId,
    client_name: "Media Engine production renderer",
    client_uri: origin,
    redirect_uris: [higgsfieldCallbackUrl()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    scope: HIGGSFIELD_OAUTH_SCOPE,
  };
}

function staticClientInformation(): { client_id: string } {
  return { client_id: higgsfieldClientMetadataUrl() };
}

function strictString(value: unknown, label: string, max = 16_384): string {
  if (typeof value !== "string" || !value || value.length > max) throw new Error(`Invalid Higgsfield ${label}`);
  return value;
}

function optionalString(value: unknown, max = 16_384): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function expiresAt(tokens: OAuthTokens, fallback?: number): number {
  const seconds = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0
    ? Math.floor(tokens.expires_in)
    : undefined;
  if (seconds) return Date.now() + seconds * 1_000;
  if (fallback && fallback > Date.now()) return fallback;
  // The provider normally returns expires_in. This conservative fallback only
  // records diagnostic expiry; authentication still refreshes after a 401.
  return Date.now() + 60 * 60 * 1_000;
}

export function sessionFromTokens(tokens: OAuthTokens, current?: HiggsfieldSession): HiggsfieldSession {
  const accessToken = strictString(tokens.access_token, "access token");
  const refreshToken = optionalString(tokens.refresh_token) ?? current?.refreshToken;
  if (!refreshToken) throw new Error("Higgsfield did not issue a refresh token; reconnect with offline access enabled");
  return {
    version: 1,
    accessToken,
    refreshToken,
    expiresAt: expiresAt(tokens, current?.expiresAt),
    clientId: current?.clientId ?? higgsfieldClientMetadataUrl(),
    ...(optionalString(tokens.scope, 4_096) ? { scope: optionalString(tokens.scope, 4_096) } : current?.scope ? { scope: current.scope } : {}),
    ...(optionalString(tokens.token_type, 128) ? { tokenType: optionalString(tokens.token_type, 128) } : current?.tokenType ? { tokenType: current.tokenType } : {}),
    ...(optionalString((tokens as { issuer?: unknown }).issuer, 1_024)
      ? { issuer: optionalString((tokens as { issuer?: unknown }).issuer, 1_024) }
      : current?.issuer
        ? { issuer: current.issuer }
        : { issuer: HIGGSFIELD_AUTHORIZATION_SERVER }),
    ...(optionalString(tokens.id_token) ? { idToken: optionalString(tokens.id_token) } : current?.idToken ? { idToken: current.idToken } : {}),
  };
}

export function tokensFromSession(session: HiggsfieldSession): OAuthTokens & { issuer?: string } {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: session.tokenType ?? "Bearer",
    expires_in: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1_000)),
    ...(session.scope ? { scope: session.scope } : {}),
    ...(session.idToken ? { id_token: session.idToken } : {}),
    ...(session.issuer ? { issuer: session.issuer } : {}),
  };
}

export function randomOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function matchesOAuthState(expected: string, received: string | null): boolean {
  if (!received) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Uses the MCP SDK's discovery and PKCE implementation, but leaves the
 * browser redirect under our explicit operator-only route control.
 */
export async function beginHiggsfieldAuthorization(state: string): Promise<{
  authorizationUrl: string;
  pending: PendingHiggsfieldAuthorization;
}> {
  const server = await discoverOAuthServerInfo(new URL(HIGGSFIELD_MCP_URL));
  const metadata = server.authorizationServerMetadata;
  const issuer = metadata?.issuer;
  if (!metadata || server.authorizationServerUrl !== HIGGSFIELD_AUTHORIZATION_SERVER || issuer !== HIGGSFIELD_AUTHORIZATION_SERVER) {
    throw new Error("Higgsfield OAuth discovery did not resolve the expected MCP authorization server");
  }
  const result = await startAuthorization(server.authorizationServerUrl, {
    metadata,
    clientInformation: staticClientInformation(),
    redirectUrl: higgsfieldCallbackUrl(),
    scope: HIGGSFIELD_OAUTH_SCOPE,
    state,
    resource: new URL(HIGGSFIELD_MCP_URL),
  });
  return {
    authorizationUrl: result.authorizationUrl.toString(),
    pending: {
      version: 1,
      state,
      codeVerifier: result.codeVerifier,
      authorizationServerUrl: server.authorizationServerUrl,
      issuer,
      expiresAt: Date.now() + OAUTH_TTL_MS,
    },
  };
}

/** Completes the code exchange only after the caller verified its sealed state cookie. */
export async function completeHiggsfieldAuthorization(
  pending: PendingHiggsfieldAuthorization,
  authorizationCode: string,
  iss?: string,
): Promise<HiggsfieldSession> {
  if (pending.expiresAt <= Date.now()) throw new Error("The Higgsfield authorization window expired; start the connection again");
  const server = await discoverOAuthServerInfo(new URL(HIGGSFIELD_MCP_URL));
  const metadata = server.authorizationServerMetadata;
  if (
    !metadata ||
    server.authorizationServerUrl !== pending.authorizationServerUrl ||
    metadata.issuer !== pending.issuer ||
    pending.issuer !== HIGGSFIELD_AUTHORIZATION_SERVER
  ) {
    throw new Error("Higgsfield OAuth issuer changed during authorization; the connection was not saved");
  }
  const tokens = await exchangeAuthorization(server.authorizationServerUrl, {
    metadata,
    clientInformation: staticClientInformation(),
    authorizationCode: strictString(authorizationCode, "authorization code", 8_192),
    iss,
    codeVerifier: pending.codeVerifier,
    redirectUri: higgsfieldCallbackUrl(),
    resource: new URL(HIGGSFIELD_MCP_URL),
  });
  return sessionFromTokens(tokens);
}

function validPending(value: unknown): value is PendingHiggsfieldAuthorization {
  if (!value || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return (
    pending.version === 1 &&
    typeof pending.state === "string" && pending.state.length >= 32 && pending.state.length <= 256 &&
    typeof pending.codeVerifier === "string" && pending.codeVerifier.length >= 43 && pending.codeVerifier.length <= 256 &&
    pending.authorizationServerUrl === HIGGSFIELD_AUTHORIZATION_SERVER &&
    pending.issuer === HIGGSFIELD_AUTHORIZATION_SERVER &&
    typeof pending.expiresAt === "number" && Number.isFinite(pending.expiresAt)
  );
}

/** Encrypts the PKCE verifier: a signed-only cookie would expose it to the browser. */
export function sealHiggsfieldPending(pending: PendingHiggsfieldAuthorization): string {
  if (!validPending(pending)) throw new Error("Refusing to seal an invalid Higgsfield OAuth transaction");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requiredSecret(), iv);
  cipher.setAAD(COOKIE_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(pending), "utf8"), cipher.final()]);
  return [COOKIE_VERSION, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function unsealHiggsfieldPending(sealed: string | undefined): PendingHiggsfieldAuthorization | null {
  if (!sealed) return null;
  const [version, rawIv, rawCiphertext, rawTag, extra] = sealed.split(".");
  if (version !== COOKIE_VERSION || !rawIv || !rawCiphertext || !rawTag || extra) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", requiredSecret(), Buffer.from(rawIv, "base64url"));
    decipher.setAAD(COOKIE_AAD);
    decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(rawCiphertext, "base64url")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    return validPending(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function higgsfieldOAuthCookieMaxAge(): number {
  return Math.floor(OAUTH_TTL_MS / 1_000);
}
