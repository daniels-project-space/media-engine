import { describe, expect, it, vi } from "vitest";
import { hyperWatchDelaySeconds, monitorHyperJob, type HyperWatchedJob } from "../src/lib/marketing/hyper-watch";

const job = (state: string, available = false): HyperWatchedJob => ({
  id: "6c23d114-ef9b-41a8-aee4-2728e9fa6dab",
  modelId: "minimax-h3",
  state,
  receipt: { available },
});

describe("new Hyper job monitoring", () => {
  it("waits for a completed receipt before automatically requesting import", async () => {
    const states = [job("queued"), job("running"), job("completed"), job("completed", true)];
    const observe = vi.fn(async () => states.shift()!);
    const record = vi.fn(async () => undefined);
    const wait = vi.fn<(seconds: number, poll: number) => Promise<void>>(async () => undefined);
    const importCompleted = vi.fn(async () => undefined);

    const result = await monitorHyperJob({ observe, record, wait, importCompleted, onObservationError: vi.fn(), maxPolls: 5 });

    expect(result).toMatchObject({ status: "completed", job: { state: "completed", receipt: { available: true } } });
    expect(record).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls.map(([seconds]) => seconds)).toEqual([15, 15, 30]);
    expect(importCompleted).toHaveBeenCalledTimes(1);
  });

  it("stops immediately on a provider terminal failure without importing", async () => {
    const observe = vi.fn(async () => job("failed"));
    const record = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const importCompleted = vi.fn(async () => undefined);

    const result = await monitorHyperJob({ observe, record, wait, importCompleted, onObservationError: vi.fn(), maxPolls: 5 });

    expect(result).toMatchObject({ status: "failed", job: { state: "failed" } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(importCompleted).not.toHaveBeenCalled();
  });

  it("waits and retries transient observation errors, then imports the matching completed job", async () => {
    const observe = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(job("completed", true));
    const record = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const importCompleted = vi.fn(async () => undefined);
    const onObservationError = vi.fn(async () => ({ retry: true, providerState: "service-temporarily-unavailable" }));

    const result = await monitorHyperJob({ observe, record, wait, importCompleted, onObservationError, maxPolls: 3 });

    expect(result.status).toBe("completed");
    expect(onObservationError).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(importCompleted).toHaveBeenCalledOnce();
  });

  it("does not retry a permanent project/job mismatch", async () => {
    const observe = vi.fn().mockRejectedValue(new Error("wrong project"));
    const wait = vi.fn(async () => undefined);
    const onObservationError = vi.fn(async () => ({ retry: false, providerState: "failed" }));

    const result = await monitorHyperJob({
      observe,
      record: vi.fn(async () => undefined),
      wait,
      importCompleted: vi.fn(async () => undefined),
      onObservationError,
      maxPolls: 3,
    });

    expect(result).toEqual({ status: "blocked", providerState: "failed" });
    expect(observe).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("bounds polling frequency for active render jobs", () => {
    expect([hyperWatchDelaySeconds(0), hyperWatchDelaySeconds(5), hyperWatchDelaySeconds(20), hyperWatchDelaySeconds(40)])
      .toEqual([15, 30, 120, 300]);
  });
});
