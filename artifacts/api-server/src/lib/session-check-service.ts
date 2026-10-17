import { randomUUID } from "node:crypto";
import { CreateSessionCheckResponse } from "@workspace/api-zod";
import { logger } from "./logger";

export type SessionCheckJob = ReturnType<typeof CreateSessionCheckResponse.parse>;
export type SessionCheckStatus = SessionCheckJob["status"];
export type TerminalSessionCheckStatus = Exclude<SessionCheckStatus, "running">;

export interface SessionCheckStore {
  createRunningJob(
    job: SessionCheckJob,
    options: { maxJobs: number; expiresBefore: Date },
  ): Promise<boolean>;
  get(jobId: string): Promise<SessionCheckJob | undefined>;
  setJobResult(
    jobId: string,
    status: TerminalSessionCheckStatus,
    result: SessionCheckJob["result"],
    updatedAt: Date,
  ): Promise<void>;
  deleteExpired(cutoff: Date): Promise<void>;
  interruptRunningJobs(updatedAt: Date): Promise<number>;
}

export interface SessionCheckContextLease {
  release(): Promise<void>;
}

export interface SessionCheckContextLockProvider {
  tryAcquire(): Promise<SessionCheckContextLease | null>;
}

export type SessionCheckRunner = (input: {
  jobId: string;
}) => Promise<TerminalSessionCheckStatus>;

export interface SessionCheckServiceOptions {
  runSessionCheck?: SessionCheckRunner;
  store?: SessionCheckStore;
  contextLockProvider?: SessionCheckContextLockProvider;
  now?: () => number;
  createId?: () => string;
  maxJobs?: number;
  jobTtlMs?: number;
}

export type CreateSessionCheckResult =
  | { job: SessionCheckJob }
  | { error: "context_busy" | "job_store_full" };

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
    message:
      "The verification job could not be completed. Internal error details are not available.",
  };
}

function interruptedResult(): SessionCheckJob["result"] {
  return {
    code: "job_interrupted",
    message:
      "The session-check process stopped before the job completed. Submit a new request if needed.",
  };
}

function cloneJob(job: SessionCheckJob): SessionCheckJob {
  return CreateSessionCheckResponse.parse(job);
}

export function createInMemorySessionCheckStore(): SessionCheckStore {
  const jobs = new Map<string, SessionCheckJob>();

  return {
    async createRunningJob(job, { maxJobs, expiresBefore }) {
      for (const [jobId, existing] of jobs) {
        if (
          existing.status !== "running" &&
          existing.updatedAt.getTime() < expiresBefore.getTime()
        ) {
          jobs.delete(jobId);
        }
      }

      if (jobs.size >= maxJobs) {
        const completed = [...jobs.values()]
          .filter(existing => existing.status !== "running")
          .sort(
            (left, right) =>
              left.updatedAt.getTime() - right.updatedAt.getTime(),
          );
        while (jobs.size >= maxJobs && completed.length > 0) {
          jobs.delete(completed.shift()!.jobId);
        }
      }
      if (jobs.size >= maxJobs) return false;
      jobs.set(job.jobId, cloneJob(job));
      return true;
    },

    async get(jobId) {
      const job = jobs.get(jobId);
      return job ? cloneJob(job) : undefined;
    },

    async setJobResult(jobId, status, result, updatedAt) {
      const job = jobs.get(jobId);
      if (!job) throw new Error("session_check_job_missing");
      jobs.set(
        jobId,
        cloneJob({ ...job, status, result, updatedAt }),
      );
    },

    async deleteExpired(cutoff) {
      for (const [jobId, job] of jobs) {
        if (
          job.status !== "running" &&
          job.updatedAt.getTime() < cutoff.getTime()
        ) {
          jobs.delete(jobId);
        }
      }
    },

    async interruptRunningJobs(updatedAt) {
      let interrupted = 0;
      for (const [jobId, job] of jobs) {
        if (job.status === "running") {
          jobs.set(
            jobId,
            cloneJob({
              ...job,
              status: "failed",
              result: interruptedResult(),
              updatedAt,
            }),
          );
          interrupted += 1;
        }
      }
      return interrupted;
    },
  };
}

export function createInMemorySessionCheckContextLockProvider(): SessionCheckContextLockProvider {
  let locked = false;
  return {
    async tryAcquire() {
      if (locked) return null;
      locked = true;
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          locked = false;
        },
      };
    },
  };
}

export function createSessionCheckService({
  runSessionCheck = async () => "not-verified",
  store = createInMemorySessionCheckStore(),
  contextLockProvider = createInMemorySessionCheckContextLockProvider(),
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

  async function finishJob(
    jobId: string,
    lease: SessionCheckContextLease,
  ): Promise<void> {
    let status: TerminalSessionCheckStatus;
    let result: SessionCheckJob["result"];
    try {
      status = await runSessionCheck({ jobId });
      if (!["verified", "not-verified", "failed"].includes(status)) {
        throw new Error("invalid_session_check_result");
      }
      result = resultFor(status);
    } catch {
      status = "failed";
      result = resultFor("failed");
    }

    try {
      await store.setJobResult(jobId, status, result, new Date(now()));
    } catch {
      logger.error(
        { jobId },
        "Unable to persist the session-check job result.",
      );
    } finally {
      try {
        await lease.release();
      } catch {
        logger.error({ jobId }, "Unable to release the session-check context lock.");
      }
    }
  }

  return {
    async create(): Promise<CreateSessionCheckResult> {
      const lease = await contextLockProvider.tryAcquire();
      if (!lease) return { error: "context_busy" };

      try {
      const currentTime = now();
        await store.interruptRunningJobs(new Date(currentTime));

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

        const saved = await store.createRunningJob(job, {
          maxJobs,
          expiresBefore: new Date(currentTime - jobTtlMs),
        });
        if (!saved) {
          await lease.release();
          return { error: "job_store_full" };
        }

        // Keep the advisory lock held until the persisted result is terminal.
        setImmediate(() => {
          void finishJob(job.jobId, lease);
        });
        return { job: cloneJob(job) };
      } catch (error) {
        await lease.release();
        throw error;
      }
    },

    async get(jobId: string): Promise<SessionCheckJob | undefined> {
      await store.deleteExpired(new Date(now() - jobTtlMs));
      return store.get(jobId);
    },

    async recoverInterruptedJobs(): Promise<number> {
      const lease = await contextLockProvider.tryAcquire();
      if (!lease) return 0;
      try {
        return await store.interruptRunningJobs(new Date(now()));
      } finally {
        await lease.release();
      }
    },
  };
}
