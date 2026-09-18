import { codeToHtml, bundledLanguages } from "shiki"
import { createEffect, createSignal } from "solid-js"
import { transformerNotationDiff } from "@shikijs/transformers"
import { createWeightedLru } from "../../utils/lru"
import "./content-code.css"

// Per-line fragments of a highlighted document, so consumers that display
// individual lines (e.g. diff rows) can highlight the whole text once instead
// of paying a shiki call per line.
export interface HighlightedLines {
  preClass: string
  preStyle: string
  lines: string[]
}

interface HighlightEntry {
  html: string
  // Parsed line fragments; null means a parse was attempted and the shiki
  // output had no usable line structure (e.g. plain text), so retries are
  // pointless.
  lines: HighlightedLines | null | undefined
}

// Shiki HTML is ~5-10x the source text, so the budget is calibrated in bytes:
// a handful of large read-tool outputs or many diffs must not accumulate
// unboundedly over a long session.
const HIGHLIGHT_MAX_ENTRIES = 200
const HIGHLIGHT_MAX_WEIGHT = 12 * 1024 * 1024

function entryWeight(entry: HighlightEntry) {
  let weight = entry.html.length
  if (entry.lines) for (const line of entry.lines.lines) weight += line.length
  return weight
}

export const highlightCache = createWeightedLru<HighlightEntry>({
  maxEntries: HIGHLIGHT_MAX_ENTRIES,
  maxWeight: HIGHLIGHT_MAX_WEIGHT,
  weigh: entryWeight,
})

const cacheKey = (code: string, lang?: string) => `${lang ?? "text"}:${code}`

export async function highlight(code: string, lang?: string): Promise<string> {
  const key = cacheKey(code, lang)
  const cached = highlightCache.get(key)
  if (cached) return cached.html

  const html = await codeToHtml(code || "", {
    lang: lang && lang in bundledLanguages ? lang : "text",
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    transformers: [transformerNotationDiff()],
  })

  highlightCache.set(key, { html, lines: undefined })
  return html
}

// Synchronous cache probe so a re-mounted component can paint highlighted
// HTML immediately instead of flashing the plain-text fallback for a frame.
export function peekHighlight(code: string, lang?: string): string | undefined {
  return highlightCache.get(cacheKey(code, lang))?.html
}

function parseHighlightedLines(html: string, code: string): HighlightedLines | null {
  if (typeof document === "undefined") return null
  const template = document.createElement("template")
  template.innerHTML = html
  const pre = template.content.querySelector("pre")
  if (!pre) return null
  const lineNodes = pre.querySelectorAll("code > span.line")
  if (lineNodes.length !== code.split("\n").length) return null
  const lines: string[] = []
  for (const node of lineNodes) lines.push((node as HTMLElement).outerHTML)
  return {
    preClass: pre.getAttribute("class") ?? "",
    preStyle: pre.getAttribute("style") ?? "",
    lines,
  }
}

export function highlightToLines(code: string, lang?: string): Promise<HighlightedLines | undefined> {
  const key = cacheKey(code, lang)
  const cached = highlightCache.get(key)
  if (cached?.lines !== undefined) return Promise.resolve(cached.lines ?? undefined)

  return highlight(code, lang).then((html) => {
    // Re-fetch after the await: highlight() may have evicted our entry (or
    // skipped caching an oversized one) while the promise was in flight.
    const entry = highlightCache.peek(key)
    if (entry && entry.lines === undefined) {
      entry.lines = parseHighlightedLines(html, code)
      highlightCache.refresh(key)
    }
    if (entry?.lines) return entry.lines
    // Uncached (oversized) content: parse on demand without memoization
    return parseHighlightedLines(html, code) ?? undefined
  })
}

export function useHighlightedLines(
  code: () => string,
  lang: () => string | undefined,
  enabled: () => boolean = () => true,
) {
  const [result, setResult] = createSignal<HighlightedLines | undefined>(undefined)

  createEffect(() => {
    if (!enabled()) return
    const text = code()
    const language = lang()
    setResult(undefined)
    highlightToLines(text, language).then((parsed) => {
      if (enabled() && code() === text && lang() === language) setResult(parsed)
    })
  })

  return result
}
