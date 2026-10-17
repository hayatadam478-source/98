# Secrets setup

Store real values in Replit Secrets only. Never put them in source files, checkpoint ZIPs, browser-side JavaScript, or chat.

## API

- `WORKER_SERVICE_TOKEN` — required for protected session-check routes; the API returns 503 until a value of at least 32 non-whitespace characters is configured. Generate a cryptographically random token and pass it only from trusted server-side code.

If the API returns `503 service_not_configured`, confirm this key exists in the current project's Replit Secrets, contains at least 32 non-whitespace characters, and restart the API workflow.

To generate a fresh 32-byte random token in the Replit Shell, run this command and copy its output directly into Replit Secrets. Never paste the value into chat, source files, browser-side JavaScript, or checkpoint ZIPs:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Interactive Browserbase CLI

- `BROWSERBASE_API_KEY` — required only for the preserved manual CLI. Rotate any key that was previously exposed.
- `BROWSERBASE_PROJECT_ID` and `BROWSERBASE_CONTEXT_ID` — required only by the CLI; the non-secret example values are in `.env.example`.

The HTTP API does not use Browserbase credentials and never starts the CLI. Browserbase context state and cookies are external and not included in checkpoint archives.

`FAIRFARE_API_KEY` and `SESSION_SECRET` are not used by this project.
