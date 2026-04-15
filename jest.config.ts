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
  setupFilesAfterFramework: [],
  verbose: true,
  forceExit: true,
  clearMocks: true,
};

export default config;
