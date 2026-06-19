import { QuotaAccountView, QuotaEntryView } from "./quota/types"

type AnthropicQuotaWindow = {
  id: string
  label: string
  subtitle: string
  window: NonNullable<QuotaEntryView["window"]>
}

export type AnthropicQuotaOps = {
  run?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string } | null>
  readText?: (path: string) => Promise<string | undefined>
  fetch?: typeof fetch
  now?: () => number
}

type AnthropicQuotaSource = {
  entries: QuotaEntryView[]
  accounts?: QuotaAccountView[]
  warning?: string
  error?: string
  cooldownUntil?: string
}

type AnthropicQuotaCacheEntry = {
  at: number
  value: AnthropicQuotaSource
  cooldownUntil?: number
}

const WINDOWS: AnthropicQuotaWindow[] = [
  { id: "five_hour", label: "Claude 5h", subtitle: "Five-hour window", window: "hourly" },
  { id: "seven_day", label: "Claude 7d", subtitle: "Seven-day window", window: "weekly" },
]

const CACHE_MS = 10_000
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000
const cache = new Map<string, AnthropicQuotaCacheEntry>()

function nowMs(ops?: AnthropicQuotaOps): number {
  return ops?.now?.() ?? Date.now()
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }

  const text = asString(value)
  return text || undefined
}

function lower(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function findWindowValue(value: unknown, target: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWindowValue(item, target)
      if (found) return found
    }
    return undefined
  }

  if (!isObject(value)) return undefined

  for (const [key, child] of Object.entries(value)) {
    if (lower(key) === target) {
      if (isObject(child)) return child
      return undefined
    }
  }

  for (const child of Object.values(value)) {
    const found = findWindowValue(child, target)
    if (found) return found
  }

  return undefined
}

function pickWindowRoot(data: unknown): Record<string, unknown> | undefined {
  if (isObject(data)) return data
  return undefined
}

function findPercent(raw: Record<string, unknown>): number | undefined {
  const keys = ["utilization", "used_percentage", "usedPercentage", "used_percent", "usedPercent", "percent_used", "percentUsed"]
  for (const key of keys) {
    const value = asNumber(raw[key])
    if (value !== undefined) return value
  }
  return undefined
}

function findReset(raw: Record<string, unknown>): string | undefined {
  const keys = ["resets_at", "resetsAt", "reset_at", "resetAt", "reset_time", "resetTime"]
  for (const key of keys) {
    const text = asIso(raw[key])
    if (text) return text
  }
  return undefined
}

function buildEntry(spec: AnthropicQuotaWindow, raw: Record<string, unknown>): QuotaEntryView | undefined {
  const usedPercent = findPercent(raw)
  const resetTimeIso = findReset(raw)
  const limit = asNumber(raw.limit ?? raw.total ?? raw.quota)
  const remaining = asNumber(raw.remaining ?? raw.remaining_tokens)
  const used = asNumber(raw.used ?? raw.used_tokens)

  const percentRemaining = remaining !== undefined && limit !== undefined
    ? Math.max(0, (remaining / limit) * 100)
    : usedPercent !== undefined
      ? Math.max(0, 100 - usedPercent)
      : undefined

  const resolvedUsed = used ?? (limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : undefined)
  const resolvedRemaining = remaining ?? (limit !== undefined && resolvedUsed !== undefined ? Math.max(0, limit - resolvedUsed) : undefined)

  if (usedPercent === undefined && resetTimeIso === undefined && resolvedUsed === undefined && resolvedRemaining === undefined && percentRemaining === undefined) {
    return undefined
  }

  return {
    id: spec.id,
    group: "usage",
    label: spec.label,
    subtitle: spec.subtitle,
    used: resolvedUsed,
    remaining: resolvedRemaining,
    percentUsed: usedPercent,
    percentRemaining,
    resetTimeIso,
    window: spec.window,
    unlimited: false,
  }
}

function parseQuota(data: unknown): QuotaEntryView[] {
  const root = pickWindowRoot(data)
  if (!root) return []

  const entries: QuotaEntryView[] = []
  for (const spec of WINDOWS) {
    const found = findWindowValue(root, lower(spec.id))
    if (!found) continue
    const entry = buildEntry(spec, found)
    if (entry) entries.push(entry)
  }
  return entries
}

function isRemoteTarget(targetUrl?: string): boolean {
  if (!targetUrl) return false
  try {
    const host = new URL(targetUrl).hostname.toLowerCase()
    return !["localhost", "127.0.0.1", "::1"].includes(host)
  } catch {
    return false
  }
}

function parseRetryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const at = Date.parse(value)
  if (Number.isNaN(at)) return undefined

  return Math.max(0, at - now)
}

function withWarning(value: AnthropicQuotaSource, warning: string): AnthropicQuotaSource {
  return {
    ...value,
    warning: value.warning ? `${value.warning} ${warning}` : warning,
  }
}

class AnthropicQuotaRateLimitError extends Error {
  retryAfterMs?: number

  constructor(message: string, retryAfterMs?: number) {
    super(message)
    this.retryAfterMs = retryAfterMs
  }
}

function isAnthropicQuotaRateLimitError(error: unknown): error is AnthropicQuotaRateLimitError {
  if (error instanceof AnthropicQuotaRateLimitError) return true
  if (!(error instanceof Error)) return false

  return /Anthropic OAuth usage HTTP 429|rate_limit_error/i.test(error.message)
}

async function runCommand(args: string[], ops?: AnthropicQuotaOps): Promise<{ code: number; stdout: string; stderr: string } | null> {
  if (ops?.run) return await ops.run(args)

  try {
    const binary = process.env.CLAUDE_BINARY_PATH?.trim() || "claude"
    const proc = Bun.spawn([binary, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return { code, stdout, stderr }
  } catch {
    return null
  }
}

async function readText(path: string, ops?: AnthropicQuotaOps): Promise<string | undefined> {
  if (ops?.readText) return await ops.readText(path)
  try {
    return await Bun.file(path).text()
  } catch {
    return undefined
  }
}

function extractToken(data: unknown): string | undefined {
  if (!isObject(data)) return undefined

  const directKeys = ["accessToken", "access_token", "token"]
  for (const key of directKeys) {
    const value = asString(data[key])
    if (value) return value
  }

  const nested = ["oauth", "claudeAiOauth", "claude_ai_oauth", "auth"]
  for (const key of nested) {
    const child = data[key]
    if (!isObject(child)) continue
    const nestedToken = extractToken(child)
    if (nestedToken) return nestedToken
  }

  return undefined
}

function extractAccount(data: unknown): QuotaAccountView | undefined {
  if (!isObject(data)) return undefined

  const email = asString(data.email)
  const orgName = asString(data.orgName)
  const orgId = asString(data.orgId)
  const subscriptionType = asString(data.subscriptionType)
  const loggedIn = data.loggedIn === true

  if (!loggedIn && !email && !orgName && !orgId) return undefined

  const label = orgName || email || subscriptionType || "Claude account"

  return {
    id: orgId || email || label,
    label,
    email,
    entries: [],
  }
}

async function loadOAuthUsage(token: string, ops?: AnthropicQuotaOps): Promise<AnthropicQuotaSource> {
  const fetchFn = ops?.fetch || fetch
  const now = nowMs(ops)
  const res = await fetchFn("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      accept: "application/json",
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    if (res.status === 429) {
      throw new AnthropicQuotaRateLimitError(
        `Anthropic OAuth usage HTTP 429${body ? `: ${body.slice(0, 200)}` : ""}`,
        parseRetryAfterMs(res.headers.get("retry-after"), now),
      )
    }
    throw new Error(`Anthropic OAuth usage HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }

  const data = await res.json() as unknown
  const entries = parseQuota(data)
  return { entries }
}

async function loadCredentials(home: string, ops?: AnthropicQuotaOps): Promise<string | undefined> {
  const direct = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (direct) return direct

  const candidates = [
    `${home}/.claude/.credentials.json`,
    `${home}/.claude/credentials.json`,
  ]

  for (const file of candidates) {
    const raw = await readText(file, ops)
    if (!raw) continue

    try {
      const parsed = JSON.parse(raw) as unknown
      const token = extractToken(parsed)
      if (token) return token
    } catch {
      continue
    }
  }

  return undefined
}

export async function loadAnthropicQuota(options?: { targetUrl?: string; refresh?: boolean; ops?: AnthropicQuotaOps }): Promise<AnthropicQuotaSource> {
  const key = options?.targetUrl || "default"
  const cached = cache.get(key)
  const now = nowMs(options?.ops)
  if (cached?.cooldownUntil && now < cached.cooldownUntil) return cached.value
  const age = cached ? now - cached.at : Infinity
  if (cached && !options?.refresh && age < CACHE_MS) return cached.value

  const maybeCache = (value: AnthropicQuotaSource) => {
    if (value.entries.length > 0) {
      cache.set(key, { at: now, value })
    }
    return value
  }

  const ops = options?.ops
  const result: AnthropicQuotaSource = { entries: [] }
  let account: QuotaAccountView | undefined

  const status = await runCommand(["auth", "status", "--json"], ops)
  if (status?.stdout) {
    try {
      const parsed = JSON.parse(status.stdout) as unknown
      account = extractAccount(parsed)
      const entries = parseQuota(parsed)
      if (entries.length > 0) {
        result.entries = entries
        if (account) result.accounts = [{ ...account, entries }]
        result.warning = isRemoteTarget(options?.targetUrl)
          ? "Claude.ai quota is read from the UI server host, not the selected remote target"
          : undefined
        return maybeCache(result)
      }

      if (!account) {
        result.warning = isRemoteTarget(options?.targetUrl)
          ? "Claude.ai quota is read from the UI server host, not the selected remote target"
          : "No active Anthropic account found. Sign in to Claude to view subscription usage."
        return result
      }

      const token = extractToken(parsed)
      if (token) {
        try {
          const usage = await loadOAuthUsage(token, ops)
          if (account) usage.accounts = [{ ...account, entries: usage.entries }]
          usage.warning = isRemoteTarget(options?.targetUrl)
            ? "Claude.ai quota is read from the UI server host, not the selected remote target"
            : undefined
          return maybeCache(usage)
        } catch (error) {
          if (isAnthropicQuotaRateLimitError(error)) {
            const retryAfterMs = error.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS
            const cooldownUntil = new Date(now + retryAfterMs).toISOString()
            const warning = `Anthropic OAuth usage is rate limited; retrying after ${Math.ceil(retryAfterMs / 1000)}s.`
            let value = cached?.value
              ? withWarning(cached.value, warning)
              : { entries: [], warning }
            value.cooldownUntil = cooldownUntil
            if (account && value.entries.length > 0 && !value.accounts) {
              value.accounts = [{ ...account, entries: value.entries }]
            }
            if (isRemoteTarget(options?.targetUrl)) {
              value = withWarning(value, "Claude.ai quota is read from the UI server host, not the selected remote target")
            }
            cache.set(key, { at: now, value, cooldownUntil: now + retryAfterMs })
            return value
          }
          throw error
        }
      }
    } catch {
      // fall through to plain text / credentials fallback
    }
  }

  const home = process.env.HOME || "/home"
  const token = await loadCredentials(home, ops)
  if (!token) {
    const warning = isRemoteTarget(options?.targetUrl)
      ? "Claude.ai quota is read from the UI server host, not the selected remote target"
      : "Claude CLI not found or not signed in. Install Claude CLI and sign in to view Claude.ai subscription usage."
    result.warning = warning
    return result
  }

  const usage = await loadOAuthUsage(token, ops)
  if (account) usage.accounts = [{ ...account, entries: usage.entries }]
  usage.warning = isRemoteTarget(options?.targetUrl)
    ? "Claude.ai quota is read from the UI server host, not the selected remote target"
    : undefined
  return maybeCache(usage)
}

export function __clearAnthropicQuotaCacheForTests() {
  cache.clear()
}

export { parseQuota as __parseAnthropicQuotaForTests, extractToken as __extractAnthropicTokenForTests, isRemoteTarget as __isRemoteAnthropicTargetForTests }
