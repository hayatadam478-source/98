import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app";
import type { ApiRouterOptions } from "../src/routes";

const TEST_TOKEN = "test-service-token-for-fairfare-api-suite-000000000";

interface RequestOptions {
  token?: string | null;
  body?: string;
  contentType?: string;
}

async function withServer(
  options: ApiRouterOptions,
  callback: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createApp({
      ...options,
      sessionCheck: {
        getServiceToken: () => TEST_TOKEN,
        ...options.sessionCheck,
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

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...extra,
  };
}

function postSessionCheck(
  origin: string,
  {
    token = TEST_TOKEN,
    body = "{}",
    contentType = "application/json",
  }: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${origin}/api/v1/session-check`, {
    method: "POST",
    headers,
    body,
  });
}

async function waitForTerminalJob(
  origin: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${origin}/api/v1/session-check/${jobId}`, {
      headers: authHeaders(),
    });
    assert.equal(response.status, 200);
    const job = (await response.json()) as Record<string, unknown>;
    if (job.status !== "running") return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Job did not reach a terminal status in time.");
}

test("health check remains public and returns safe JSON", async () => {
  await withServer({}, async origin => {
    const response = await fetch(`${origin}/api/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("session-check endpoints require a configured bearer token", async () => {
  await withServer({}, async origin => {
    const missing = await postSessionCheck(origin, { token: null });
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get("www-authenticate"), 'Bearer realm="fairfare-api"');
    assert.deepEqual(await missing.json(), {
      error: { code: "unauthorized", message: "A valid bearer token is required." },
    });

    const wrong = await postSessionCheck(origin, { token: "wrong-token" });
    assert.equal(wrong.status, 401);
  });

  await withServer(
    { sessionCheck: { getServiceToken: () => undefined } },
    async origin => {
      const response = await postSessionCheck(origin);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "service_not_configured");
    },
  );

  await withServer(
    { sessionCheck: { getServiceToken: () => "too-short" } },
    async origin => {
      const response = await postSessionCheck(origin);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "service_not_configured");
    },
  );
});

test("creates a job and reports not-verified without opening a browser session", async () => {
  await withServer({}, async origin => {
    const created = await postSessionCheck(origin);
    assert.equal(created.status, 202);
    const initial = (await created.json()) as Record<string, unknown>;
    assert.match(String(initial.jobId), /^[0-9a-f-]{36}$/i);
    assert.equal(initial.status, "running");

    const finished = await waitForTerminalJob(origin, String(initial.jobId));
    assert.equal(finished.status, "not-verified");
    assert.equal((finished.result as Record<string, unknown>).code, "manual_interaction_required");
    assert.match(
      String((finished.result as Record<string, unknown>).message),
      /no browser session was started/i,
    );
  });
});

test("rejects wrong content type, malformed/oversized JSON, and unexpected fields", async () => {
  await withServer({}, async origin => {
    const wrongType = await postSessionCheck(origin, {
      body: "{}",
      contentType: "text/plain",
    });
    assert.equal(wrongType.status, 415);

    const malformed = await postSessionCheck(origin, { body: "{" });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "invalid_json");

    const array = await postSessionCheck(origin, { body: "[]" });
    assert.equal(array.status, 400);

    const unexpected = await postSessionCheck(origin, {
      body: '{"account":"user@example.test"}',
    });
    assert.equal(unexpected.status, 400);
    assert.equal((await unexpected.json()).error.code, "invalid_request");

    const oversized = await postSessionCheck(origin, {
      body: JSON.stringify({ pad: "x".repeat(2_100) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "payload_too_large");
  });
});

test("validates IDs and hides unknown job records", async () => {
  await withServer({}, async origin => {
    const invalid = await fetch(`${origin}/api/v1/session-check/not-a-uuid`, {
      headers: authHeaders(),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "invalid_job_id");

    const unknown = await fetch(
      `${origin}/api/v1/session-check/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders() },
    );
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, "job_not_found");
  });
});

test("rejects concurrent jobs that could use the same Browserbase context", async () => {
  let markStarted!: () => void;
  let releaseRunner!: (status: "not-verified") => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  const runnerGate = new Promise<"not-verified">(resolve => {
    releaseRunner = resolve;
  });

  await withServer(
    {
      sessionCheck: {
        runSessionCheck: async () => {
          markStarted();
          return runnerGate;
        },
      },
    },
    async origin => {
      const firstResponse = await postSessionCheck(origin);
      assert.equal(firstResponse.status, 202);
      const first = (await firstResponse.json()) as { jobId: string };
      await started;

      const competing = await postSessionCheck(origin);
      assert.equal(competing.status, 409);
      assert.equal((await competing.json()).error.code, "context_busy");

      releaseRunner("not-verified");
      assert.equal((await waitForTerminalJob(origin, first.jobId)).status, "not-verified");

      const afterRelease = await postSessionCheck(origin);
      assert.equal(afterRelease.status, 202);
    },
  );
});

test("limits API traffic while keeping health checks available", async () => {
  await withServer(
    { sessionCheck: { rateLimit: { limit: 1, windowMs: 60_000 } } },
    async origin => {
      const first = await postSessionCheck(origin);
      assert.equal(first.status, 202);

      const limited = await postSessionCheck(origin);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "60");

      const health = await fetch(`${origin}/api/healthz`);
      assert.equal(health.status, 200);
    },
  );
});

test("runner exceptions result in a generic safe error", async () => {
  await withServer(
    {
      sessionCheck: {
        runSessionCheck: async () => {
          throw new Error("private-provider-detail-must-not-leak");
        },
      },
    },
    async origin => {
      const response = await postSessionCheck(origin);
      const created = (await response.json()) as { jobId: string };
      const finished = await waitForTerminalJob(origin, created.jobId);
      assert.equal(finished.status, "failed");
      assert.equal((finished.result as Record<string, unknown>).code, "verification_unavailable");
      assert.doesNotMatch(JSON.stringify(finished), /private-provider-detail/);
    },
  );
});

test("unsupported methods receive a safe 405 response", async () => {
  await withServer({}, async origin => {
    const response = await fetch(`${origin}/api/v1/session-check`, {
      headers: authHeaders(),
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal((await response.json()).error.code, "method_not_allowed");
  });
});
