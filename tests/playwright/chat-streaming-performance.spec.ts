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

async function installClickProbe(page: Page) {
  await page.evaluate(() => {
    document.querySelector('[data-testid="stream-click-probe"]')?.remove();

    const button = document.createElement('button');
    button.dataset.testid = 'stream-click-probe';
    button.textContent = 'stream click probe';
    button.style.position = 'fixed';
    button.style.left = '8px';
    button.style.top = '8px';
    button.style.zIndex = '2147483647';
    button.style.opacity = '0.01';
    button.style.pointerEvents = 'auto';

    const state = { clicks: [] as number[], started: 0 };
    (window as Window & { __streamClickProbe?: typeof state }).__streamClickProbe = state;

    button.addEventListener('click', () => {
      const probe = (window as Window & { __streamClickProbe?: typeof state }).__streamClickProbe;
      if (!probe) return;
      probe.clicks.push(performance.now() - probe.started);
    });

    document.body.appendChild(button);
  });
}

async function measureClickLatency(page: Page) {
  const count = await page.evaluate(() => {
    const probe = (window as Window & { __streamClickProbe?: { clicks: number[]; started: number } }).__streamClickProbe;
    if (!probe) return 0;
    probe.started = performance.now();
    return probe.clicks.length;
  });

  const started = Date.now();
  await page.locator('[data-testid="stream-click-probe"]').click({ timeout: 5_000 });
  const roundTrip = Date.now() - started;

  const handled = await page.waitForFunction((expectedCount) => {
    const probe = (window as Window & { __streamClickProbe?: { clicks: number[] } }).__streamClickProbe;
    return probe && probe.clicks.length > expectedCount ? probe.clicks[probe.clicks.length - 1] : null;
  }, count, { timeout: 5_000 });

  return {
    handlerLatency: (await handled.jsonValue()) as number,
    roundTrip,
  };
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
    await installClickProbe(page);

    const token = promptToken();
    const composer = page.locator('textarea[placeholder^="Type a message"]');
    const send = page.getByRole('button', { name: 'Send message' });
    const stop = visibleStop(page);
    const scroller = page.locator('div.h-full.overflow-y-auto').first();
    const fab = page.getByRole('button', { name: 'Scroll to bottom' });

    await expect(page.getByRole('button', { name: /Model: Big Pickle/ })).toBeVisible({ timeout: 20_000 });

    const prompt = `${token}\nPrint the exact token on the first line, then count from 1 to 180 with one number per line. Do not use markdown tables or code blocks.`;
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

    const clickLatencies = [];
    for (let i = 0; i < 3; i += 1) {
      clickLatencies.push(await measureClickLatency(page));
      await page.waitForTimeout(250);
    }

    await expect(stop).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText('(empty message)')).toHaveCount(0);

    await fab.click();
    await expect(fab).toBeHidden({ timeout: 10_000 });

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
          clickLatencies,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(pageErrors).toEqual([]);
    expect(consoleMessages.filter((line) => line.includes('[Events] Received'))).toHaveLength(0);
    expect(consoleMessages.filter((line) => line.includes('message.part.delta'))).toHaveLength(0);
    expect(clickLatencies.length).toBe(3);
    expect(Math.max(...clickLatencies.map((item) => item.roundTrip))).toBeLessThan(2_000);
    expect(Math.max(...clickLatencies.map((item) => item.handlerLatency))).toBeLessThan(1_000);
    expect(perf.frameCount).toBeGreaterThan(0);
  });
});
