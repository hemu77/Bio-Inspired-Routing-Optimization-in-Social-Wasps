import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.LAB_URL || "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 960 },
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    launchOptions: {args: process.env.CI ? ['--enable-unsafe-swiftshader'] : []},
  },
  webServer: process.env.LAB_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
      },
  reporter: "list",
});
