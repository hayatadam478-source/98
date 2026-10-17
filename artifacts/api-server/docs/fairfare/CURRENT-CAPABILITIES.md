# Current capabilities — Checkpoint 08

## Available

- Original interactive Browserbase/Playwright CLI is preserved and remains a separate, manually run command.
- `GET /api/healthz` provides public process health.
- `POST /api/v1/session-check` and `GET /api/v1/session-check/:jobId` require a bearer token from Replit Secrets.
- The POST body is optional or `{}` only. Invalid content type, malformed JSON, extra fields, and oversized bodies receive safe JSON errors.
- Rate limiting defaults to 30 requests per minute per remote IP.
- Jobs and status records persist in the existing PostgreSQL database and remain readable after API restarts.
- A shared PostgreSQL advisory lock rejects a concurrent job with HTTP 409 across API instances.
- Startup recovery marks abandoned `running` jobs as failed with `job_interrupted`.
- Job records contain only job/status/timestamp metadata and a fixed result code/message; no credential, cookie, Live View URL, or browser-session data is stored.
- Completed records expire after 15 minutes; the store is capped at 1,000 jobs.
- Default jobs end as `not-verified` with `manual_interaction_required`; the API does not launch a browser.
- The configured service token was tested against the live API without exposing its value: health returned 200, unauthenticated protected requests returned 401, job creation returned 202, and status retrieval returned 200. A completed job was read again after a workflow restart.

## Not implemented or not verified

- Unattended session verification or a live Browserbase/Uber session.
- Distributed rate limiting; request limits remain per API process.
- Hatchable integration, deployment, or public production hardening.
- Fare scraping, ride booking, payments, or automated login/password/code entry.

Checkpoint 05 includes historical manual verification results; they were not repeated here. Checkpoint 08 tests confirm database persistence, API behavior, and locking only; they are not Browserbase verification.
