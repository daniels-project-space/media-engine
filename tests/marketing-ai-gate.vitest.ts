import { beforeEach, describe, expect, it, vi } from "vitest";

const { marketingCall } = vi.hoisted(() => ({ marketingCall: vi.fn() }));
vi.mock("../src/lib/marketing/service", () => ({ marketingCall }));
import { marketingChat } from "../src/lib/llm";

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
});
