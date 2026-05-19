import { describe, expect, it } from "bun:test"
import { findQuotaProviderBySelectedModel } from "./session-info-helpers"
import type { QuotaProviderView } from "../../../shared/quota/types"

describe("session-info quota matching", () => {
  const providers = [
    { id: "copilot" } as QuotaProviderView,
    { id: "openai" } as QuotaProviderView,
    { id: "gemini" } as QuotaProviderView,
    { id: "anthropic" } as QuotaProviderView,
  ]

  it("matches anthropic family ids to anthropic quota", () => {
    expect(findQuotaProviderBySelectedModel(providers, "anthropic:claude-sonnet-4-5")?.id).toBe("anthropic")
  })

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
