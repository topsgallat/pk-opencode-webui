import { QuotaFetchOptions, QuotaProvider, QuotaProviderView, QuotaEntryView } from "../types"
import { readOpenCodeAuthKey } from "../opencode-auth-file"
import { getSettingsStore } from "../../settings-store"

const ZEN_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 30_000

// the OpenCode CLI stores the Zen/Go API key in its auth store under these provider ids
const ZEN_AUTH_IDS = ["opencode", "opencode-zen"] as const

export type OpenCodeGoConfig = {
  apiKey?: string
  legacyCredentials?: boolean
}

export type OpenCodeGoWindow = {
  usagePercent: number
  resetInSec: number
  percentRemaining: number
  resetTimeIso: string
}

export type OpenCodeGoResult =
  | { success: true; rolling?: OpenCodeGoWindow; weekly?: OpenCodeGoWindow; monthly?: OpenCodeGoWindow }
  | { success: false; error: string }
  | null

type ParsedWindows = {
  rolling?: OpenCodeGoWindow
  weekly?: OpenCodeGoWindow
  monthly?: OpenCodeGoWindow
}

const WINDOW_KEYS = ["rolling", "weekly", "monthly"] as const

export function loadOpenCodeGoConfig(): OpenCodeGoConfig {
  try {
    const settings = getSettingsStore().load("opencode-go")
    return {
      apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() || undefined : undefined,
      legacyCredentials: Boolean(settings.workspaceId || settings.authCookie),
    }
  } catch {
    return {}
  }
}

let cache: { at: number; result: OpenCodeGoResult } | undefined

function getCached(refresh?: boolean): OpenCodeGoResult | undefined {
  if (!cache || refresh) return undefined
  if (Date.now() - cache.at > CACHE_TTL_MS) return undefined
  return cache.result
}

function setCache(result: OpenCodeGoResult) {
  if (result && result.success) {
    cache = { at: Date.now(), result }
  }
}

function buildWindow(percent: number, resetsAt: string): OpenCodeGoWindow {
  const resetMs = Date.parse(resetsAt)
  const resetInSec = Number.isNaN(resetMs) ? 0 : Math.max(0, Math.round((resetMs - Date.now()) / 1_000))
  return {
    usagePercent: percent,
    resetInSec,
    percentRemaining: Math.max(0, 100 - percent),
    resetTimeIso: Number.isNaN(resetMs) ? new Date().toISOString() : new Date(resetMs).toISOString(),
  }
}

function parseWindowPayload(value: unknown): OpenCodeGoWindow | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.percent !== "number" || Number.isNaN(record.percent)) return undefined
  return buildWindow(record.percent, typeof record.resetsAt === "string" ? record.resetsAt : "")
}

export function parseOpenCodeGoUsage(body: unknown): OpenCodeGoResult {
  if (!body || typeof body !== "object") {
    return { success: false, error: "OpenCode usage response was not a JSON object" }
  }

  const usage = (body as Record<string, unknown>).usage
  if (!usage || typeof usage !== "object") {
    return { success: false, error: "OpenCode usage response did not include a usage object" }
  }

  const record = usage as Record<string, unknown>
  const windows: ParsedWindows = {}
  for (const key of WINDOW_KEYS) {
    windows[key] = parseWindowPayload(record[key])
  }

  const any = windows.rolling || windows.weekly || windows.monthly
  if (!any) {
    return { success: false, error: "OpenCode usage response did not include any usage windows" }
  }

  return { success: true, rolling: windows.rolling, weekly: windows.weekly, monthly: windows.monthly }
}

export async function resolveOpenCodeGoApiKey(
  config: OpenCodeGoConfig,
  options?: QuotaFetchOptions,
): Promise<string | undefined> {
  if (config.apiKey) return config.apiKey

  const session = options?.resolveProviderAuthHeader?.(ZEN_AUTH_IDS[0])
  const fromSession = session?.replace(/^bearer\s+/i, "").trim()
  if (fromSession) return fromSession

  for (const id of ZEN_AUTH_IDS) {
    const key = await readOpenCodeAuthKey(id)
    if (key) return key
  }
  return undefined
}

async function loadOpenCodeGoUsage(apiKey: string, refresh?: boolean): Promise<OpenCodeGoResult> {
  const cached = getCached(refresh)
  if (cached !== undefined) return cached

  try {
    const res = await fetch(ZEN_USAGE_URL, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403
        ? "authentication failed — check your API key"
        : `HTTP ${res.status} ${res.statusText}`
      return { success: false, error: detail }
    }

    const body = await res.json()
    const result = parseOpenCodeGoUsage(body)
    setCache(result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message.includes("timed out") ? "request timed out" : message }
  }
}

function windowToEntry(
  label: string,
  subtitle: string,
  windowType: QuotaEntryView["window"],
  win: OpenCodeGoWindow,
): QuotaEntryView {
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    group: "usage",
    label,
    subtitle,
    percentUsed: win.usagePercent,
    percentRemaining: win.percentRemaining,
    window: windowType,
    resetTimeIso: win.resetTimeIso,
    unlimited: false,
  }
}

export class OpenCodeGoProvider implements QuotaProvider {
  id = "opencode-go"
  name = "OpenCode Go"

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    const config = loadOpenCodeGoConfig()
    return Boolean(await resolveOpenCodeGoApiKey(config, options))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    const config = loadOpenCodeGoConfig()
    const apiKey = await resolveOpenCodeGoApiKey(config, options)

    if (!apiKey) {
      return {
        id: this.id,
        name: this.name,
        status: "unavailable",
        available: false,
        fetchedAt: new Date().toISOString(),
        entries: [],
        warning: config.legacyCredentials
          ? "opencode.ai no longer serves Go plan usage through the web session. Connect the OpenCode Zen provider in the CLI (/connect) or enter an API key below."
          : "OpenCode Go API key not configured — connect the OpenCode Zen provider in the CLI (/connect) or enter an API key below.",
      }
    }

    try {
      const result = await loadOpenCodeGoUsage(apiKey, options?.refresh)

      if (!result || !result.success) {
        return {
          id: this.id,
          name: this.name,
          status: "error",
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: result && !result.success ? result.error : "OpenCode Go quota data was not available",
        }
      }

      const entries: QuotaEntryView[] = []
      if (result.rolling) entries.push(windowToEntry("Rolling 5h", "5h rolling window", "hourly", result.rolling))
      if (result.weekly) entries.push(windowToEntry("Weekly", "Weekly window", "weekly", result.weekly))
      if (result.monthly) entries.push(windowToEntry("Monthly", "Monthly window", "monthly", result.monthly))

      if (entries.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: "error",
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: "OpenCode Go response did not include any usage windows",
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
