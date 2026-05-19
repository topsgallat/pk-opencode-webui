import { describe, expect, it } from "bun:test"
import { shouldLoadQuotaOnOpen, shouldRefreshQuotaOnOpen } from "./quota-refresh"

describe("shouldRefreshQuotaOnOpen", () => {
  it("refreshes when there is no cached quota", () => {
    expect(shouldRefreshQuotaOnOpen(undefined, false, 1_000, 60_000)).toBe(true)
  })

  it("keeps fresh quota without refetching", () => {
    expect(shouldRefreshQuotaOnOpen({ fetchedAt: "1970-01-01T00:00:01.000Z" }, false, 1_500, 1_000)).toBe(false)
  })

  it("refreshes stale quota", () => {
    expect(shouldRefreshQuotaOnOpen({ fetchedAt: "1970-01-01T00:00:01.000Z" }, false, 3_100, 1_000)).toBe(true)
  })

  it("refreshes after an error", () => {
    expect(shouldRefreshQuotaOnOpen({ fetchedAt: "1970-01-01T00:00:01.000Z" }, true, 1_500, 1_000)).toBe(true)
  })
})

describe("shouldLoadQuotaOnOpen", () => {
  it("loads on first open", () => {
    expect(shouldLoadQuotaOnOpen({ requested: false, loading: false, quota: undefined, hasError: false })).toBe(true)
  })

  it("does not refetch while loading", () => {
    expect(shouldLoadQuotaOnOpen({ requested: true, loading: true, quota: undefined, hasError: false })).toBe(false)
  })

  it("refetches stale data after open", () => {
    expect(shouldLoadQuotaOnOpen({ requested: true, loading: false, quota: { fetchedAt: "1970-01-01T00:00:01.000Z" }, hasError: false, now: 3_100, ttlMs: 1_000 })).toBe(true)
  })
})
