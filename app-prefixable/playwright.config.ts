import { defineConfig, devices } from '@playwright/test';
import getCloakBrowserLaunchOptions from '../tests/playwright/cloakbrowser.cjs';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['html', { open: 'never' }]],
  globalSetup: '../tests/playwright/cloakbrowser-setup.cjs',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: getCloakBrowserLaunchOptions(),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
