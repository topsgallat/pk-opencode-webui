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

function mockFetchWithUser() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('api.github.com/user')) {
      return new Response(JSON.stringify({ id: 12345, login: 'octocat', name: 'Octo Cat', email: 'octo@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
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

  it('parses the live quota snapshot shape', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.includes('copilot_internal/user')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({
        quota_reset_date_utc: '2026-06-01T00:00:00.000Z',
        quota_snapshots: {
          premium_interactions: {
            entitlement: 300,
            remaining: 25,
            percent_remaining: 8.6,
            overage_count: 0,
            overage_permitted: false,
            quota_id: 'premium_interactions',
            unlimited: false,
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const provider = new CopilotProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.total).toBe(300)
    expect(result.entries[0]?.remaining).toBe(25)
    expect(result.entries[0]?.percentRemaining).toBe(8.6)
    expect(result.entries[0]?.resetTimeIso).toBe('2026-06-01T00:00:00.000Z')
  })

  it('attaches github identity when available', async () => {
    mockFetchWithUser()
    const provider = new CopilotProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.accounts).toHaveLength(1)
    expect(result.accounts?.[0]?.id).toBe('12345')
    expect(result.accounts?.[0]?.label).toBe('Octo Cat')
    expect(result.accounts?.[0]?.email).toBe('octo@example.com')
  })
})
