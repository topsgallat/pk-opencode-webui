import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import { loadOpenAIPricing, parseOpenAIPricingHtml } from "./openai-pricing"

async function makeCacheFile() {
  const dir = `/tmp/openai-pricing-${crypto.randomUUID()}`
  const cacheFile = `${dir}/openai-pricing.json`
  await mkdir(dir, { recursive: true })
  return { dir, cacheFile }
}

describe("openai pricing", () => {
  test("parses pricing rows from docs html", () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
        <tr><td>GPT-5.5</td><td>$5.00</td><td>$0.50</td><td>$30.00</td></tr>
        <tr><td>GPT-4.1 mini</td><td>$0.40</td><td>-</td><td>$1.60</td></tr>
      </table>
    `

    const data = parseOpenAIPricingHtml(html)
    expect(data.models["gpt-5.5"]).toEqual({ input: 5, output: 30, cachedInput: 0.5 })
    expect(data.models["gpt-4.1-mini"]).toEqual({ input: 0.4, output: 1.6 })
  })

  test("refreshes cache and falls back to the cached file", async () => {
    const { dir, cacheFile } = await makeCacheFile()
    const html = `
      <table>
        <tr><td>GPT-5.1</td><td>$0.90</td><td>$0.09</td><td>$3.60</td></tr>
      </table>
    `

    const fresh = await loadOpenAIPricing({
      cacheFile,
      sourceUrl: "https://example.test/openai",
      fetcher: async () => new Response(html, { status: 200 }),
    })

    expect(fresh.models["gpt-5.1"]).toEqual({ input: 0.9, output: 3.6, cachedInput: 0.09 })
    expect(JSON.parse(await readFile(cacheFile, "utf8")).models["gpt-5.1"]).toEqual({ input: 0.9, output: 3.6, cachedInput: 0.09 })

    const cached = await loadOpenAIPricing({
      cacheFile,
      sourceUrl: "https://example.test/openai",
      fetcher: async () => { throw new Error("offline") },
    })

    expect(cached.models["gpt-5.1"]).toEqual({ input: 0.9, output: 3.6, cachedInput: 0.09 })
    await rm(dir, { force: true, recursive: true })
  })
})
