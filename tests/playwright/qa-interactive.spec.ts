import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('QA interactive flow - proxied API calls', async ({ page }) => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8080';
  const consoleErrors: string[] = [];
  const networkResponses: any[] = [];
  const actionsLog: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  // Track proxied API responses
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/session') || url.includes('/provider') || url.includes('/path') || url.includes('/mcp') || url.includes('/event')) {
      const headers: Record<string,string> = {};
      const respHeaders = resp.headers();
      for (const [k, v] of Object.entries(respHeaders)) headers[k] = v;
      networkResponses.push({
        url,
        status: resp.status(),
        headers,
        hasContentEncoding: !!headers['content-encoding'],
      });
    }
  });

  // Navigate to app (use 'load' not 'networkidle' — SSE keeps connection open)
  actionsLog.push(`[1] Navigate to ${baseUrl}`);
  const res = await page.goto(baseUrl, { waitUntil: 'load' });
  actionsLog.push(`[1] → status: ${res?.status()}`);

  // Wait for initial JS to settle
  await page.waitForTimeout(4000);

  // Screenshot: initial state
  const ssDir = path.join(process.cwd(), '.sisyphus', 'outputs', 'qa-screenshots');
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  await page.screenshot({ path: path.join(ssDir, '01-initial-load.png'), fullPage: false });
  actionsLog.push('[1] Screenshot taken: 01-initial-load.png');

  // Action 1: try to click a session-related button
  try {
    const sessionBtn = page.getByRole('button', { name: /new session|session|start/i }).first();
    const visible = await sessionBtn.isVisible().catch(() => false);
    if (visible) {
      await sessionBtn.click();
      await page.waitForTimeout(1500);
      actionsLog.push('[2] Clicked session button');
    } else {
      const btns = page.getByRole('button');
      const count = await btns.count();
      actionsLog.push(`[2] No session button found; ${count} total buttons present`);
      if (count > 0) {
        const firstBtn = btns.first();
        const firstLabel = (await firstBtn.getAttribute('aria-label') ?? await firstBtn.textContent() ?? 'unknown').trim().slice(0, 80);
        actionsLog.push(`[2] Clicking first available button: "${firstLabel}"`);
        await firstBtn.click().catch(e => actionsLog.push(`[2] Click failed: ${e.message}`));
        await page.waitForTimeout(1500);
      }
    }
    await page.screenshot({ path: path.join(ssDir, '02-after-action1.png'), fullPage: false });
  } catch (e: any) {
    actionsLog.push(`[2] Action1 error: ${e.message}`);
  }

  // Action 2: direct fetch of /session and /provider from browser context to verify proxy
  const apiCheck = await page.evaluate(async (url) => {
    const results: any[] = [];
    for (const ep of ['/session', '/provider']) {
      try {
        const r = await fetch(`${url}${ep}`);
        const headers: Record<string, string> = {};
        r.headers.forEach((v, k) => { headers[k] = v; });
        results.push({
          endpoint: ep,
          status: r.status,
          hasContentEncoding: 'content-encoding' in headers,
          contentLength: headers['content-length'] ?? null,
          contentType: headers['content-type'] ?? null,
        });
      } catch (e: any) {
        results.push({ endpoint: ep, error: e.message });
      }
    }
    return results;
  }, baseUrl);
  actionsLog.push(`[3] In-page API check: ${JSON.stringify(apiCheck)}`);
  await page.screenshot({ path: path.join(ssDir, '03-after-api-check.png'), fullPage: false });

  // Evaluate results
  const failingEndpoints = [
    ...networkResponses.filter(r => r.status >= 400 || r.hasContentEncoding),
    ...apiCheck.filter((r: any) => r.error || r.status >= 400 || r.hasContentEncoding),
  ];
  const verdict = (consoleErrors.length === 0 && failingEndpoints.length === 0) ? 'pass' : 'fail';

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    verdict,
    consoleErrors,
    failingEndpoints,
    apiCheck,
    networkResponses: networkResponses.slice(0, 20),
    actionsLog,
    inheritedWisdom: [
      "Proxy strips Accept-Encoding and materializes upstream response bodies.",
      "Gzip magic guard: only gunzip when first two bytes are 0x1f,0x8b.",
      "Previous Playwright SSE run: verdict=pass, consoleErrors=[], all 4 proxied endpoints HTTP 200, no Content-Encoding."
    ]
  };

  const outPath = path.join(process.cwd(), '.sisyphus', 'outputs', 'qa-functional-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(failingEndpoints, `Failing endpoints: ${JSON.stringify(failingEndpoints)}`).toHaveLength(0);
});
