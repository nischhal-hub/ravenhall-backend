// Loads .env.test for the test run, never .env, and refuses any database that
// isn't a local test database. Used by the Jest global setup and by every
// test file (setupFiles), before the app or Prisma is imported.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export const TEST_ENV_PATH = path.resolve(__dirname, "../../../.env.test");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Throws unless `url` is a Postgres URL on this machine whose database name
 * contains "test". Protects the real (Neon) database from test writes.
 */
export function assertSafeTestDatabaseUrl(url: string | undefined): void {
  if (!url) {
    throw new Error(`DATABASE_URL is not set. Copy .env.test.example to .env.test.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing to run tests: DATABASE_URL in .env.test is not a valid URL.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  // Never print the URL itself: it may carry a password
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("Refusing to run tests: DATABASE_URL must be a postgresql:// URL.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run tests against host "${parsed.hostname}". Tests only run against a ` +
        "local Postgres (localhost). Start one with `pnpm test:db:up`.",
    );
  }
  if (!database.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run tests against database "${database}": the name must contain "test".`,
    );
  }
}

let loaded = false;

export function loadTestEnv(): void {
  if (loaded) return;
  if (!fs.existsSync(TEST_ENV_PATH)) {
    throw new Error("Missing .env.test. Copy .env.test.example to .env.test (see README → Tests).");
  }
  // override: a DATABASE_URL exported in the shell (or from .env) can't win
  dotenv.config({ path: TEST_ENV_PATH, override: true });
  // app.ts does `import 'dotenv/config'`; point it at .env.test too
  process.env.DOTENV_CONFIG_PATH = TEST_ENV_PATH;
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  loaded = true;
}
