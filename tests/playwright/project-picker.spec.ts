import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('project picker: type ~/ and check results', async ({ page }) => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://192.168.1.173:8090';
  const consoleLogs: string[] = [];
  const networkRequests: any[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('[ProjectDialog') && !text.includes('[searchDirectories') && !text.includes('[getDirs')) return;
    consoleLogs.push(`[${msg.type()}] ${text}`);
  });

  page.on('request', req => {
    const url = req.url();
    if (url.includes('/file') || url.includes('/path')) {
      networkRequests.push({ url, method: req.method() });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/file') || url.includes('/path')) {
      try {
        const body = await resp.text();
        networkRequests.push({ url, status: resp.status(), body: body.slice(0, 500) });
      } catch {}
    }
  });

  // Navigate to app
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const openBtn = page.getByRole('button', { name: /open project/i }).first();
  await openBtn.click();
  await page.waitForTimeout(2000);

  const input = page.locator('input[aria-label="Search directories"]');
  await input.fill('~/');
  await page.waitForTimeout(3000);

  const ssDir = path.join(process.cwd(), '.sisyphus', 'outputs', 'qa-screenshots');
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  await page.screenshot({ path: path.join(ssDir, 'project-picker-tilde-slash.png'), fullPage: false });

  const results = page.locator('[role="listbox"] [data-result-index]');
  const count = await results.count();
  consoleLogs.push(`[test] Results count: ${count}`);

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    consoleLogs,
    networkRequests: networkRequests.slice(0, 10),
    resultCount: count,
  };
  const outPath = path.join(process.cwd(), '.sisyphus', 'outputs', 'project-picker-debug.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  consoleLogs.forEach(log => console.log(log));
});
