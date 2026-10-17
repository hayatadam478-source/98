import { randomUUID } from "node:crypto";
import { CreateSessionCheckResponse } from "@workspace/api-zod";

export type SessionCheckJob = ReturnType<typeof CreateSessionCheckResponse.parse>;
export type SessionCheckStatus = SessionCheckJob["status"];
export type TerminalSessionCheckStatus = Exclude<SessionCheckStatus, "running">;

export type SessionCheckRunner = (input: {
  jobId: string;
}) => Promise<TerminalSessionCheckStatus>;

export interface SessionCheckServiceOptions {
  runSessionCheck?: SessionCheckRunner;
  now?: () => number;
  createId?: () => string;
  maxJobs?: number;
  jobTtlMs?: number;
}

export type CreateSessionCheckResult =
  | { job: SessionCheckJob }
  | { error: "context_busy" | "job_store_full" };

const terminalStatuses: readonly TerminalSessionCheckStatus[] = [
  "verified",
  "not-verified",
  "failed",
];

function isTerminalStatus(value: unknown): value is TerminalSessionCheckStatus {
  return terminalStatuses.includes(value as TerminalSessionCheckStatus);
}

function resultFor(status: TerminalSessionCheckStatus): SessionCheckJob["result"] {
  if (status === "not-verified") {
    return {
      code: "manual_interaction_required",
      message:
        "Automated session verification is not implemented. Use the preserved interactive CLI; no browser session was started.",
    };
  }
  if (status === "verified") {
    return {
      code: "verification_verified",
      message: "A verification result was recorded.",
    };
  }
  return {
    code: "verification_unavailable",
    message: "The verification job could not be completed. Internal error details are not available.",
  };
}

export function createSessionCheckService({
  runSessionCheck = async () => "not-verified",
  now = () => Date.now(),
  createId = randomUUID,
  maxJobs = 1_000,
  jobTtlMs = 15 * 60 * 1_000,
}: SessionCheckServiceOptions = {}) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1) {
    throw new TypeError("maxJobs must be a positive integer.");
  }
  if (!Number.isFinite(jobTtlMs) || jobTtlMs < 1) {
    throw new TypeError("jobTtlMs must be a positive number.");
  }

  const jobs = new Map<string, SessionCheckJob>();
  let activeJobId: string | null = null;

  function pruneJobs(currentTime: number): void {
    for (const [jobId, job] of jobs) {
      if (
        job.status !== "running" &&
        currentTime - job.updatedAt.getTime() >= jobTtlMs
      ) {
        jobs.delete(jobId);
      }
    }

    if (jobs.size < maxJobs) return;
    const completed = [...jobs.values()]
      .filter(job => job.status !== "running")
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
    while (jobs.size >= maxJobs && completed.length > 0) {
      jobs.delete(completed.shift()!.jobId);
    }
  }

  async function finishJob(job: SessionCheckJob): Promise<void> {
    try {
      const outcome: unknown = await runSessionCheck({ jobId: job.jobId });
      if (!isTerminalStatus(outcome)) {
        throw new Error("Invalid verification result.");
      }
      job.status = outcome;
      job.result = resultFor(outcome);
    } catch {
      job.status = "failed";
      job.result = resultFor("failed");
    } finally {
      job.updatedAt = new Date(now());
      if (activeJobId === job.jobId) activeJobId = null;
    }
  }

  return {
    create(): CreateSessionCheckResult {
      const currentTime = now();
      pruneJobs(currentTime);
      if (activeJobId !== null) return { error: "context_busy" };
      if (jobs.size >= maxJobs) return { error: "job_store_full" };

      const timestamp = new Date(currentTime);
      const job = CreateSessionCheckResponse.parse({
        jobId: createId(),
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp,
        result: {
          code: "verification_in_progress",
          message: "The verification job is running.",
        },
      });
      jobs.set(job.jobId, job);
      activeJobId = job.jobId;

      // Acquire the lock before scheduling any asynchronous work.
      void finishJob(job);
      return { job: CreateSessionCheckResponse.parse(job) };
    },

    get(jobId: string): SessionCheckJob | undefined {
      pruneJobs(now());
      const job = jobs.get(jobId);
      return job ? CreateSessionCheckResponse.parse(job) : undefined;
    },
  };
}
