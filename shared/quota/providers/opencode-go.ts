import { QuotaFetchOptions, QuotaProvider, QuotaProviderView, QuotaEntryView } from "../types"
import { getSettingsStore } from "../../settings-store"

const OPENCODE_GO_URL = (workspaceId: string) => `https://opencode.ai/workspace/${workspaceId}/go`
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 30_000

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0"

export type OpenCodeGoConfig = {
  workspaceId?: string
  authCookie?: string
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

function loadOpenCodeGoConfig(): OpenCodeGoConfig {
  try {
    const settings = getSettingsStore().load("opencode-go")
    return {
      workspaceId: typeof settings.workspaceId === "string" ? settings.workspaceId.trim() || undefined : undefined,
      authCookie: typeof settings.authCookie === "string" ? settings.authCookie.trim() || undefined : undefined,
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

function parseDurationToSeconds(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return undefined
  if (trimmed === "reset now" || trimmed === "now") return 0

  let total = 0
  let found = false

  const dayMatch = trimmed.match(/(\d+)\s*(?:day|days)/)
  if (dayMatch) {
    total += parseInt(dayMatch[1], 10) * 86_400
    found = true
  }

  const hourMatch = trimmed.match(/(\d+)\s*(?:hour|hours)/)
  if (hourMatch) {
    total += parseInt(hourMatch[1], 10) * 3_600
    found = true
  }

  const minuteMatch = trimmed.match(/(\d+)\s*(?:minute|minutes)/)
  if (minuteMatch) {
    total += parseInt(minuteMatch[1], 10) * 60
    found = true
  }

  const secondMatch = trimmed.match(/(\d+)\s*(?:second|seconds)/)
  if (secondMatch) {
    total += parseInt(secondMatch[1], 10)
    found = true
  }

  return found ? total : undefined
}

function buildWindow(usagePercent: number, resetInSec: number): OpenCodeGoWindow {
  return {
    usagePercent,
    resetInSec,
    percentRemaining: Math.max(0, 100 - usagePercent),
    resetTimeIso: new Date(Date.now() + resetInSec * 1_000).toISOString(),
  }
}

function parseWindowFromHydration(html: string, key: string): OpenCodeGoWindow | undefined {
  const blockRe = new RegExp(`${key}:\\$R\\[\\d+\\]=(\\{[\\s\\S]*?\\})`)
  const blockMatch = html.match(blockRe)
  if (!blockMatch) return undefined

  const block = blockMatch[1]
  const pctMatch = block.match(/usagePercent:\s*(-?\d+(?:\.\d+)?)/)
  const resetMatch = block.match(/resetInSec:\s*(-?\d+(?:\.\d+)?)/)
  if (!pctMatch || !resetMatch) return undefined

  const usagePercent = parseFloat(pctMatch[1])
  const resetInSec = parseInt(resetMatch[1], 10)
  if (Number.isNaN(usagePercent) || Number.isNaN(resetInSec)) return undefined

  return buildWindow(usagePercent, resetInSec)
}

function parseWindowsFromHtml(html: string): ParsedWindows {
  const windows: ParsedWindows = {}
  const seen = new Set<string>()

  const itemRe = /data-slot="usage-item"[\s\S]*?(?=data-slot="usage-item"|$)/g
  let itemMatch

  while ((itemMatch = itemRe.exec(html)) !== null) {
    const block = itemMatch[0]

    const labelMatch = block.match(/data-slot="usage-label"[^>]*>([^<]*)</)
    const valueMatch = block.match(/data-slot="usage-value"[^>]*>([^<]*)</)
    const resetMatch = block.match(/data-slot="reset-time"[^>]*>([^<]*)</)

    if (!labelMatch || !valueMatch) continue

    const label = labelMatch[1].trim().toLowerCase()
    const valueText = valueMatch[1].trim()
    const resetText = resetMatch ? resetMatch[1].trim() : ""

    const pctMatch = valueText.match(/(\d+(?:\.\d+)?)/)
    if (!pctMatch) continue

    const usagePercent = parseFloat(pctMatch[1])
    if (Number.isNaN(usagePercent)) continue

    const resetInSec = resetText ? (parseDurationToSeconds(resetText) ?? 0) : 0

    const target = label.includes("rolling") || label.includes("5h")
      ? "rolling"
      : label.includes("week")
        ? "weekly"
        : label.includes("month")
          ? "monthly"
          : undefined

    if (!target || seen.has(target)) continue
    seen.add(target)
    windows[target] = buildWindow(usagePercent, resetInSec)
  }

  return windows
}

export function parseOpenCodeGoUsage(html: string): OpenCodeGoResult {
  if (!html || html.trim().length === 0) return null

  const hydration: ParsedWindows = {
    rolling: parseWindowFromHydration(html, "rollingUsage"),
    weekly: parseWindowFromHydration(html, "weeklyUsage"),
    monthly: parseWindowFromHydration(html, "monthlyUsage"),
  }

  const fromHydration = hydration.rolling || hydration.weekly || hydration.monthly
  if (fromHydration) {
    return {
      success: true,
      rolling: hydration.rolling,
      weekly: hydration.weekly,
      monthly: hydration.monthly,
    }
  }

  const fromHtml = parseWindowsFromHtml(html)
  const fromHtmlAny = fromHtml.rolling || fromHtml.weekly || fromHtml.monthly
  if (fromHtmlAny) {
    return {
      success: true,
      rolling: fromHtml.rolling,
      weekly: fromHtml.weekly,
      monthly: fromHtml.monthly,
    }
  }

  return { success: false, error: "Could not find usage data in OpenCode Go dashboard HTML" }
}

async function loadOpenCodeGoUsage(config: OpenCodeGoConfig, refresh?: boolean): Promise<OpenCodeGoResult> {
  const cached = getCached(refresh)
  if (cached !== undefined) return cached

  if (!config.workspaceId || !config.authCookie) {
    return { success: false, error: "OpenCode Go credentials not configured" }
  }

  try {
    const res = await fetch(OPENCODE_GO_URL(config.workspaceId), {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Cookie": `auth=${config.authCookie}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403
        ? "authentication failed — check your auth cookie"
        : `HTTP ${res.status} ${res.statusText}`
      return { success: false, error: detail }
    }

    const html = await res.text()
    const result = parseOpenCodeGoUsage(html)
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

  async isAvailable(): Promise<boolean> {
    const config = loadOpenCodeGoConfig()
    return Boolean(config.workspaceId && config.authCookie)
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    const config = loadOpenCodeGoConfig()

    if (!config.workspaceId || !config.authCookie) {
      return {
        id: this.id,
        name: this.name,
        status: "unavailable",
        available: false,
        fetchedAt: new Date().toISOString(),
        entries: [],
        warning: "OpenCode Go credentials not configured. Enter your workspace ID and auth cookie below.",
      }
    }

    try {
      const result = await loadOpenCodeGoUsage(config, options?.refresh)

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
      if (result.rolling) entries.push(windowToEntry("Rolling 5h", "5h window ($12)", "hourly", result.rolling))
      if (result.weekly) entries.push(windowToEntry("Weekly", "Weekly window ($30)", "weekly", result.weekly))
      if (result.monthly) entries.push(windowToEntry("Monthly", "Monthly window ($60)", "monthly", result.monthly))

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