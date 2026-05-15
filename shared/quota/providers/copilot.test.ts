import { afterEach, describe, it, expect } from 'bun:test'
import { CopilotProvider } from './copilot'

const originalFetch = globalThis.fetch

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes('copilot_internal/user')) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({ quota: { limit: 200, used: 100, remaining: 100, percent_remaining: 50, reset_at: '2026-05-15T10:00:00.000Z' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('CopilotProvider', () => {
  it('normalizes quota entries correctly', async () => {
    mockFetch()
    const provider = new CopilotProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    result.entries.forEach(entry => {
      expect(entry).toHaveProperty('id')
      expect(entry).toHaveProperty('label')
      if (entry.used !== undefined && entry.total !== undefined) {
        expect(entry.used).toBeLessThanOrEqual(entry.total)
      }
    })
  })
})
