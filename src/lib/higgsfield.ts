import {
  Client,
  StreamableHTTPClientTransport,
  discoverOAuthServerInfo,
  refreshAuthorization,
  type AuthProvider,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import { rotateHiggsfieldSession, vaultHiggsfieldSession } from "./vault";
import {
  HIGGSFIELD_AUTHORIZATION_SERVER,
  HIGGSFIELD_MCP_URL,
  type HiggsfieldSession,
  higgsfieldClientMetadataUrl,
  parseHiggsfieldSession,
  sessionFromTokens,
} from "./higgsfield-oauth";

type SessionState = { session: HiggsfieldSession; revision: number };

export type HiggsfieldMcpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

async function loadSessionState(): Promise<SessionState> {
  const stored = await vaultHiggsfieldSession();
  if (!stored) throw new Error("Higgsfield production MCP session is not linked");
  const session = parseHiggsfieldSession(stored.value);
  if (!session) throw new Error("Higgsfield production MCP session is malformed or belongs to a different deployment");
  return { session, revision: stored.revision };
}

async function expectedMcpServer() {
  const server = await discoverOAuthServerInfo(new URL(HIGGSFIELD_MCP_URL));
  if (
    server.authorizationServerUrl !== HIGGSFIELD_AUTHORIZATION_SERVER ||
    !server.authorizationServerMetadata ||
    server.authorizationServerMetadata.issuer !== HIGGSFIELD_AUTHORIZATION_SERVER
  ) {
    throw new Error("Higgsfield MCP OAuth discovery did not resolve the expected authorization server");
  }
  return server;
}

/**
 * Refreshes through the official MCP OAuth token endpoint. A refresh token can
 * be single-use, so losing a CAS race always adopts the winner's new bundle
 * rather than attempting to reuse the stale refresh token.
 */
async function refreshSession(state: SessionState): Promise<SessionState> {
  const server = await expectedMcpServer();
  let tokens: OAuthTokens;
  try {
    tokens = await refreshAuthorization(server.authorizationServerUrl, {
      metadata: server.authorizationServerMetadata,
      clientInformation: { client_id: state.session.clientId },
      refreshToken: state.session.refreshToken,
      resource: new URL(HIGGSFIELD_MCP_URL),
    });
  } catch (error) {
    const latest = await loadSessionState().catch(() => null);
    if (latest && latest.revision !== state.revision) return latest;
    throw error;
  }

  const next = sessionFromTokens(tokens, state.session);
  try {
    const result = await rotateHiggsfieldSession(JSON.stringify(next), state.revision);
    return { session: next, revision: result.revision };
  } catch (error) {
    const latest = await loadSessionState().catch(() => null);
    if (latest && latest.revision !== state.revision) return latest;
    throw error;
  }
}

function mcpAuthProvider(initial: SessionState): AuthProvider {
  let state = initial;
  let refreshInFlight: Promise<void> | null = null;
  return {
    token: async () => state.session.accessToken,
    onUnauthorized: async () => {
      if (!refreshInFlight) {
        refreshInFlight = refreshSession(state)
          .then((next) => {
            state = next;
          })
          .finally(() => {
            refreshInFlight = null;
          });
      }
      await refreshInFlight;
    },
  };
}

/**
 * Non-billable proof of the linked production credential. This never invokes a
 * generation tool; it is intentionally the first post-link operation before a
 * reviewed Seedance schema is allowed into the render pipeline.
 */
export async function listHiggsfieldMcpTools(): Promise<HiggsfieldMcpTool[]> {
  const initial = await loadSessionState();
  // The static HTTPS metadata URL is the OAuth public-client ID. Refuse a
  // vault row with a different ID before sending any bearer token.
  if (initial.session.clientId !== higgsfieldClientMetadataUrl()) {
    throw new Error("Higgsfield MCP session has an unexpected public client identity; reconnect it from Settings");
  }
  const transport = new StreamableHTTPClientTransport(new URL(HIGGSFIELD_MCP_URL), {
    authProvider: mcpAuthProvider(initial),
    onInsufficientScope: "throw",
  });
  const client = new Client({ name: "media-engine", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }));
  } finally {
    await transport.close().catch(() => undefined);
  }
}

/** True only when an independently-issued cloud OAuth session is stored. */
export async function higgsfieldMcpLinked(): Promise<boolean> {
  try {
    await loadSessionState();
    return true;
  } catch {
    return false;
  }
}
