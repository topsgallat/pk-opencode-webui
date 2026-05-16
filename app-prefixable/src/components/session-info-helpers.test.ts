import { describe, expect, it } from "bun:test"
import { findQuotaProviderBySelectedModel } from "./session-info-helpers"

describe("session-info quota matching", () => {
  const providers = [
    { id: "copilot" },
    { id: "openai" },
    { id: "gemini" },
  ]

  it("matches github copilot to copilot quota", () => {
    expect(findQuotaProviderBySelectedModel(providers, "github-copilot")?.id).toBe("copilot")
  })

  it("matches openai directly", () => {
    expect(findQuotaProviderBySelectedModel(providers, "openai")?.id).toBe("openai")
  })

  it("falls back to the first provider when none is selected", () => {
    expect(findQuotaProviderBySelectedModel(providers, undefined)?.id).toBe("copilot")
  })
})
