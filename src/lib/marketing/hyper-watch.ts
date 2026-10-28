export type HyperWatchedJob = {
  id: string;
  modelId: string;
  state: string;
  errorCode?: string | null;
  receipt?: { available: boolean } | null;
};

export type HyperWatchErrorDecision = {
  retry: boolean;
  providerState: string;
  errorCode?: string;
};

export type HyperWatchResult =
  | { status: "completed"; job: HyperWatchedJob }
  | { status: "failed" | "cancelled"; job: HyperWatchedJob }
  | { status: "blocked"; providerState: string }
  | { status: "observation-window-ended"; polls: number };

export function hyperWatchDelaySeconds(poll: number): number {
  if (poll < 2) return 15;
  if (poll < 6) return 30;
  if (poll < 14) return 60;
  if (poll < 30) return 120;
  return 300;
}

/**
 * Observe an already-submitted Hyper job. Waiting is delegated to the caller
 * so Trigger.dev can checkpoint it without keeping a worker active.
 */
export async function monitorHyperJob(input: {
  observe: () => Promise<HyperWatchedJob>;
  record: (job: HyperWatchedJob) => Promise<void>;
  importCompleted: (job: HyperWatchedJob) => Promise<void>;
  wait: (seconds: number, poll: number) => Promise<void>;
  onObservationError: (error: unknown) => Promise<HyperWatchErrorDecision>;
  maxPolls?: number;
}): Promise<HyperWatchResult> {
  const maxPolls = input.maxPolls ?? 288;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    let job: HyperWatchedJob;
    try {
      job = await input.observe();
    } catch (error) {
      const decision = await input.onObservationError(error);
      if (!decision.retry) return { status: "blocked", providerState: decision.providerState };
      if (poll + 1 < maxPolls) await input.wait(hyperWatchDelaySeconds(poll), poll);
      continue;
    }

    await input.record(job);
    if (job.state === "failed" || job.state === "cancelled") return { status: job.state, job };
    if (job.state === "completed" && job.receipt?.available) {
      await input.importCompleted(job);
      return { status: "completed", job };
    }
    if (poll + 1 < maxPolls) await input.wait(hyperWatchDelaySeconds(poll), poll);
  }
  return { status: "observation-window-ended", polls: maxPolls };
}
