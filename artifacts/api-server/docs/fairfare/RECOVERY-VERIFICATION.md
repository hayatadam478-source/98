# Recovery verification — Checkpoint 06

- Source: user-provided Recovery 05 archive; integrity and file list checked before extraction.
- The original worker source was copied byte-for-byte into the API artifact.
- Contract generation completed from `lib/api-spec/openapi.yaml`; shared library typecheck passed.
- API-server typecheck passed.
- API-server tests passed: 9 passed, 0 failed. Tests use local HTTP requests and mocks for the runner/lock path.
- Workflow smoke probe: `GET /api/healthz` returned HTTP 200. Authenticated job creation returned HTTP 503 `service_not_configured`; the secret key exists but the running service does not see a valid token. The secret value was not read or logged.
- Live Browserbase/Uber session, persistent-context validation, Hatchable integration, and deployment: **not run**.
- API jobs are in memory and the context lock is per process; do not run multiple instances for the same context.
