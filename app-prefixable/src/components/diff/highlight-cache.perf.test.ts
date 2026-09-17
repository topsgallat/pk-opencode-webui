import { describe, expect, test } from "bun:test"
import { highlight, highlightToLines, highlightCache } from "./highlight-cache"

// Generate a realistic TypeScript sample (~40KB) resembling a chat diff/read
// output, so miss/hit timings reflect real content rather than tiny snippets.
function makeSample(iterations: number) {
  const lines: string[] = []
  for (let i = 0; i < iterations; i++) {
    lines.push(`export function handler${i}(req: Request, res: Response): void {`)
    lines.push(`  const payload${i} = { id: ${i}, name: "item-${i}", tags: ["a", "b", "c"] }`)
    lines.push(`  if (!payload${i}.id) throw new Error("missing id: ${i}")`)
    lines.push(`  res.json({ ok: true, data: payload${i} })`)
    lines.push("}")
  }
  return lines.join("\n")
}

const SAMPLE = makeSample(1000)

describe("highlight cache performance", () => {
  test("cache hit is dramatically faster than a cold highlight", async () => {
    // Warm-up: grammar/theme loading happens once per process and would
    // otherwise inflate the first miss measurement.
    await highlight("const warm = 1", "typescript")

    const missStart = performance.now()
    await highlight(SAMPLE, "typescript")
    const missMs = performance.now() - missStart

    const hitStart = performance.now()
    await highlight(SAMPLE, "typescript")
    const hitMs = performance.now() - hitStart

    const speedup = missMs / Math.max(hitMs, 0.01)
    console.log(
      `[perf] highlight sample=${(SAMPLE.length / 1024).toFixed(0)}KB miss=${missMs.toFixed(1)}ms hit=${hitMs.toFixed(2)}ms speedup=${speedup.toFixed(0)}x`,
    )

    // Generous floor (2x) so the assert stays stable on loaded machines;
    // hits are normally microseconds vs tens of milliseconds.
    expect(hitMs).toBeLessThan(Math.max(missMs * 0.5, 1))
  }, 60_000)

  test("cache stays within configured bounds after flooding", async () => {
    for (let i = 0; i < 300; i++) {
      await highlight(makeSample(5) + `\n// unique-${i}`, "typescript")
    }

    console.log(
      `[perf] after flood: entries=${highlightCache.size()} weight=${(highlightCache.weight() / 1024 / 1024).toFixed(2)}MB`,
    )

    expect(highlightCache.size()).toBeLessThanOrEqual(200)
    expect(highlightCache.weight()).toBeLessThanOrEqual(12 * 1024 * 1024)
  }, 60_000)

  test("repeat highlights of evicted content still succeed", async () => {
    const snippet = makeSample(20)
    await highlight(snippet, "typescript")
    // Flood the cache so the snippet is evicted
    for (let i = 0; i < 250; i++) {
      await highlight(makeSample(5) + `\n// evict-${i}`, "typescript")
    }
    const start = performance.now()
    const html = await highlight(snippet, "typescript")
    console.log(`[perf] re-highlight after eviction: ${(performance.now() - start).toFixed(1)}ms`)
    expect(html.length).toBeGreaterThan(0)
  }, 60_000)

  test("highlightToLines resolves without a DOM (bun environment)", async () => {
    const result = await highlightToLines("const a = 1\nconst b = 2", "typescript")
    expect(result).toBeUndefined()
  })
})
