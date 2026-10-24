// The test setup must never point at a remote/production database.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { assertSafeTestDatabaseUrl, TEST_ENV_PATH } from "./setup/test-env";

describe("Test database guard", () => {
  it.each([
    ["a Neon host", "postgresql://user:pw@ep-cool-name-123.ap-southeast-2.aws.neon.tech/neondb?sslmode=require"],
    ["any remote host, even with a test name", "postgresql://user:pw@db.example.com:5432/ravenhall_test"],
    ["a local database without 'test' in its name", "postgresql://postgres@localhost:5432/ravenhall_db"],
    ["a non-Postgres URL", "mysql://root@localhost/ravenhall_test"],
    ["a missing URL", undefined],
  ])("refuses %s", (_label, url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).toThrow(/Refusing|not set/);
  });

  it("never prints the URL (it may contain a password)", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:s3cret@ep-x.neon.tech/neondb"),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("s3cret") }));
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5433/ravenhall_test",
    "postgres://postgres@127.0.0.1/my_test_db",
  ])("accepts the local test database %s", (url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).not.toThrow();
  });

  it("this run uses .env.test, not .env", () => {
    const fromTestEnv = dotenv.parse(fs.readFileSync(TEST_ENV_PATH)).DATABASE_URL;
    expect(process.env.DATABASE_URL).toBe(fromTestEnv);
    expect(process.env.DOTENV_CONFIG_PATH).toBe(TEST_ENV_PATH);
    expect(path.basename(TEST_ENV_PATH)).toBe(".env.test");
  });
});
