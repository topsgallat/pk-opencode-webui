import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import { loadAnthropicPricing, parseAnthropicPricingHtml } from "./anthropic-pricing"
import { normalizeAnthropicModelKey } from "./anthropic-models"

async function makeCacheFile() {
  const dir = `/tmp/anthropic-pricing-${crypto.randomUUID()}`
  const cacheFile = `${dir}/anthropic-pricing.json`
  await mkdir(dir, { recursive: true })
  return { dir, cacheFile }
}

describe("anthropic pricing", () => {
  test("normalizes model names", () => {
    expect(normalizeAnthropicModelKey("Claude Sonnet 4.5")).toBe("claude-sonnet-4-5")
    expect(normalizeAnthropicModelKey("Claude Haiku 3.5 (retired, except on Bedrock and Vertex AI)")).toBe("claude-haiku-3-5")
  })

  test("parses pricing rows from docs html", () => {
    const html = `
      <table>
        <tr>
          <th>Model</th><th>Base Input Tokens</th><th>5m Cache Writes</th><th>1h Cache Writes</th><th>Cache Hits &amp; Refreshes</th><th>Output Tokens</th>
        </tr>
        <tr>
          <td>Claude Sonnet 4.6</td><td>$3 / MTok</td><td>$3.75 / MTok</td><td>$6 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td>
        </tr>
        <tr>
          <td>Claude Haiku 4.5</td><td>$1 / MTok</td><td>$1.25 / MTok</td><td>$2 / MTok</td><td>$0.10 / MTok</td><td>$5 / MTok</td>
        </tr>
      </table>
    `

    const data = parseAnthropicPricingHtml(html)
    expect(data.models["claude-sonnet-4-6"]).toEqual({ input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 })
    expect(data.models["claude-haiku-4-5"]).toEqual({ input: 1, output: 5, cachedInput: 0.1, cacheWrite: 1.25 })
  })

  test("refreshes cache and falls back to the cached file", async () => {
    const { dir, cacheFile } = await makeCacheFile()
    const html = `
      <table>
        <tr><td>Claude Opus 4.7</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
      </table>
    `

    const fresh = await loadAnthropicPricing({
      cacheFile,
      sourceUrl: "https://example.test/anthropic",
      fetcher: async () => new Response(html, { status: 200 }),
    })

    expect(fresh.models["claude-opus-4-7"]).toEqual({ input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25 })
    expect(JSON.parse(await readFile(cacheFile, "utf8")).models["claude-opus-4-7"]).toEqual({ input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25 })

    const cached = await loadAnthropicPricing({
      cacheFile,
      sourceUrl: "https://example.test/anthropic",
      fetcher: async () => { throw new Error("offline") },
    })

    expect(cached.models["claude-opus-4-7"]).toEqual({ input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25 })
    await rm(dir, { force: true, recursive: true })
  })
})
