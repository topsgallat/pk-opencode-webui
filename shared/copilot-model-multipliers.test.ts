import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import {
  loadCopilotModelMultipliers,
  normalizeCopilotModelKey,
  parseCopilotMultipliersHtml,
} from "./copilot-model-multipliers"

async function makeCacheFile() {
  const dir = `/tmp/copilot-multipliers-${crypto.randomUUID()}`
  const cacheFile = `${dir}/copilot-model-multipliers.json`
  await mkdir(dir, { recursive: true })
  return { dir, cacheFile }
}

describe("copilot model multipliers", () => {
  test("normalizes model names", () => {
    expect(normalizeCopilotModelKey("GPT-5.4 mini")).toBe("gpt-5.4-mini")
    expect(normalizeCopilotModelKey("Claude Sonnet 4.6 (fast mode) (preview)")).toBe("claude-sonnet-4.6-fast-mode-preview")
  })

  test("parses the model multiplier table from docs html", () => {
    const html = `<h2 id="model-multipliers"></h2><table><tbody><tr><th scope="row">Claude Sonnet 4.6</th><td>1</td><td>Not applicable</td></tr><tr><th scope="row">GPT-5.4 mini</th><td>0.33</td><td>Not applicable</td></tr><tr><th scope="row">GPT-5.5</th><td>7.5</td><td>Not applicable</td></tr></tbody></table>`
    const data = parseCopilotMultipliersHtml(html)
    expect(data.models["claude-sonnet-4.6"]).toBe(1)
    expect(data.models["gpt-5.4-mini"]).toBe(0.33)
    expect(data.models["gpt-5.5"]).toBe(7.5)
  })

  test("refreshes cache and falls back to the cached file", async () => {
    const { dir, cacheFile } = await makeCacheFile()
    const html = `<h2 id="model-multipliers"></h2><table><tbody><tr><th scope="row">Claude Haiku 4.5</th><td>0.33</td><td>1</td></tr></tbody></table>`

    const fresh = await loadCopilotModelMultipliers({
      cacheFile,
      sourceUrl: "https://example.test/copilot",
      fetcher: async () => new Response(html, { status: 200 }),
    })

    expect(fresh.models["claude-haiku-4.5"]).toBe(0.33)
    expect(JSON.parse(await readFile(cacheFile, "utf8")).models["claude-haiku-4.5"]).toBe(0.33)

    const cached = await loadCopilotModelMultipliers({
      cacheFile,
      sourceUrl: "https://example.test/copilot",
      fetcher: async () => { throw new Error("offline") },
    })

    expect(cached.models["claude-haiku-4.5"]).toBe(0.33)
    await rm(dir, { force: true, recursive: true })
  })
})
