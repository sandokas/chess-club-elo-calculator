import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Tests share a single real Postgres test DB and TRUNCATE between tests
    // (see TESTING.md). Running files in parallel would cause TRUNCATEs from
    // one file to wipe rows seeded by another. Force sequential file execution.
    fileParallelism: false
  }
});
