import { describe, expect, it } from "bun:test"
import { findPrimaryQuotaEntry, findQuotaProviderBySelectedModel, getQuotaPercentUsed, resolveQuotaProviderState } from "./session-info-helpers"
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

  it("returns the provider and primary quota entry together", () => {
    const state = resolveQuotaProviderState([
      {
        id: "anthropic",
        entries: [
          { id: "secondary", label: "Claude 7d", group: "quota", percentUsed: 42 },
          { id: "primary", label: "Claude 5h", group: "quota", percentUsed: 9 },
        ],
      },
    ] as QuotaProviderView[], "anthropic:claude-sonnet-4-5")

    expect(state.provider?.id).toBe("anthropic")
    expect(state.entry?.id).toBe("primary")
  })
})

describe("findPrimaryQuotaEntry", () => {
  it("prefers anthropic 5h and falls back to 7d", () => {
    expect(findPrimaryQuotaEntry({
      id: "anthropic",
      entries: [
        { id: "7d", label: "Claude 7d", group: "quota" },
        { id: "5h", label: "Claude 5h", group: "quota" },
      ],
    })?.id).toBe("5h")

    expect(findPrimaryQuotaEntry({
      id: "anthropic",
      entries: [{ id: "7d", label: "Claude 7d", group: "quota" }],
    })?.id).toBe("7d")
  })

  it("prefers openai primary window and ignores code review", () => {
    expect(findPrimaryQuotaEntry({
      id: "openai",
      entries: [
        { id: "review", label: "Code Review", group: "quota", percentUsed: 90 },
        { id: "secondary", label: "Secondary Window", group: "quota", percentUsed: 40 },
        { id: "primary", label: "Primary Window", group: "quota", percentUsed: 10 },
      ],
    })?.id).toBe("primary")

    expect(findPrimaryQuotaEntry({
      id: "openai",
      entries: [
        { id: "review", label: "Code Review", group: "quota", percentUsed: 90 },
        { id: "secondary", label: "Secondary Window", group: "quota", percentUsed: 40 },
      ],
    })?.id).toBe("secondary")
  })

  it("uses the first usable entry for copilot and gemini", () => {
    expect(findPrimaryQuotaEntry({
      id: "copilot",
      entries: [
        { id: "unlimited", label: "Monthly", group: "quota", unlimited: true },
        { id: "usable", label: "Hourly", group: "quota", percentUsed: 12 },
      ],
    })?.id).toBe("usable")
  })
})

describe("getQuotaPercentUsed", () => {
  it("derives percent from used and total when needed", () => {
    expect(getQuotaPercentUsed({ used: 30, total: 120 })).toBe(25)
  })
})
