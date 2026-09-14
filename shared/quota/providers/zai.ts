import { homedir } from "node:os"
import { join } from "node:path"
import { QuotaEntryView, QuotaFetchOptions, QuotaProvider, QuotaProviderView } from "../types"

const AUTH_IDS = ["zai-coding-plan", "zhipu-coding-plan"] as const

const USAGE_BASE: Record<(typeof AUTH_IDS)[number], string> = {
  "zai-coding-plan": "https://api.z.ai",
  "zhipu-coding-plan": "https://open.bigmodel.cn",
}

type ZaiLimit = {
  type?: unknown
  unit?: unknown
  number?: unknown
  usage?: unknown
  currentValue?: unknown
  remaining?: unknown
  percentage?: unknown
  nextResetTime?: unknown
}

type ZaiQuotaResponse = {
  code?: unknown
  msg?: unknown
  success?: unknown
  data?: {
    limits?: ZaiLimit[]
    level?: unknown
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asResetIso(value: unknown): string | undefined {
  const ms = asNumber(value)
  if (ms === undefined) return undefined
  return new Date(ms > 1e12 ? ms : ms * 1000).toISOString()
}

function authFilePaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || homedir()
  const dataHome = process.env.XDG_DATA_HOME
  return [
    ...(dataHome ? [join(dataHome, "opencode", "auth.json")] : []),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
}

async function readAuthFileHeader(id: string): Promise<string | undefined> {
  for (const path of authFilePaths()) {
    try {
      const file = Bun.file(path)
      if (!(await file.exists())) continue
      const data = (await file.json()) as Record<string, Record<string, unknown>>
      const key = asString(data?.[id]?.key)
      if (key) return `Bearer ${key}`
    } catch {
      // unreadable or malformed auth file — try the next path
    }
  }
  return undefined
}

async function resolveAuth(options?: QuotaFetchOptions): Promise<{ id: string; header: string } | undefined> {
  for (const id of AUTH_IDS) {
    const header = options?.resolveProviderAuthHeader?.(id)
    if (header) return { id, header }
  }

  for (const id of AUTH_IDS) {
    const header = await readAuthFileHeader(id)
    if (header) return { id, header }
  }

  return undefined
}

function windowFor(limit: ZaiLimit): { label: string; window: QuotaEntryView["window"] } | undefined {
  const unit = asNumber(limit.unit)
  const number = asNumber(limit.number)
  const type = asString(limit.type)?.toUpperCase()

  if (type === "TOKENS_LIMIT") return { label: "5-hour tokens", window: "hourly" }
  if (type === "TIME_LIMIT") return { label: "Monthly MCP calls", window: "monthly" }
  if (unit === 3 && number === 5) return { label: "5-hour window", window: "hourly" }
  if (unit === 6 && number === 1) return { label: "Weekly window", window: "weekly" }
  if (unit !== undefined && number !== undefined) {
    return { label: `Usage window (unit ${unit} x ${number})`, window: "unknown" }
  }
  return undefined
}

export function parseZaiLimitEntry(limit: ZaiLimit, level: string | undefined): QuotaEntryView | undefined {
  const win = windowFor(limit)
  if (!win) return undefined

  const used = asNumber(limit.currentValue)
  const total = asNumber(limit.usage)
  const remaining = asNumber(limit.remaining)
  const percentUsed = asNumber(limit.percentage) ?? (used !== undefined && total ? (used / total) * 100 : undefined)
  if (percentUsed === undefined) return undefined

  return {
    id: win.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    group: "usage",
    label: win.label,
    subtitle: level ? `${level} plan` : undefined,
    used,
    total,
    remaining,
    percentUsed,
    percentRemaining: Math.max(0, 100 - percentUsed),
    window: win.window,
    resetTimeIso: asResetIso(limit.nextResetTime),
    unlimited: false,
  }
}

export class ZaiProvider implements QuotaProvider {
  id = "zai-coding-plan"
  name = "z.ai Coding Plan"

  constructor(private readonly fetchImpl?: typeof fetch) {}

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(await resolveAuth(options))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const auth = await resolveAuth(options)
      if (!auth) {
        return {
          id: this.id,
          name: this.name,
          status: "unavailable",
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          warning: "No z.ai auth available for quota lookup",
        }
      }

      const base = USAGE_BASE[auth.id as (typeof AUTH_IDS)[number]] ?? USAGE_BASE["zai-coding-plan"]
      const doFetch = this.fetchImpl ?? fetch
      const response = await doFetch(`${base}/api/monitor/usage/quota/limit`, {
        headers: { Authorization: auth.header, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`HTTP ${response.status} ${response.statusText}${body.trim() ? `: ${body.slice(0, 300)}` : ""}`.trim())
      }

      const payload = (await response.json()) as ZaiQuotaResponse
      if (payload.success === false || (asNumber(payload.code) !== undefined && asNumber(payload.code) !== 200)) {
        throw new Error(asString(payload.msg) || `z.ai API error ${payload.code}`)
      }

      const level = asString(payload.data?.level)
      const entries = (payload.data?.limits ?? [])
        .map((limit) => parseZaiLimitEntry(limit, level))
        .filter((entry): entry is QuotaEntryView => entry !== undefined)

      if (entries.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: "error",
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: "z.ai response did not include quota limits",
        }
      }

      return {
        id: this.id,
        name: this.name,
        status: "ok",
        available: true,
        fetchedAt: new Date().toISOString(),
        entries,
        matchedCurrentModel: true,
      }
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        status: "error",
        available: false,
        fetchedAt: new Date().toISOString(),
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
