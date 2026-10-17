import { createApp } from "./app";
import { logger } from "./lib/logger";
import {
  PostgresSessionCheckContextLockProvider,
  PostgresSessionCheckStore,
} from "./lib/postgres-session-check-storage";
import { createSessionCheckService } from "./lib/session-check-service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const sessionCheckStore = new PostgresSessionCheckStore();
const contextLockProvider = new PostgresSessionCheckContextLockProvider();
const app = createApp({
  sessionCheck: {
    store: sessionCheckStore,
    contextLockProvider,
  },
});

async function startServer(): Promise<void> {
  await createSessionCheckService({
    store: sessionCheckStore,
    contextLockProvider,
  }).recoverInterruptedJobs();

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

void startServer().catch(() => {
  logger.error(
    "Unable to initialize persistent session-check storage.",
  );
  process.exit(1);
});
