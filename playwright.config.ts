import { defineConfig, devices } from '@playwright/test';

const basicAuthUsername = process.env.PLAYWRIGHT_BASIC_AUTH_USERNAME;
const basicAuthPassword = process.env.PLAYWRIGHT_BASIC_AUTH_PASSWORD;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_BASE_URL ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4000',
    trace: 'on-first-retry',
    httpCredentials: basicAuthUsername && basicAuthPassword
      ? { username: basicAuthUsername, password: basicAuthPassword }
      : undefined,
  },
  projects: [
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm start', url: 'http://127.0.0.1:4000/health', reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
});
