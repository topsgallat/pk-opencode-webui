import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('project picker: open project dialog and type ~/ to see directories', async ({ page }) => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://192.168.1.173:8090';
  const consoleLogs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
  });

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const openBtn = page.getByRole('button', { name: /open project/i }).first();
  await openBtn.click();
  await page.waitForTimeout(1500);

  const input = page.locator('input[aria-label="Search directories"]');
  
  await input.fill('~/');
  await page.waitForTimeout(2000);

  const ssDir = path.join(process.cwd(), '.sisyphus', 'outputs', 'qa-screenshots');
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  await page.screenshot({ path: path.join(ssDir, 'project-picker-tilde-slash-2.png'), fullPage: false });

  const results = page.locator('[role="listbox"] [data-result-index]');
  const count = await results.count();
  consoleLogs.push(`[test] Results count after ~/ : ${count}`);

  if (count > 0) {
    const firstResult = await results.first().textContent();
    consoleLogs.push(`[test] First result: "${firstResult}"`);
  }

  const noMatch = page.getByText(/no matching/i).first();
  const hasNoMatch = await noMatch.isVisible().catch(() => false);
  consoleLogs.push(`[test] Has "No matching" message: ${hasNoMatch}`);

  await input.fill('/');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(ssDir, 'project-picker-root-2.png'), fullPage: false });

  const rootResults = page.locator('[role="listbox"] [data-result-index]');
  const rootCount = await rootResults.count();
  consoleLogs.push(`[test] Results count after / : ${rootCount}`);

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    consoleLogs,
    tildeSlashCount: count,
    rootSlashCount: rootCount,
    hasNoMatchMessage: hasNoMatch,
  };
  const outPath = path.join(process.cwd(), '.sisyphus', 'outputs', 'project-picker-full-test.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  consoleLogs.forEach(log => console.log(log));
  
  console.log(`\n=== RESULT ===`);
  console.log(`~/ results: ${count}`);
  console.log(`/ results: ${rootCount}`);
  console.log(`Has "No matching": ${hasNoMatch}`);
});