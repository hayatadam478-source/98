import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { createSessionCheckService } from "../src/lib/session-check-service";

const TEST_TOKEN = "test-service-token-for-fairfare-api-suite-000000000";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

async function loadPostgresRuntime() {
  const [database, storage] = await Promise.all([
    import("@workspace/db"),
    import("../src/lib/postgres-session-check-storage"),
  ]);
  return { ...database, ...storage };
}

async function withServer(
  sessionCheck: Parameters<typeof createApp>[0]["sessionCheck"],
  callback: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createApp({
      sessionCheck: {
        getServiceToken: () => TEST_TOKEN,
        ...sessionCheck,
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server failed to bind to a TCP port.");
  }

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();
    await closed;
  }
}

function authenticatedHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...extra,
  };
}

async function waitForTerminalJob(
  origin: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(
      `${origin}/api/v1/session-check/${encodeURIComponent(jobId)}`,
      { headers: authenticatedHeaders() },
    );
    assert.equal(response.status, 200);
    const job = (await response.json()) as Record<string, unknown>;
    if (job.status !== "running") return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Job did not reach a terminal status in time.");
}

async function deleteTestJobs(
  db: Awaited<ReturnType<typeof loadPostgresRuntime>>["db"],
  table: Awaited<ReturnType<typeof loadPostgresRuntime>>["sessionCheckJobsTable"],
  jobIds: string[],
): Promise<void> {
  if (jobIds.length === 0) return;
  const { inArray } = await import("drizzle-orm");
  await db.delete(table).where(inArray(table.jobId, jobIds));
}

test(
  "persisted jobs remain readable after an API server instance is recreated",
  { skip: !hasDatabaseUrl },
  async () => {
    const {
      db,
      sessionCheckJobsTable,
      PostgresSessionCheckContextLockProvider,
      PostgresSessionCheckStore,
    } = await loadPostgresRuntime();
    const jobIds: string[] = [];
    try {
      const storeBeforeRestart = new PostgresSessionCheckStore();
      const lockBeforeRestart = new PostgresSessionCheckContextLockProvider();

      await withServer(
        {
          store: storeBeforeRestart,
          contextLockProvider: lockBeforeRestart,
        },
        async origin => {
          const createdResponse = await fetch(
            `${origin}/api/v1/session-check`,
            {
              method: "POST",
              headers: authenticatedHeaders({
                "Content-Type": "application/json",
              }),
              body: "{}",
            },
          );
          assert.equal(createdResponse.status, 202);
          const created = (await createdResponse.json()) as {
            jobId: string;
            status: string;
          };
          jobIds.push(created.jobId);
          assert.equal(created.status, "running");
          const completed = await waitForTerminalJob(origin, created.jobId);
          assert.equal(completed.status, "not-verified");
        },
      );

      const storeAfterRestart = new PostgresSessionCheckStore();
      const lockAfterRestart = new PostgresSessionCheckContextLockProvider();
      await createSessionCheckService({
        store: storeAfterRestart,
        contextLockProvider: lockAfterRestart,
      }).recoverInterruptedJobs();

      await withServer(
        {
          store: storeAfterRestart,
          contextLockProvider: lockAfterRestart,
        },
        async origin => {
          const response = await fetch(
            `${origin}/api/v1/session-check/${jobIds[0]}`,
            { headers: authenticatedHeaders() },
          );
          assert.equal(response.status, 200);
          const job = (await response.json()) as {
            jobId: string;
            status: string;
            result: { code: string };
          };
          assert.equal(job.jobId, jobIds[0]);
          assert.equal(job.status, "not-verified");
          assert.equal(job.result.code, "manual_interaction_required");
          assert.deepEqual(Object.keys(job).sort(), [
            "createdAt",
            "jobId",
            "result",
            "status",
            "updatedAt",
          ]);
          assert.deepEqual(Object.keys(job.result).sort(), ["code", "message"]);
        },
      );

      const columns = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fairfare_session_check_jobs'
        ORDER BY ordinal_position
      `);
      assert.deepEqual(
        columns.rows.map(row => row.column_name),
        [
          "job_id",
          "status",
          "created_at",
          "updated_at",
          "result_code",
          "result_message",
        ],
      );
    } finally {
      await deleteTestJobs(db, sessionCheckJobsTable, jobIds);
    }
  },
);

test(
  "startup recovery marks abandoned running jobs failed with a safe result",
  { skip: !hasDatabaseUrl },
  async () => {
    const { db, sessionCheckJobsTable, PostgresSessionCheckContextLockProvider, PostgresSessionCheckStore } =
      await loadPostgresRuntime();
    const jobId = randomUUID();
    const timestamp = new Date();
    try {
      await db.insert(sessionCheckJobsTable).values({
        jobId,
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp,
        resultCode: "verification_in_progress",
        resultMessage: "The verification job is running.",
      });

      const store = new PostgresSessionCheckStore();
      const service = createSessionCheckService({
        store,
        contextLockProvider: new PostgresSessionCheckContextLockProvider(),
      });
      assert.equal(await service.recoverInterruptedJobs(), 1);

      const recovered = await service.get(jobId);
      assert.equal(recovered?.status, "failed");
      assert.equal(recovered?.result.code, "job_interrupted");
      assert.match(recovered?.result.message ?? "", /submit a new request/i);
      assert.doesNotMatch(
        JSON.stringify(recovered),
        /api[_-]?key|cookie|live.?view|browser.?storage/i,
      );
    } finally {
      await deleteTestJobs(db, sessionCheckJobsTable, [jobId]);
    }
  },
);

test(
  "PostgreSQL advisory lock prevents concurrent jobs across API instances",
  { skip: !hasDatabaseUrl },
  async () => {
    const { db, sessionCheckJobsTable, PostgresSessionCheckContextLockProvider, PostgresSessionCheckStore } =
      await loadPostgresRuntime();
    const firstJobId = randomUUID();
    const secondJobId = randomUUID();
    let markStarted!: () => void;
    let releaseRunner!: (status: "not-verified") => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const runnerGate = new Promise<"not-verified">(resolve => {
      releaseRunner = resolve;
    });

    const firstService = createSessionCheckService({
      store: new PostgresSessionCheckStore(),
      contextLockProvider: new PostgresSessionCheckContextLockProvider(),
      createId: () => firstJobId,
      runSessionCheck: async () => {
        markStarted();
        return runnerGate;
      },
    });
    const secondService = createSessionCheckService({
      store: new PostgresSessionCheckStore(),
      contextLockProvider: new PostgresSessionCheckContextLockProvider(),
      createId: () => secondJobId,
    });

    try {
      const first = await firstService.create();
      assert.ok("job" in first);
      await started;

      const competing = await secondService.create();
      assert.deepEqual(competing, { error: "context_busy" });

      releaseRunner("not-verified");
      const finished = await waitForTerminalJobForService(
        firstService,
        firstJobId,
      );
      assert.equal(finished.status, "not-verified");

      const afterRelease = await secondService.create();
      assert.ok("job" in afterRelease);
      await waitForTerminalJobForService(secondService, secondJobId);
    } finally {
      releaseRunner("not-verified");
      await deleteTestJobs(db, sessionCheckJobsTable, [firstJobId, secondJobId]);
    }
  },
);

async function waitForTerminalJobForService(
  service: ReturnType<typeof createSessionCheckService>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const job = await service.get(jobId);
    if (job && job.status !== "running") return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Job did not reach a terminal status in time.");
}
