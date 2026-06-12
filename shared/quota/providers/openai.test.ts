import { afterEach, beforeEach, describe, it, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OpenAIProvider } from './openai'

const originalFetch = globalThis.fetch
const originalHome = process.env.HOME
let home = ''

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

function writeStorage(data: unknown) {
  mkdirSync(join(home, '.opencode'), { recursive: true })
  writeFileSync(join(home, '.opencode', 'oc-codex-multi-auth-accounts.json'), JSON.stringify(data, null, 2), 'utf-8')
}

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env.HOME = originalHome
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = ''
  }
})

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pkui-openai-'))
  process.env.HOME = home
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

  it('loads multiple accounts from plugin storage and selects the active one', async () => {
    const calls: Array<string | null> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.includes('chatgpt.com/backend-api/wham/usage')) return new Response('not found', { status: 404 })
      const headers = new Headers(init?.headers)
      calls.push(headers.get('ChatGPT-Account-Id'))
      return new Response(JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 40, reset_at: '2026-05-15T10:00:00.000Z' },
          secondary_window: { used_percent: 20, reset_at: '2026-05-20T10:00:00.000Z' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const token1 = makeJwt({
      'https://api.openai.com/profile': { email: 'one@example.com' },
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' },
    })
    const token2 = makeJwt({
      'https://api.openai.com/profile': { email: 'two@example.com' },
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_2' },
    })

    writeStorage({
      version: 3,
      activeIndex: 1,
      activeIndexByFamily: { codex: 1 },
      accounts: [
        { accountId: 'acct_1', accountLabel: 'First', email: 'one@example.com', accessToken: token1, refreshToken: 'refresh-1' },
        { accountId: 'acct_2', accountLabel: 'Second', email: 'two@example.com', accessToken: token2, refreshToken: 'refresh-2' },
      ],
    })

    const provider = new OpenAIProvider()
    const result = await provider.fetch({})

    expect(result.accounts).toHaveLength(2)
    expect(result.activeAccountId).toBe('acct_2')
    expect(result.accounts?.find((account) => account.id === 'acct_2')?.active).toBe(true)
    expect(result.entries.map((entry) => entry.window)).toContain('hourly')
    expect(calls).toEqual(['acct_1', 'acct_2'])
  })

  it('accepts alternate reset field names', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.includes('chatgpt.com/backend-api/wham/usage')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 40, reset_time: '2026-05-15T10:00:00.000Z' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const provider = new OpenAIProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.entries[0]?.resetTimeIso).toBe('2026-05-15T10:00:00.000Z')
  })

  it('converts numeric reset timestamps', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.includes('chatgpt.com/backend-api/wham/usage')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({
        rate_limit: {
          primary_window: { used_percent: 40, reset_at: 1768471200 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const provider = new OpenAIProvider()
    const result = await provider.fetch({ resolveAuthHeader: () => 'Bearer test' })

    expect(result.entries[0]?.resetTimeIso).toBe('2026-01-15T10:00:00.000Z')
  })
})
