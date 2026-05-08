import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export interface OpenAIModelPricing {
  input: number
  output: number
  cachedInput?: number
}

export interface OpenAIPricing {
  sourceUrl: string
  fetchedAt: string
  models: Record<string, OpenAIModelPricing>
}

const DEFAULT_SOURCE_URL = "https://developers.openai.com/api/docs/pricing"
const DEFAULT_TIMEOUT_MS = 12_000

export function normalizeOpenAIModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\[\^.*?\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

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

function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function parsePriceCell(value: string): number | null | undefined {
  const normalized = stripHtml(value)
  if (!normalized) return undefined
  if (normalized === "-") return null
  const parsed = normalized.match(/\$?([0-9]+(?:\.[0-9]+)?)/)
  return parsed ? Number(parsed[1]) : undefined
}

function parseOpenAIPricingTables(html: string, models: Record<string, OpenAIModelPricing>): void {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  for (const row of html.matchAll(rowRegex)) {
    const cells = Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripHtml(match[1] || ""))
    if (cells.length < 3) continue

    const key = normalizeOpenAIModelKey(cells[0] || "")
    if (!key || models[key]) continue

    const prices = cells.slice(1).map((cell) => parsePriceCell(cell)).filter((value): value is number | null => value !== undefined)
    if (prices.length < 2) continue

    const input = prices[0]
    const output = prices.length >= 3 ? prices[2] : prices[1]
    const cachedInput = prices.length >= 3 && prices[1] !== null ? prices[1] : undefined

    if (input === null || output === null) continue

    models[key] = {
      input,
      output,
      ...(cachedInput !== undefined ? { cachedInput } : {}),
    }
  }
}

function getCacheFilePath(): string {
  const home = process.env.HOME || "/tmp"
  const cacheRoot = process.env.XDG_CACHE_HOME || `${home}/.cache`
  return `${cacheRoot}/opencode/openai-pricing.json`
}

export function parseOpenAIPricingHtml(html: string): OpenAIPricing {
  const models: Record<string, OpenAIModelPricing> = {}
  const cardRegex = /<h2[^>]*class="text-h4"[^>]*>([^<]+)<\/h2>[\s\S]*?<h3[^>]*>Price<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi

  for (const match of html.matchAll(cardRegex)) {
    const title = decodeHtmlEntities(match[1] || "").trim()
    const priceText = decodeHtmlEntities((match[2] || "").replace(/<br\s*\/?>/gi, "\n"))
    if (!priceText.includes("1M tokens")) continue

    const key = normalizeOpenAIModelKey(title)
    if (!key || models[key]) continue

    const input = parsePrice(priceText.match(/Input:\$([0-9.]+)/)?.[1])
    const output = parsePrice(priceText.match(/Output:\$([0-9.]+)/)?.[1])
    const cachedInput = parsePrice(priceText.match(/Cached input:\$([0-9.]+)/)?.[1])

    if (input === undefined || output === undefined) continue

    models[key] = {
      input,
      output,
      ...(cachedInput !== undefined ? { cachedInput } : {}),
    }
  }

  if (Object.keys(models).length === 0) {
    parseOpenAIPricingTables(html, models)
  }

  return {
    sourceUrl: DEFAULT_SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    models,
  }
}

async function readCache(cacheFile: string): Promise<OpenAIPricing | undefined> {
  try {
    const raw = await readFile(cacheFile, "utf8")
    const parsed = JSON.parse(raw) as Partial<OpenAIPricing>
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
        }]),
      ),
    }
  } catch {
    return undefined
  }
}

async function writeCache(cacheFile: string, data: OpenAIPricing): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true })
  const tmp = `${cacheFile}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data), "utf8")
  await rename(tmp, cacheFile)
}

export async function loadOpenAIPricing(options?: {
  cacheFile?: string
  sourceUrl?: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<OpenAIPricing> {
  const sourceUrl = options?.sourceUrl || DEFAULT_SOURCE_URL
  const cacheFile = options?.cacheFile || getCacheFilePath()
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS
  const fetcher = options?.fetcher || fetch

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(sourceUrl, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const html = await response.text()
      const data = parseOpenAIPricingHtml(html)
      if (Object.keys(data.models).length > 0) {
        await writeCache(cacheFile, data)
        return data
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    console.warn(`[openai-pricing] refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const cached = await readCache(cacheFile)
  if (cached) return cached

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    models: {},
  }
}
