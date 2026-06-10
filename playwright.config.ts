import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
        url: `http://127.0.0.1:${port}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          ...process.env,
          ALLOW_PLAINTEXT_AUTH_USERS: process.env.ALLOW_PLAINTEXT_AUTH_USERS ?? "true",
        },
      },
});
