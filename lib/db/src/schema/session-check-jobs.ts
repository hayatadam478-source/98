import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const sessionCheckJobsTable = pgTable(
  "fairfare_session_check_jobs",
  {
    jobId: uuid("job_id").primaryKey(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    resultCode: text("result_code").notNull(),
    resultMessage: text("result_message").notNull(),
  },
  table => [
    index("fairfare_session_check_jobs_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export type SessionCheckJobRow = typeof sessionCheckJobsTable.$inferSelect;
