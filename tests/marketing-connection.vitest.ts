/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ZernioClient } from "../src/lib/marketing/zernio";
import {
  signMarketingConnectionState,
  verifyMarketingConnectionState,
} from "../src/lib/marketing/connection-state";

const API_KEY = "zernio_test_key_1234567890";
const SIGNING_KEY = "media-engine-test-key-that-is-at-least-32-bytes";
const PROJECT_ID = "abcdefghijklmnopqrstuvwx12345678";
const PROFILE_ID = "profile_1234567890";
const callback = "https://media-engine.example/api/marketing/connect/callback";

function mockClient(
  respond: (url: URL, init: RequestInit | undefined) => unknown,
) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return new Response(JSON.stringify(respond(url, init)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { client: new ZernioClient(API_KEY, fetcher), calls };
}

describe("project-scoped Zernio account connections", () => {
  it("reuses a project profile found by external id", async () => {
    const { client, calls } = mockClient(() => ({
      profiles: [{ _id: PROFILE_ID }],
    }));

    await expect(client.ensureProjectProfile(PROJECT_ID)).resolves.toBe(
      PROFILE_ID,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/api/v1/profiles");
    expect(calls[0].url.searchParams.get("externalId")).toBe(
      `media-engine-project:${PROJECT_ID}`,
    );
  });

  it("creates a missing project profile with a stable retry key", async () => {
    const { client, calls } = mockClient((url, init) =>
      init?.method === "POST"
        ? { profile: { _id: PROFILE_ID } }
        : { profiles: [] },
    );

    await expect(client.ensureProjectProfile(PROJECT_ID)).resolves.toBe(
      PROFILE_ID,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].init?.headers).toMatchObject({
      "Idempotency-Key": `media-engine-profile:${PROJECT_ID}`,
    });
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      externalId: `media-engine-project:${PROJECT_ID}`,
      name: `Media Engine project ${PROJECT_ID}`,
    });
  });

  it.each([
    ["instagram", "/api/v1/connect/instagram", "posting,analytics"],
    ["x", "/api/v1/connect/twitter", "posting,analytics"],
    ["reddit", "/api/v1/connect/reddit", "posting,analytics"],
    ["metaads", "/api/v1/connect/facebook/ads", null],
    ["googleads", "/api/v1/connect/googleads/ads", null],
  ] as const)("builds the provider OAuth request for %s", async (platform, path, scopes) => {
    const { client, calls } = mockClient(() => ({
      authUrl: "https://accounts.example/authorize?state=opaque",
    }));

    await expect(
      client.getConnectUrl(platform, PROFILE_ID, callback),
    ).resolves.toEqual({
      authUrl: "https://accounts.example/authorize?state=opaque",
    });
    expect(calls[0].url.pathname).toBe(path);
    expect(calls[0].url.searchParams.get("profileId")).toBe(PROFILE_ID);
    expect(calls[0].url.searchParams.get("redirect_url")).toBe(callback);
    if (scopes)
      expect(calls[0].url.searchParams.get("scopes")).toBe(scopes);
    if (platform === "metaads")
      expect(calls[0].url.searchParams.get("loginMode")).toBe("business");
  });

  it("handles Google Ads that are already connected without an OAuth redirect", async () => {
    const { client } = mockClient(() => ({
      alreadyConnected: true,
      accountId: "provider_account_123",
      platform: "googleads",
    }));
    await expect(
      client.getConnectUrl("googleads", PROFILE_ID, callback),
    ).resolves.toEqual({
      alreadyConnected: true,
      accountId: "provider_account_123",
      platform: "googleads",
    });
  });

  it("rejects insecure callback and authorization URLs", async () => {
    const { client, calls } = mockClient(() => ({ authUrl: "http://bad.test" }));
    await expect(
      client.getConnectUrl("instagram", PROFILE_ID, "http://site.test/callback"),
    ).rejects.toThrow(/HTTPS/);
    expect(calls).toHaveLength(0);
    await expect(
      client.getConnectUrl("instagram", PROFILE_ID, callback),
    ).rejects.toThrow(/unsafe OAuth/);
  });
});

describe("signed marketing OAuth return state", () => {
  it("binds the project, provider profile and platform and expires", () => {
    const now = 1_800_000_000_000;
    const token = signMarketingConnectionState(
      { projectId: PROJECT_ID, profileId: PROFILE_ID, platform: "metaads" },
      SIGNING_KEY,
      now,
    );
    expect(verifyMarketingConnectionState(token, SIGNING_KEY, now)).toMatchObject({
      projectId: PROJECT_ID,
      profileId: PROFILE_ID,
      platform: "metaads",
    });
    expect(verifyMarketingConnectionState(token, SIGNING_KEY, now + 30 * 60_000 + 1)).toBeNull();
    expect(verifyMarketingConnectionState(`${token}x`, SIGNING_KEY, now)).toBeNull();
    expect(verifyMarketingConnectionState(token, "wrong-signing-key-which-is-long-enough", now)).toBeNull();
  });
});
