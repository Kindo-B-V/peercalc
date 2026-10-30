import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "@playwright/test";

const localEnv = new URL("../.env", import.meta.url);
if (existsSync(localEnv)) loadEnvFile(localEnv);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL:
      process.env.PEERCALC_TEST_URL ||
      `http://localhost:${process.env.PEERCALC_PORT || "8788"}`,
    viewport: { width: 1440, height: 1000 },
    // Authentication steps contain a private local password; do not retain traces.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
