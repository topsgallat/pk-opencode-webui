import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('SSE and API decoding verification', () => {
  test('should not have ERR_CONTENT_DECODING_FAILED', async ({ page }) => {
    const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8080';
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      consoleErrors.push(error.message);
    });

    const res = await page.goto(baseUrl, { waitUntil: 'load' });
    if (!res?.ok()) {
      throw new Error(`Failed to load app at ${baseUrl}: ${res?.status()} ${res?.statusText()}`);
    }

    const testResult = await page.evaluate(async (url) => {
      return new Promise<any>((resolve) => {
        const sseState = { connected: false, eventsCount: 0, lastEvent: undefined as string | undefined };
        const apiResponses: any = {};
        const fetchPromises: Promise<void>[] = [];

        const es = new EventSource(`${url}/event`);
        es.onopen = () => {
          sseState.connected = true;
        };
        es.onmessage = (e) => {
          sseState.eventsCount++;
          sseState.lastEvent = e.data;
        };
        es.onerror = () => {};

        const endpoints = ['/session', '/provider', '/path', '/mcp'];
        for (const ep of endpoints) {
          const p = fetch(`${url}${ep}`)
            .then(async res => {
              const headers: Record<string, string> = {};
              res.headers.forEach((value, key) => {
                headers[key] = value;
              });
              apiResponses[ep.replace('/', '')] = {
                status: res.status,
                headers: headers
              };
              await res.text().catch(() => {});
            })
            .catch(err => {
              apiResponses[ep.replace('/', '')] = {
                status: 'error',
                error: err.message
              };
            });
          fetchPromises.push(p);
        }

        setTimeout(async () => {
          await Promise.all(fetchPromises);
          es.close();
          resolve({ sse: sseState, apiResponses });
        }, 10000);
      });
    }, baseUrl);

    await page.waitForTimeout(1000);

    const hasDecodingError = consoleErrors.some(err => 
      err.includes('ERR_CONTENT_DECODING_FAILED') || 
      err.includes('content decoding failed') || 
      err.includes('Decoding failed')
    );

    const verdict = hasDecodingError ? "fail" : "pass";

    const resultObj = {
      timestamp: new Date().toISOString(),
      baseUrl,
      consoleErrors,
      sse: testResult.sse,
      apiResponses: testResult.apiResponses,
      verdict,
      inheritedWisdom: [
        "The proxy now strips Accept-Encoding from proxied requests and materializes upstream response bodies, then strips content-encoding/transfer-encoding and sets Content-Length.",
        "A gzip-magic guard was added: only attempt gunzip when first two bytes are 0x1f,0x8b.",
        "Curl checks show Content-Encoding is no longer present for many JSON endpoints, but browser-level verification is still pending."
      ]
    };

    const outDir = path.join(process.cwd(), '.sisyphus', 'outputs');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outDir, 'playwright-sse-result.json'), JSON.stringify(resultObj, null, 2));

    expect(hasDecodingError).toBeFalsy();
  });
});
