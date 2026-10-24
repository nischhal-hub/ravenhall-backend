// Runs once before the whole suite: applies migrations to the local test
// database. If the database isn't running, the mocked suites still run and the
// database suites fail with a clear message (see useTestDatabase).
import { execFileSync } from "child_process";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./test-env";

async function databaseReachable(): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

export default async function globalSetup(): Promise<void> {
  loadTestEnv();

  if (!(await databaseReachable())) {
    process.env.TEST_DB_UNAVAILABLE = "1";
    console.warn(
      "\n[tests] Local test database is not reachable; database suites will fail. " +
        "Start it with `pnpm test:db:up`.\n",
    );
    return;
  }

  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: path.resolve(__dirname, "../../.."),
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
