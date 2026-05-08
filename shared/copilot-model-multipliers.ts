import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export interface CopilotModelMultipliers {
  sourceUrl: string
  fetchedAt: string
  models: Record<string, number>
}

const DEFAULT_SOURCE_URL = "https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-multipliers"
const DEFAULT_TIMEOUT_MS = 12_000

export function normalizeCopilotModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function formatCopilotMultiplier(value: number): string {
  return `x${Number(value.toFixed(2)).toString()}`
}

function getCacheFilePath(): string {
  const home = process.env.HOME || "/tmp"
  const cacheRoot = process.env.XDG_CACHE_HOME || `${home}/.cache`
  return `${cacheRoot}/opencode/copilot-model-multipliers.json`
}

function parseMultiplier(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "Not applicable") return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseCopilotMultipliersHtml(html: string): CopilotModelMultipliers {
  const models: Record<string, number> = {}
  const table = html.match(/<h2 id="model-multipliers"[\s\S]*?<table>([\s\S]*?)<\/table>/i)?.[1]
  if (!table) {
    return {
      sourceUrl: DEFAULT_SOURCE_URL,
      fetchedAt: new Date(0).toISOString(),
      models,
    }
  }

  const rows = table.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/gi)
  for (const row of rows) {
    const name = decodeHtmlEntities(row[1] || "").trim()
    const paid = parseMultiplier(decodeHtmlEntities(row[2] || ""))
    if (!name || paid === undefined) continue
    models[normalizeCopilotModelKey(name)] = paid
  }

  return {
    sourceUrl: DEFAULT_SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    models,
  }
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

async function readCache(cacheFile: string): Promise<CopilotModelMultipliers | undefined> {
  try {
    const raw = await readFile(cacheFile, "utf8")
    const parsed = JSON.parse(raw) as Partial<CopilotModelMultipliers>
    if (!parsed || typeof parsed !== "object") return undefined
    if (!parsed.models || typeof parsed.models !== "object") return undefined
    return {
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : DEFAULT_SOURCE_URL,
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString(),
      models: Object.fromEntries(
        Object.entries(parsed.models).filter(([, value]) => typeof value === "number"),
      ),
    }
  } catch {
    return undefined
  }
}

async function writeCache(cacheFile: string, data: CopilotModelMultipliers): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true })
  const tmp = `${cacheFile}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data), "utf8")
  await rename(tmp, cacheFile)
}

export async function loadCopilotModelMultipliers(options?: {
  cacheFile?: string
  sourceUrl?: string
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<CopilotModelMultipliers> {
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
      const data = parseCopilotMultipliersHtml(html)
      if (Object.keys(data.models).length > 0) {
        await writeCache(cacheFile, data)
        return data
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    console.warn(`[copilot-multipliers] refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const cached = await readCache(cacheFile)
  if (cached) return cached

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    models: {},
  }
}
