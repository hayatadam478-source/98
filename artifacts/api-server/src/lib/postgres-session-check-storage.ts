import {
  and,
  asc,
  eq,
  inArray,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import {
  db,
  pool,
  sessionCheckJobsTable,
  type SessionCheckJobRow,
} from "@workspace/db";
import { CreateSessionCheckResponse } from "@workspace/api-zod";
import type {
  SessionCheckContextLease,
  SessionCheckContextLockProvider,
  SessionCheckJob,
  SessionCheckStore,
  TerminalSessionCheckStatus,
} from "./session-check-service";

const CONTEXT_LOCK_NAMESPACE = 0x46414952; // "FAIR"
const CONTEXT_LOCK_ID = 0x46415245; // "FARE"

function rowToJob(row: SessionCheckJobRow): SessionCheckJob {
  return CreateSessionCheckResponse.parse({
    jobId: row.jobId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    result: {
      code: row.resultCode,
      message: row.resultMessage,
    },
  });
}

export class PostgresSessionCheckStore implements SessionCheckStore {
  async createRunningJob(
    job: SessionCheckJob,
    {
      maxJobs,
      expiresBefore,
    }: { maxJobs: number; expiresBefore: Date },
  ): Promise<boolean> {
    return db.transaction(async transaction => {
      await transaction
        .delete(sessionCheckJobsTable)
        .where(
          and(
            ne(sessionCheckJobsTable.status, "running"),
            lt(sessionCheckJobsTable.updatedAt, expiresBefore),
          ),
        );

      let [{ count }] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionCheckJobsTable);
      let storedJobs = Number(count);

      if (storedJobs >= maxJobs) {
        const completedJobs = await transaction
          .select({ jobId: sessionCheckJobsTable.jobId })
          .from(sessionCheckJobsTable)
          .where(ne(sessionCheckJobsTable.status, "running"))
          .orderBy(asc(sessionCheckJobsTable.updatedAt))
          .limit(storedJobs - maxJobs + 1);

        if (completedJobs.length > 0) {
          await transaction
            .delete(sessionCheckJobsTable)
            .where(
              inArray(
                sessionCheckJobsTable.jobId,
                completedJobs.map(({ jobId }) => jobId),
              ),
            );
        }

        [{ count }] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(sessionCheckJobsTable);
        storedJobs = Number(count);
      }

      if (storedJobs >= maxJobs) return false;

      await transaction.insert(sessionCheckJobsTable).values({
        jobId: job.jobId,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        resultCode: job.result.code,
        resultMessage: job.result.message,
      });
      return true;
    });
  }

  async get(jobId: string): Promise<SessionCheckJob | undefined> {
    const [row] = await db
      .select()
      .from(sessionCheckJobsTable)
      .where(eq(sessionCheckJobsTable.jobId, jobId))
      .limit(1);
    return row ? rowToJob(row) : undefined;
  }

  async setJobResult(
    jobId: string,
    status: TerminalSessionCheckStatus,
    result: SessionCheckJob["result"],
    updatedAt: Date,
  ): Promise<void> {
    const updated = await db
      .update(sessionCheckJobsTable)
      .set({
        status,
        resultCode: result.code,
        resultMessage: result.message,
        updatedAt,
      })
      .where(eq(sessionCheckJobsTable.jobId, jobId))
      .returning({ jobId: sessionCheckJobsTable.jobId });

    if (updated.length === 0) throw new Error("session_check_job_missing");
  }

  async deleteExpired(cutoff: Date): Promise<void> {
    await db
      .delete(sessionCheckJobsTable)
      .where(
        and(
          ne(sessionCheckJobsTable.status, "running"),
          lt(sessionCheckJobsTable.updatedAt, cutoff),
        ),
      );
  }

  async interruptRunningJobs(updatedAt: Date): Promise<number> {
    const interrupted = await db
      .update(sessionCheckJobsTable)
      .set({
        status: "failed",
        resultCode: "job_interrupted",
        resultMessage:
          "The session-check process stopped before the job completed. Submit a new request if needed.",
        updatedAt,
      })
      .where(eq(sessionCheckJobsTable.status, "running"))
      .returning({ jobId: sessionCheckJobsTable.jobId });

    return interrupted.length;
  }
}

export class PostgresSessionCheckContextLockProvider
  implements SessionCheckContextLockProvider
{
  constructor(
    private readonly connectionPool: Pick<typeof pool, "connect"> = pool,
  ) {}

  async tryAcquire(): Promise<SessionCheckContextLease | null> {
    const client = await this.connectionPool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [CONTEXT_LOCK_NAMESPACE, CONTEXT_LOCK_ID],
      );

      if (!result.rows[0]?.locked) {
        client.release();
        return null;
      }
    } catch {
      client.release(true);
      throw new Error("session_check_lock_unavailable");
    }

    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query(
            "SELECT pg_advisory_unlock($1, $2)",
            [CONTEXT_LOCK_NAMESPACE, CONTEXT_LOCK_ID],
          );
          client.release();
        } catch {
          client.release(true);
          throw new Error("session_check_lock_release_failed");
        }
      },
    };
  }
}
