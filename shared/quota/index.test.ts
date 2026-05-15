import { afterEach, describe, expect, it } from 'bun:test'
import { getQuotaData } from './index'
import { CopilotProvider } from './providers/copilot'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini-cli'

const originalFetch = globalThis.fetch

function installQuotaFetchMock() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('copilot_internal/user')) {
      return new Response(JSON.stringify({
        quota: { limit: 200, used: 100, remaining: 100, percent_remaining: 50, reset_at: '2026-05-15T10:00:00.000Z' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.includes('chatgpt.com/backend-api/wham/usage')) {
      return new Response(JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 40, reset_at: '2026-05-15T10:00:00.000Z' },
          secondary_window: { used_percent: 20, reset_at: '2026-05-20T10:00:00.000Z' },
          code_review_rate_limit: { primary_window: { used_percent: 10, reset_at: '2026-05-15T12:00:00.000Z' } },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.includes('cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota')) {
      return new Response(JSON.stringify({
        buckets: [
          { modelId: 'gemini-2.0-flash', tokenType: 'standard', remainingFraction: 0.6, remainingAmount: 6000, resetTimeIso: '2026-05-15T10:00:00.000Z' },
          { modelId: 'gemini-2.0-pro', tokenType: 'premium', remainingFraction: 0.2, remainingAmount: 1000, resetTimeIso: '2026-05-15T10:00:00.000Z' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('getQuotaData', () => {
  it('returns quota data structure', async () => {
    installQuotaFetchMock()
    const result = await getQuotaData({ resolveAuthHeader: () => 'Bearer test' })

    expect(result).toHaveProperty('ok')
    expect(result).toHaveProperty('fetchedAt')
    expect(result).toHaveProperty('providers')
    expect(result).toHaveProperty('summary')
    expect(result.providers.length).toBeGreaterThan(0)
    expect(result.summary.availableProviders.length).toBeGreaterThan(0)
  })

  it('handles provider filter', async () => {
    installQuotaFetchMock()
    const result = await getQuotaData({ providerFilter: 'copilot', resolveAuthHeader: () => 'Bearer test' })

    // Should only include copilot if available
    expect(result.providers.length).toBeLessThanOrEqual(1)
  })

  it('handles refresh flag', async () => {
    installQuotaFetchMock()
    const result = await getQuotaData({ refresh: true, resolveAuthHeader: () => 'Bearer test' })

    expect(result.refreshed).toBe(true)
    expect(result.source).toBe('live')
  })
})

describe('CopilotProvider', () => {
  const provider = new CopilotProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('copilot')
    expect(provider.name).toBe('GitHub Copilot')
  })

  it('implements isAvailable', async () => {
    const available = await provider.isAvailable({ resolveAuthHeader: () => 'Bearer test' })
    expect(typeof available).toBe('boolean')
    expect(available).toBe(true)
  })

  it('returns quota view on fetch', async () => {
    installQuotaFetchMock()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.id).toBe('copilot')
    expect(result.status).toBe('ok')
    expect(Array.isArray(result.entries)).toBe(true)
    expect(result.entries[0]?.used).toBe(100)
  })
})

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('openai')
    expect(provider.name).toBe('OpenAI')
  })

  it('returns quota view on fetch', async () => {
    installQuotaFetchMock()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.id).toBe('openai')
    expect(Array.isArray(result.entries)).toBe(true)
    expect(result.entries.map(entry => entry.window)).toContain('hourly')
  })
})

describe('GeminiProvider', () => {
  const provider = new GeminiProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('gemini')
    expect(provider.name).toBe('Google Gemini')
  })

  it('returns quota view on fetch', async () => {
    installQuotaFetchMock()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.id).toBe('gemini')
    expect(Array.isArray(result.entries)).toBe(true)
    expect(result.entries[0]?.remaining).toBe(6000)
  })
})
