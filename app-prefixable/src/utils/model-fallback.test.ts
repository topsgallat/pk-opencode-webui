import { describe, expect, it } from "bun:test"
import { isRetryableModelFailure, pickFallbackCandidate, rankFallbackCandidates, type FallbackCandidate } from "./model-fallback"

function candidate(overrides: Partial<FallbackCandidate>): FallbackCandidate {
  return {
    providerID: "openai",
    providerName: "OpenAI",
    modelID: "gpt-4.1",
    modelName: "GPT-4.1",
    providerIndex: 0,
    modelIndex: 0,
    ...overrides,
  }
}

describe("isRetryableModelFailure", () => {
  it("matches rate limit and quota failures", () => {
    expect(isRetryableModelFailure({ status: 429, message: "Too many requests" })).toBe(true)
    expect(isRetryableModelFailure({ data: { status: 402, message: "insufficient_quota" } })).toBe(true)
    expect(isRetryableModelFailure({ message: "Quota exceeded" })).toBe(true)
  })

  it("rejects unrelated failures", () => {
    expect(isRetryableModelFailure({ status: 401, message: "Unauthorized" })).toBe(false)
    expect(isRetryableModelFailure({ message: "Context length exceeded" })).toBe(false)
    expect(isRetryableModelFailure(new Error("Network down"))).toBe(false)
  })
})

describe("rankFallbackCandidates", () => {
  it("drops the current model and orders by quota headroom", () => {
    const ranked = rankFallbackCandidates([
      candidate({ providerID: "openai", modelID: "gpt-4.1", modelIndex: 0 }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-4.5", modelName: "Claude 4.5", providerIndex: 1, modelIndex: 0 }),
      candidate({ providerID: "gemini", providerName: "Google", modelID: "gemini-2.5", modelName: "Gemini 2.5", providerIndex: 2, modelIndex: 0 }),
    ], {
      ok: true,
      fetchedAt: new Date().toISOString(),
      refreshed: false,
      source: "live",
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          available: true,
          status: "ok",
          entries: [{ id: "claude", group: "quota", label: "Claude 5h", percentUsed: 10 }],
        },
        {
          id: "gemini",
          name: "Google",
          available: true,
          status: "ok",
          entries: [{ id: "gemini", group: "quota", label: "Gemini", percentUsed: 70 }],
        },
        {
          id: "openai",
          name: "OpenAI",
          available: true,
          status: "ok",
          entries: [{ id: "openai", group: "quota", label: "Primary Window", percentUsed: 90 }],
        },
      ],
      summary: { availableProviders: ["anthropic", "gemini", "openai"], unavailableProviders: [], hasWarnings: false },
      warnings: [],
    })

    expect(ranked[0].providerID).toBe("anthropic")
    expect(ranked[0].quotaPercentRemaining).toBe(90)

    const next = pickFallbackCandidate([
      candidate({ providerID: "openai", modelID: "gpt-4.1", modelIndex: 0 }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-4.5", modelName: "Claude 4.5", providerIndex: 1, modelIndex: 0 }),
      candidate({ providerID: "gemini", providerName: "Google", modelID: "gemini-2.5", modelName: "Gemini 2.5", providerIndex: 2, modelIndex: 0 }),
    ], { providerID: "openai", modelID: "gpt-4.1" }, {
      ok: true,
      fetchedAt: new Date().toISOString(),
      refreshed: false,
      source: "live",
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          available: true,
          status: "ok",
          entries: [{ id: "claude", group: "quota", label: "Claude 5h", percentUsed: 10 }],
        },
        {
          id: "gemini",
          name: "Google",
          available: true,
          status: "ok",
          entries: [{ id: "gemini", group: "quota", label: "Gemini", percentUsed: 70 }],
        },
        {
          id: "openai",
          name: "OpenAI",
          available: true,
          status: "ok",
          entries: [{ id: "openai", group: "quota", label: "Primary Window", percentUsed: 90 }],
        },
      ],
      summary: { availableProviders: ["anthropic", "gemini", "openai"], unavailableProviders: [], hasWarnings: false },
      warnings: [],
    })

    expect(next?.providerID).toBe("anthropic")
  })

  it("skips cooling down or unavailable providers", () => {
    const ranked = rankFallbackCandidates([
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude", modelName: "Claude", providerIndex: 0 }),
      candidate({ providerID: "gemini", providerName: "Google", modelID: "gemini", modelName: "Gemini", providerIndex: 1 }),
    ], {
      ok: true,
      fetchedAt: new Date().toISOString(),
      refreshed: false,
      source: "live",
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          available: false,
          status: "unavailable",
          cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
          entries: [],
        },
        {
          id: "gemini",
          name: "Google",
          available: true,
          status: "ok",
          entries: [],
        },
      ],
      summary: { availableProviders: ["gemini"], unavailableProviders: [], hasWarnings: false },
      warnings: [],
    })

    expect(ranked.map((item) => item.providerID)).toEqual(["gemini"])
  })

  it("keeps deterministic order when quota is unavailable", () => {
    const ranked = rankFallbackCandidates([
      candidate({ providerID: "gemini", providerName: "Google", providerIndex: 1 }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", providerIndex: 0 }),
    ], null)

    expect(ranked.map((item) => item.providerID)).toEqual(["anthropic", "gemini"])
  })

  it("honors explicit fallback order before quota ranking", () => {
    const next = pickFallbackCandidate([
      candidate({ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1", providerIndex: 0, modelIndex: 0 }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-4.5", modelName: "Claude 4.5", providerIndex: 1, modelIndex: 0 }),
      candidate({ providerID: "gemini", providerName: "Google", modelID: "gemini-2.5", modelName: "Gemini 2.5", providerIndex: 2, modelIndex: 0 }),
    ], { providerID: "openai", modelID: "gpt-4.1" }, {
      ok: true,
      fetchedAt: new Date().toISOString(),
      refreshed: false,
      source: "live",
      providers: [],
      summary: { availableProviders: [], unavailableProviders: [], hasWarnings: false },
      warnings: [],
    }, {
      enabled: true,
      cross_provider: true,
      order: ["gemini/gemini-2.5", "anthropic/claude-4.5"],
    })

    expect(next?.providerID).toBe("gemini")
    expect(next?.modelID).toBe("gemini-2.5")
  })

  it("restricts fallback to the current provider when cross-provider is disabled", () => {
    const next = pickFallbackCandidate([
      candidate({ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1", providerIndex: 0, modelIndex: 0 }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-4.5", modelName: "Claude 4.5", providerIndex: 1, modelIndex: 0 }),
    ], { providerID: "openai", modelID: "gpt-4.1" }, null, {
      enabled: true,
      cross_provider: false,
      order: ["anthropic/claude-4.5"],
    })

    expect(next).toBe(null)
  })
})

describe("pickFallbackCandidate", () => {
  it("excludes the current model", () => {
    const next = pickFallbackCandidate([
      candidate({ providerID: "openai", modelID: "gpt-4.1" }),
      candidate({ providerID: "anthropic", providerName: "Anthropic", modelID: "claude", modelName: "Claude", providerIndex: 1 }),
    ], { providerID: "openai", modelID: "gpt-4.1" }, null)

    expect(next?.providerID).toBe("anthropic")
  })
})
