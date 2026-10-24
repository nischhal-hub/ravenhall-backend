import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src/tests"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server.ts",
    "!src/**/*.d.ts",
    "!src/tests/**",
  ],
  // Tests use .env.test only (local Postgres, guarded); see src/tests/setup
  globalSetup: "<rootDir>/src/tests/setup/global-setup.ts",
  setupFiles: ["<rootDir>/src/tests/setup/env.setup.ts"],
  setupFilesAfterEnv: [],
  verbose: true,
  forceExit: true,
  clearMocks: true,
};

export default config;
