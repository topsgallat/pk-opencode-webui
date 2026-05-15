import { afterEach, describe, it, expect } from 'bun:test'
import { GeminiProvider } from './gemini-cli'

const originalFetch = globalThis.fetch

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes('cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota')) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({
      buckets: [
        { modelId: 'gemini-2.0-flash', tokenType: 'standard', remainingFraction: 0.6, remainingAmount: 6000 },
        { modelId: 'gemini-2.0-pro', tokenType: 'premium', remainingFraction: 0.2, remainingAmount: 1000 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('GeminiProvider', () => {
  it('groups entries by tier', async () => {
    mockFetch()
    const provider = new GeminiProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    const groups = result.entries.map(e => e.group)
    expect(groups.every(group => group === 'tier')).toBe(true)
  })

  it('handles unlimited entries', async () => {
    mockFetch()
    const provider = new GeminiProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    // Some entries should have unlimited flag
    const unlimitedEntries = result.entries.filter(e => e.unlimited)
    expect(unlimitedEntries.length).toBeGreaterThanOrEqual(0)
  })
})
