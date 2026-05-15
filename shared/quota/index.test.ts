import { describe, it, expect } from 'bun:test'
import { getQuotaData } from './index'
import { CopilotProvider } from './providers/copilot'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini-cli'

describe('getQuotaData', () => {
  it('returns quota data structure', async () => {
    const result = await getQuotaData({})

    expect(result).toHaveProperty('ok')
    expect(result).toHaveProperty('fetchedAt')
    expect(result).toHaveProperty('providers')
    expect(result).toHaveProperty('summary')
    expect(result.providers.length).toBeGreaterThan(0)
    expect(result.summary.availableProviders.length).toBeGreaterThan(0)
  })

  it('handles provider filter', async () => {
    const result = await getQuotaData({ providerFilter: 'copilot' })

    // Should only include copilot if available
    expect(result.providers.length).toBeLessThanOrEqual(1)
  })

  it('handles refresh flag', async () => {
    const result = await getQuotaData({ refresh: true })

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
    const available = await provider.isAvailable()
    expect(typeof available).toBe('boolean')
  })

  it('returns quota view on fetch', async () => {
    const result = await provider.fetch({})

    expect(result.id).toBe('copilot')
    expect(result.status).toBe('ok')
    expect(Array.isArray(result.entries)).toBe(true)
  })
})

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('openai')
    expect(provider.name).toBe('OpenAI')
  })

  it('returns quota view on fetch', async () => {
    const result = await provider.fetch({})

    expect(result.id).toBe('openai')
    expect(Array.isArray(result.entries)).toBe(true)
  })
})

describe('GeminiProvider', () => {
  const provider = new GeminiProvider()

  it('has correct id and name', () => {
    expect(provider.id).toBe('gemini')
    expect(provider.name).toBe('Google Gemini')
  })

  it('returns quota view on fetch', async () => {
    const result = await provider.fetch({})

    expect(result.id).toBe('gemini')
    expect(Array.isArray(result.entries)).toBe(true)
  })
})
