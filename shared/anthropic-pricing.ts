import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { normalizeAnthropicModelKey } from "./anthropic-models"

export { normalizeAnthropicModelKey } from "./anthropic-models"

export interface AnthropicModelPricing {
  input: number
  output: number
  cachedInput?: number
  cacheWrite?: number
}

export interface AnthropicPricing {
  sourceUrl: string
  fetchedAt: string
  models: Record<string, AnthropicModelPricing>
}

const DEFAULT_SOURCE_URL = "https://docs.anthropic.com/en/docs/about-claude/pricing"
const DEFAULT_TIMEOUT_MS = 12_000

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceCell(value: string): number | null | undefined {
  const normalized = stripHtml(value)
  if (!normalized) return undefined
  if (normalized === "-") return null
  const parsed = normalized.match(/\$?([0-9]+(?:\.[0-9]+)?)/)
  return parsed ? Number(parsed[1]) : undefined
}

function parseAnthropicPricingTables(html: string, models: Record<string, AnthropicModelPricing>): void {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  for (const row of html.matchAll(rowRegex)) {
    const cells = Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripHtml(match[1] || ""))
    if (cells.length < 6) continue

    const title = cells[0] || ""
    const key = normalizeAnthropicModelKey(title)
    if (!key || models[key] || !title.toLowerCase().startsWith("claude ")) continue

    const input = parsePriceCell(cells[1])
    const cacheWrite = parsePriceCell(cells[2])
    const cacheRead = parsePriceCell(cells[4])
    const output = parsePriceCell(cells[5])

    if (input === null || output === null || input === undefined || output === undefined) continue

    models[key] = {
      input,
      output,
      ...(cacheRead != null ? { cachedInput: cacheRead } : {}),
      ...(cacheWrite != null ? { cacheWrite } : {}),
    }
  }
}

function getCacheFilePath(): string {
  const home = process.env.HOME || "/tmp"
  const cacheRoot = process.env.XDG_CACHE_HOME || `${home}/.cache`
  return `${cacheRoot}/opencode/anthropic-pricing.json`
}

export function parseAnthropicPricingHtml(html: string): AnthropicPricing {
  const models: Record<string, AnthropicModelPricing> = {}
  parseAnthropicPricingTables(html, models)

  return {
    sourceUrl: DEFAULT_SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    models,
  }
}

async function readCache(cacheFile: string): Promise<AnthropicPricing | undefined> {
  try {
    const raw = await readFile(cacheFile, "utf8")
    const parsed = JSON.parse(raw) as Partial<AnthropicPricing>
    if (!parsed || typeof parsed !== "object") return undefined
    if (!parsed.models || typeof parsed.models !== "object") return undefined
    return {
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : DEFAULT_SOURCE_URL,
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString(),
      models: Object.fromEntries(
        Object.entries(parsed.models).filter(([, value]) =>
          value && typeof value === "object" && typeof value.input === "number" && typeof value.output === "number",
        ).map(([key, value]) => [key, {
          input: value.input,
          output: value.output,
          ...(typeof value.cachedInput === "number" ? { cachedInput: value.cachedInput } : {}),
          ...(typeof value.cacheWrite === "number" ? { cacheWrite: value.cacheWrite } : {}),
        }]),
      ),
    }
  } catch {
    return undefined
  }
}

async function writeCache(cacheFile: string, data: AnthropicPricing): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true })
  const tmp = `${cacheFile}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data), "utf8")
  await rename(tmp, cacheFile)
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function loadAnthropicPricing(options?: {
  cacheFile?: string
  sourceUrl?: string
  timeoutMs?: number
  fetcher?: Fetcher
}): Promise<AnthropicPricing> {
  const sourceUrl = options?.sourceUrl || DEFAULT_SOURCE_URL
  const cacheFile = options?.cacheFile || getCacheFilePath()
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS
  const fetcher: Fetcher = options?.fetcher || fetch

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(sourceUrl, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const html = await response.text()
      const data = parseAnthropicPricingHtml(html)
      if (Object.keys(data.models).length > 0) {
        await writeCache(cacheFile, data)
        return data
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    console.warn(`[anthropic-pricing] refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const cached = await readCache(cacheFile)
  if (cached) return cached

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    models: {},
  }
}
