import { test, expect } from '@playwright/test';

test.describe('Fullscreen Preview Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  });

  test('Maximize2 button visible for .md files in preview mode', async ({ page }) => {
    test.skip();
  });

  test('Maximize2 button visible for .html files in preview mode', async ({ page }) => {
    test.skip();
  });

  test('Fullscreen overlay appears when Maximize2 clicked', async ({ page }) => {
    test.skip();
  });

  test('X button closes fullscreen overlay', async ({ page }) => {
    test.skip();
  });

  test('ESC key closes fullscreen overlay', async ({ page }) => {
    test.skip();
  });

  test('Minimize2 button exits fullscreen', async ({ page }) => {
    test.skip();
  });
});
