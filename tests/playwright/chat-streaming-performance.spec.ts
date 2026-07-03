import { expect, test, type Page } from '@playwright/test';

const projectDir = '/home/opencode';
const selectionKey = `opencode.sessionSelections.local.${projectDir}`;

function baseUrl() {
  return process.env.TEST_BASE_URL || 'http://localhost:3000';
}

function sessionUrl() {
  return new URL('/L2hvbWUvb3BlbmNvZGU/session', baseUrl()).toString();
}

function promptToken() {
  return `PERF_CHAT_${Date.now()}`;
}

function visibleStop(page: Page) {
  return page.getByRole('button', { name: 'Stop generation' });
}

async function installPerfProbe(page: Page) {
  await page.evaluate(() => {
    const perf = {
      supported:
        typeof PerformanceObserver !== 'undefined' &&
        Array.isArray(PerformanceObserver.supportedEntryTypes) &&
        PerformanceObserver.supportedEntryTypes.includes('longtask'),
      longTasks: [] as Array<{ start: number; duration: number }>,
      frames: [] as number[],
      start: performance.now(),
    };

    (window as Window & { __perf?: typeof perf }).__perf = perf;

    if (perf.supported) {
      try {
        const observer = new PerformanceObserver((list) => {
          perf.longTasks.push(
            ...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })),
          );
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        perf.supported = false;
      }
    }

    let last = performance.now();
    const tick = (now: number) => {
      perf.frames.push(now - last);
      last = now;
      if (now - perf.start < 90_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function measureTurnToggleLatency(page: Page, expanded: string) {
  const button = page.getByRole('button', { name: /Collapse conversation turn|Expand conversation turn/ }).last();
  const started = Date.now();
  await button.click({ timeout: 5_000 });
  await expect(button).toHaveAttribute('aria-expanded', expanded, { timeout: 5_000 });
  return Date.now() - started;
}

async function measureFabClickLatency(page: Page) {
  const fab = page.getByRole('button', { name: 'Scroll to bottom' });
  const started = Date.now();
  await fab.click({ timeout: 5_000 });
  await expect(fab).toBeHidden({ timeout: 5_000 });
  return Date.now() - started;
}

async function measureStopLatency(page: Page) {
  const stop = visibleStop(page);
  const started = Date.now();
  await stop.click({ timeout: 5_000 });
  await expect(stop).toBeHidden({ timeout: 10_000 });
  return Date.now() - started;
}

async function readPerfProbe(page: Page) {
  return page.evaluate(() => {
    const perf = (window as Window & {
      __perf?: {
        supported: boolean;
        longTasks: Array<{ start: number; duration: number }>;
        frames: number[];
      };
    }).__perf;

    const frames = perf?.frames ?? [];
    const longTasks = perf?.longTasks ?? [];
    const sortedFrames = [...frames].sort((a, b) => a - b);
    const p95 = sortedFrames.length > 0 ? sortedFrames[Math.floor(sortedFrames.length * 0.95)] : 0;

    return {
      supported: perf?.supported ?? false,
      longTaskCount: longTasks.length,
      longTaskMax: longTasks.reduce((max, item) => Math.max(max, item.duration), 0),
      frameCount: frames.length,
      frameGapCount: frames.filter((gap) => gap > 50).length,
      frameGapMax: frames.reduce((max, gap) => Math.max(max, gap), 0),
      frameGapP95: p95,
    };
  });
}

async function createSession(page: Page) {
  await page.goto(sessionUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByLabel('Session list').getByRole('button', { name: 'New Session' }).click({ timeout: 20_000 });
  await page.waitForURL(/\/session\/ses_/, { timeout: 20_000 });
  return page.url().split('/').filter(Boolean).at(-1) ?? '';
}

test.describe('Chat streaming performance regression', () => {
  test.setTimeout(120_000);

  test('streams without placeholder or scroll regressions', async ({ page }, testInfo) => {
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const sessionID = await createSession(page);
    expect(sessionID.startsWith('ses_')).toBe(true);

    await page.evaluate(({ sessionID, selectionKey }) => {
      const model = { providerID: 'opencode', modelID: 'big-pickle' };
      const selections = JSON.parse(localStorage.getItem(selectionKey) || '{}');
      selections[sessionID] = { agent: 'build', model };
      localStorage.setItem(selectionKey, JSON.stringify(selections));
      localStorage.setItem('opencode.modelsByAgent.local', JSON.stringify({
        modelsByAgent: { build: model },
        variantsByAgent: { build: null },
      }));
    }, { sessionID, selectionKey });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await installPerfProbe(page);

    const token = promptToken();
    const composer = page.locator('textarea[placeholder^="Type a message"]');
    const send = page.getByRole('button', { name: 'Send message' });
    const stop = visibleStop(page);
    const scroller = page.locator('div.h-full.overflow-y-auto').first();
    const fab = page.getByRole('button', { name: 'Scroll to bottom' });

    await expect(page.getByRole('button', { name: /Model: Big Pickle/ })).toBeVisible({ timeout: 20_000 });

    const prompt = `${token}\nPrint the exact token on the first line, then count from 1 to 400 with one number per line. Do not use markdown tables or code blocks.`;
    await composer.fill(prompt);
    await send.click();

    await expect(stop).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(token, { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('(empty message)')).toHaveCount(0);

    await page.waitForFunction(() => {
      const el = document.querySelector('div.h-full.overflow-y-auto') as HTMLElement | null;
      if (!el) return false;
      return el.scrollHeight > el.clientHeight + 40;
    }, null, { timeout: 30_000 });

    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });

    await expect(scroller).toHaveJSProperty('scrollTop', 0);
    await expect(fab).toBeVisible({ timeout: 10_000 });

    const realInteractionLatencies = {
      collapseTurn: await measureTurnToggleLatency(page, 'false'),
      expandTurn: await measureTurnToggleLatency(page, 'true'),
      scrollToBottom: await measureFabClickLatency(page),
      stop: 0,
    };

    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(fab).toBeVisible({ timeout: 10_000 });
    realInteractionLatencies.stop = await measureStopLatency(page);
    await expect(page.getByText('(empty message)')).toHaveCount(0);

    await measureFabClickLatency(page);

    const perf = await readPerfProbe(page);
    await testInfo.attach('perf.json', {
      body: JSON.stringify(perf, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('console.json', {
      body: JSON.stringify(
        {
          consoleMessages,
          pageErrors,
          realInteractionLatencies,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(pageErrors).toEqual([]);
    expect(consoleMessages.filter((line) => line.includes('[Events] Received'))).toHaveLength(0);
    expect(consoleMessages.filter((line) => line.includes('message.part.delta'))).toHaveLength(0);
    expect(Math.max(realInteractionLatencies.collapseTurn, realInteractionLatencies.expandTurn, realInteractionLatencies.scrollToBottom)).toBeLessThan(2_000);
    expect(realInteractionLatencies.stop).toBeLessThan(5_000);
    expect(perf.frameCount).toBeGreaterThan(0);
  });
});
