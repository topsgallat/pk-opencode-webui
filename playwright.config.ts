import { defineConfig, devices } from '@playwright/test';
import getCloakBrowserLaunchOptions from './tests/playwright/cloakbrowser.cjs';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 60000,
  globalSetup: './tests/playwright/cloakbrowser-setup.cjs',
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    headless: true,
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
