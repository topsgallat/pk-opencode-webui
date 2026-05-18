import { afterEach, describe, it, expect } from 'bun:test'
import { OpenAIProvider } from './openai'

const originalFetch = globalThis.fetch

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.includes('chatgpt.com/backend-api/wham/usage')) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: 40, reset_at: '2026-05-15T10:00:00.000Z' },
        secondary_window: { used_percent: 20, reset_at: '2026-05-20T10:00:00.000Z' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

function makeJwt(payload: Record<string, unknown>) {
  const encode = (value: string) => Buffer.from(value).toString('base64url')
  return `${encode(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${encode(JSON.stringify(payload))}.signature`
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('OpenAIProvider', () => {
  it('includes multiple window types', async () => {
    mockFetch()
    const provider = new OpenAIProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    const windows = result.entries.map(e => e.window)
    expect(windows).toContain('hourly')
    expect(windows).toContain('weekly')
  })

  it('calculates percentages correctly', async () => {
    mockFetch()
    const provider = new OpenAIProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    result.entries.forEach(entry => {
      if (entry.percentUsed !== undefined && entry.percentRemaining !== undefined) {
        expect(entry.percentUsed + entry.percentRemaining).toBeCloseTo(100, 1)
      }
    })
  })

  it('surfaces account identity from jwt claims', async () => {
    mockFetch()
    const provider = new OpenAIProvider()
    const token = makeJwt({
      'https://api.openai.com/profile': { email: 'dev@example.com' },
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    const result = await provider.fetch({ resolveAuthHeader: () => `Bearer ${token}` })

    expect(result.accounts).toHaveLength(1)
    expect(result.accounts?.[0]?.id).toBe('acct_123')
    expect(result.accounts?.[0]?.label).toBe('dev@example.com')
    expect(result.accounts?.[0]?.email).toBe('dev@example.com')
    expect(result.accounts?.[0]?.entries).toHaveLength(result.entries.length)
  })
})
