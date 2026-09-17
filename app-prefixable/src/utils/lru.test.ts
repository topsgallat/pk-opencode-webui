import { describe, expect, test } from "bun:test"
import { createWeightedLru } from "./lru"

function makeLru(maxEntries = 10, maxWeight = 100) {
  return createWeightedLru<string>({
    maxEntries,
    maxWeight,
    weigh: (value) => value.length,
  })
}

describe("createWeightedLru", () => {
  test("stores and retrieves values", () => {
    const lru = makeLru()
    lru.set("a", "alpha")
    expect(lru.get("a")).toBe("alpha")
    expect(lru.peek("a")).toBe("alpha")
    expect(lru.size()).toBe(1)
    expect(lru.weight()).toBe(5)
  })

  test("evicts the oldest entry beyond maxEntries", () => {
    const lru = makeLru(2, 1000)
    lru.set("a", "aaaaa")
    lru.set("b", "bbbbb")
    lru.set("c", "ccccc")
    expect(lru.get("a")).toBeUndefined()
    expect(lru.get("b")).toBe("bbbbb")
    expect(lru.get("c")).toBe("ccccc")
    expect(lru.size()).toBe(2)
  })

  test("access bumps recency so recently used entries survive", () => {
    const lru = makeLru(2, 1000)
    lru.set("a", "aaaaa")
    lru.set("b", "bbbbb")
    expect(lru.get("a")).toBe("aaaaa")
    lru.set("c", "ccccc")
    expect(lru.get("a")).toBe("aaaaa")
    expect(lru.get("b")).toBeUndefined()
  })

  test("evicts by total weight beyond maxWeight", () => {
    const lru = makeLru(100, 10)
    lru.set("a", "12345")
    lru.set("b", "67890")
    lru.set("c", "abcde")
    expect(lru.get("a")).toBeUndefined()
    expect(lru.get("b")).toBe("67890")
    expect(lru.get("c")).toBe("abcde")
    expect(lru.weight()).toBeLessThanOrEqual(10)
  })

  test("skips caching entries larger than the whole budget", () => {
    const lru = makeLru(100, 10)
    lru.set("big", "0123456789abcdef")
    expect(lru.peek("big")).toBeUndefined()
    expect(lru.size()).toBe(0)
  })

  test("set on an existing key replaces weight without double counting", () => {
    const lru = makeLru(10, 100)
    lru.set("a", "12345")
    lru.set("a", "1234567890")
    expect(lru.weight()).toBe(10)
    expect(lru.get("a")).toBe("1234567890")
  })

  test("refresh reweighs a mutated value and keeps bounds", () => {
    const lru = createWeightedLru<{ size: number }>({
      maxEntries: 10,
      maxWeight: 10,
      weigh: (value) => value.size,
    })
    lru.set("a", { size: 4 })
    lru.set("b", { size: 4 })
    lru.get("a")!.size = 99
    lru.refresh("a")
    expect(lru.get("a")).toBeUndefined() // now over budget, evicted
    expect(lru.get("b")).toBeUndefined() // a's eviction pulled b with it
    expect(lru.weight()).toBe(0)
  })

  test("delete removes weight accounting", () => {
    const lru = makeLru()
    lru.set("a", "12345")
    lru.delete("a")
    expect(lru.peek("a")).toBeUndefined()
    expect(lru.size()).toBe(0)
    expect(lru.weight()).toBe(0)
  })
})
