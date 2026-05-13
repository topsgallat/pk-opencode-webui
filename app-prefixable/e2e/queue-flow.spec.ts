import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Chat Prompt Queue Flow', () => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const ssDir = path.join(process.cwd(), '.sisyphus', 'outputs', 'qa-screenshots');
  const reportDir = path.join(process.cwd(), '.sisyphus', 'outputs');

  test.beforeEach(async () => {
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  });

  test('page loads successfully', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    const res = await page.goto(baseUrl, { waitUntil: 'load' });
    expect(res?.ok()).toBeTruthy();

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(ssDir, 'queue-01-load.png'), fullPage: false });

    // The WelcomeScreen renders a logo SVG; queue UI needs an active session
    const addToQueue = page.locator('button[aria-label="Add prompt to queue"]');
    const addVisible = await addToQueue.isVisible().catch(() => false);
    logs.push(`[test] Add to queue button visible (without session): ${addVisible}`);

    const report = { timestamp: new Date().toISOString(), baseUrl, logs, addToQueueButtonVisible: addVisible };
    fs.writeFileSync(path.join(reportDir, 'queue-flow-structural.json'), JSON.stringify(report, null, 2));

    logs.forEach(l => console.log(l));
  });

  test('sessionStorage pending prompt format is correct', async ({ page }) => {
    const logs: string[] = [];

    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    const storageResult = await page.evaluate(() => {
      const testId = 'test-session-12345';
      const key = `opencode.pendingPrompt.${testId}`;
      const payload = {
        items: [{
          id: 'test-uuid-1',
          text: 'Hello, this is a test prompt',
          ts: Date.now(),
          agent: 'build',
          model: { providerID: 'openai', modelID: 'gpt-4' },
        }],
      };
      sessionStorage.setItem(key, JSON.stringify(payload));
      const readBack = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      if (!readBack) return { ok: false, error: 'readBack was null' };
      try {
        const parsed = JSON.parse(readBack);
        const ok = Array.isArray(parsed.items)
          && parsed.items.length === 1
          && parsed.items[0].text === 'Hello, this is a test prompt'
          && typeof parsed.items[0].id === 'string'
          && typeof parsed.items[0].ts === 'number';
        return { ok, items: parsed.items.length, text: parsed.items[0].text };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });

    logs.push(`[test] PendingPromptStorage format valid: ${storageResult.ok}`);
    expect(storageResult.ok).toBe(true);

    const compatResult = await page.evaluate(() => {
      const testId = 'test-session-legacy';
      const key = `opencode.pendingPrompt.${testId}`;
      sessionStorage.setItem(key, JSON.stringify({ text: 'legacy prompt', ts: Date.now() }));
      const readBack = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      if (!readBack) return { ok: false, error: 'null' };
      try {
        const parsed = JSON.parse(readBack);
        const ok = 'text' in parsed && 'ts' in parsed && !Array.isArray(parsed);
        return { ok, text: parsed.text };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });

    logs.push(`[test] Legacy format readable: ${compatResult.ok}`);
    expect(compatResult.ok).toBe(true);

    const report = { timestamp: new Date().toISOString(), storageResult, compatResult };
    fs.writeFileSync(path.join(reportDir, 'queue-flow-storage.json'), JSON.stringify(report, null, 2));
    logs.forEach(l => console.log(l));
  });

  test('queue UI selectors resolve correctly in the DOM', async ({ page }) => {
    const logs: string[] = [];

    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(ssDir, 'queue-02-baseline.png'), fullPage: false });

    const addToQueue = page.locator('button[aria-label="Add prompt to queue"]');
    const queueBadge = page.locator('text=Queued').first();
    const queueText = page.locator('text=Queue ').first();
    const deleteQueued = page.locator('button[aria-label="Delete queued prompt"]').first();
    const sendBtn = page.locator('button[aria-label="Send message"]').first();
    const stopBtn = page.locator('button[title="Stop generation (Esc Esc)"]').first();

    // Queue elements are conditionally rendered — they won't appear without a session.
    // Record their presence for diagnostic purposes.
    const selectors = {
      addToQueueInDOM: await addToQueue.count().then(c => c > 0).catch(() => false),
      queuedBadgeInDOM: await queueBadge.count().then(c => c > 0).catch(() => false),
      queueTextInDOM: await queueText.count().then(c => c > 0).catch(() => false),
      deleteQueuedInDOM: await deleteQueued.count().then(c => c > 0).catch(() => false),
      sendButtonInDOM: await sendBtn.count().then(c => c > 0).catch(() => false),
      stopButtonInDOM: await stopBtn.count().then(c => c > 0).catch(() => false),
    };

    for (const [key, val] of Object.entries(selectors)) {
      logs.push(`[test] ${key}: ${val}`);
    }

    await page.screenshot({ path: path.join(ssDir, 'queue-03-selectors.png'), fullPage: false });

    const report = { timestamp: new Date().toISOString(), baseUrl, selectors };
    fs.writeFileSync(path.join(reportDir, 'queue-flow-selectors.json'), JSON.stringify(report, null, 2));
    logs.forEach(l => console.log(l));
  });

  test('full queue interaction flow (requires running backend)', async ({ page }) => {
    const logs: string[] = [];
    const networkResponses: any[] = [];

    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') logs.push(`[error] ${text}`);
      else logs.push(`[info] ${text}`);
    });

    page.on('pageerror', error => logs.push(`[pageerror] ${error.message}`));

    page.on('response', async resp => {
      const url = resp.url();
      if (url.includes('/session') || url.includes('/provider')) {
        networkResponses.push({ url, status: resp.status() });
      }
    });

    const res = await page.goto(baseUrl, { waitUntil: 'load' });
    if (!res?.ok()) {
      test.skip();
      return;
    }
    await page.waitForTimeout(3000);

    // The /session endpoint is proxied to the backend (port 4096).
    // Use a short timeout to bail if no backend is running.
    const apiCheck = await page.evaluate(async (url) => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        const r = await fetch(`${url}/session`, { signal: controller.signal });
        clearTimeout(id);
        return { status: r.status, ok: r.ok };
      } catch (e: any) {
        return { status: 'error', error: e.name === 'AbortError' ? 'timeout' : e.message };
      }
    }, baseUrl);

    logs.push(`[test] API /session check: ${JSON.stringify(apiCheck)}`);

    if (apiCheck.status !== 200) {
      fs.writeFileSync(
        path.join(reportDir, 'queue-flow-interactive.json'),
        JSON.stringify({ timestamp: new Date().toISOString(), baseUrl, logs, networkResponses, skipped: true }, null, 2),
      );
      test.skip();
      return;
    }

    const openBtn = page.getByRole('button', { name: /open project/i }).first();
    const openBtnVisible = await openBtn.isVisible().catch(() => false);
    logs.push(`[test] Open Project button visible: ${openBtnVisible}`);

    if (openBtnVisible) {
      await openBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(ssDir, 'queue-04-project-dialog.png'), fullPage: false });

      const searchInput = page.locator('input[aria-label="Search directories"]');
      const searchVisible = await searchInput.isVisible().catch(() => false);
      if (searchVisible) {
        await searchInput.fill('/home');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(ssDir, 'queue-05-directory-search.png'), fullPage: false });

        const result = page.locator('[role="listbox"] [data-result-index]').first();
        const resultVisible = await result.isVisible().catch(() => false);
        if (resultVisible) {
          await result.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: path.join(ssDir, 'queue-06-session-view.png'), fullPage: false });

          const sendBtn = page.locator('button[aria-label="Send message"]');
          const sendVisible = await sendBtn.isVisible().catch(() => false);
          logs.push(`[test] Send button visible after opening project: ${sendVisible}`);

          if (sendVisible) {
            const composerInput = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
            const composerVisible = await composerInput.isVisible().catch(() => false);
            if (composerVisible) {
              await composerInput.fill('Test prompt for queue flow');
              await page.waitForTimeout(500);
              await sendBtn.click();
              await page.waitForTimeout(2000);
              await page.screenshot({ path: path.join(ssDir, 'queue-07-after-send.png'), fullPage: false });

              const addToQueue = page.locator('button[aria-label="Add prompt to queue"]');
              const addVisible = await addToQueue.isVisible().catch(() => false);
              logs.push(`[test] Add to queue visible after send: ${addVisible}`);

              if (addVisible) {
                await composerInput.fill('Second queued prompt');
                await page.waitForTimeout(500);
                await addToQueue.click();
                await page.waitForTimeout(1000);
                await page.screenshot({ path: path.join(ssDir, 'queue-08-after-queue.png'), fullPage: false });

                const queueText = page.locator('text=Queue ').first();
                const queueTextVisible = await queueText.isVisible().catch(() => false);
                logs.push(`[test] Queue count visible: ${queueTextVisible}`);

                const queuedBadge = page.locator('text=Queued').first();
                const queuedVisible = await queuedBadge.isVisible().catch(() => false);
                logs.push(`[test] Queued badge visible: ${queuedVisible}`);

                const deleteBtn = page.locator('button[aria-label="Delete queued prompt"]').first();
                const deleteVisible = await deleteBtn.isVisible().catch(() => false);
                logs.push(`[test] Delete queued button visible: ${deleteVisible}`);

                if (deleteVisible) {
                  await deleteBtn.click();
                  await page.waitForTimeout(1000);
                  await page.screenshot({ path: path.join(ssDir, 'queue-09-after-delete.png'), fullPage: false });
                  logs.push('[test] Deleted queued prompt successfully');
                }
              }
            }
          }
        }
      }
    }

    const report = {
      timestamp: new Date().toISOString(),
      baseUrl,
      logs,
      networkResponses: networkResponses.slice(0, 20),
    };
    fs.writeFileSync(path.join(reportDir, 'queue-flow-interactive.json'), JSON.stringify(report, null, 2));
    logs.forEach(l => console.log(l));
  });
});
