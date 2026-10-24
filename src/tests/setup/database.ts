// For suites that use the real (local test) database. Call useTestDatabase()
// at the top of the file: every table is emptied before the suite starts, so
// suites don't depend on each other, on run order, or on earlier runs.
import { prisma } from "../../config/database";
import { assertSafeTestDatabaseUrl } from "./test-env";

export async function resetDatabase(): Promise<void> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function useTestDatabase(): void {
  beforeAll(async () => {
    if (process.env.TEST_DB_UNAVAILABLE === "1") {
      throw new Error("Local test database is not running. Start it with `pnpm test:db:up`.");
    }
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
}
