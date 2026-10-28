import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { marketingCall } = vi.hoisted(() => ({ marketingCall: vi.fn() }));
vi.mock("../src/lib/marketing/service", () => ({ marketingCall }));
import { inspectCodexEnvironment, inspectCodexSubscription, marketingChat } from "../src/lib/llm";

describe("marketing AI safety gate", () => {
  beforeEach(() => marketingCall.mockReset());
  it("does not run the subscription worker when the switch is off or malformed", async () => {
    for (const value of [false, undefined, "true"]) {
      marketingCall.mockResolvedValueOnce(value);
      await expect(marketingChat({ user: "test" })).rejects.toThrow(/paused/);
    }
  });
  it("fails closed if the authenticated switch lookup fails", async () => {
    marketingCall.mockRejectedValueOnce(new Error("unavailable"));
    await expect(marketingChat({ user: "test" })).rejects.toThrow(/paused/);
  });
  it("reports an unavailable CLI without invoking a model or disclosing errors", async () => {
    expect(await inspectCodexSubscription("/nonexistent/marketing-codex-test")).toBe("unavailable");
    expect(await inspectCodexEnvironment("/nonexistent/marketing-codex-test")).toMatchObject({ login: "unavailable", cli: "missing" });
  });
  it("recognizes an exact subscription status on stdout or stderr, but rejects API-key login", async () => {
    const dir = await mkdtemp(join(tmpdir(), "marketing-cli-test-"));
    try {
      const cli = join(dir, "codex-fixture");
      for (const [output, expected] of [
        ["echo 'Logged in using ChatGPT'", "subscription-login"],
        ["echo 'Logged in using ChatGPT' >&2", "subscription-login"],
        ["echo 'Logged in using an API key' >&2", "unavailable"],
        ["echo 'Logged in using ChatGPT' >&2; exit 1", "unavailable"],
      ] as const) {
        await writeFile(cli, `#!/bin/sh\n${output}\n`); await chmod(cli, 0o700);
        expect(await inspectCodexSubscription(cli)).toBe(expected);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
