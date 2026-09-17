export interface WeightedLruOptions<V> {
  maxEntries: number
  maxWeight: number
  weigh: (value: V) => number
}

// Size-bounded LRU cache. Map preserves insertion order, so re-inserting on
// access keeps the first key as the least recently used entry, and eviction
// walks from the front. Weight accounting bounds total memory rather than
// entry count alone, since cached values here vary wildly in size.
export function createWeightedLru<V>(options: WeightedLruOptions<V>) {
  const entries = new Map<string, { value: V; weight: number }>()
  let total = 0

  const bounded = (weight: number) => Math.max(1, weight)

  const evictOverflow = () => {
    while (entries.size > 0 && (entries.size > options.maxEntries || total > options.maxWeight)) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      const node = entries.get(oldest.value)
      if (!node) break
      entries.delete(oldest.value)
      total -= node.weight
    }
  }

  return {
    get(key: string) {
      const node = entries.get(key)
      if (!node) return undefined
      entries.delete(key)
      entries.set(key, node)
      return node.value
    },
    peek(key: string) {
      return entries.get(key)?.value
    },
    set(key: string, value: V) {
      const existing = entries.get(key)
      if (existing) {
        total -= existing.weight
        entries.delete(key)
      }

      const weight = bounded(options.weigh(value))
      // An entry larger than the whole budget would flush everything else on
      // every insert; leave it uncached so it is recomputed on demand instead.
      if (weight > options.maxWeight) return

      entries.set(key, { value, weight })
      total += weight
      evictOverflow()
    },
    // Reweigh after an in-place value mutation and treat the entry as recently
    // used; an entry that grew past the budget evicts naturally.
    refresh(key: string) {
      const node = entries.get(key)
      if (!node) return
      total -= node.weight
      node.weight = bounded(options.weigh(node.value))
      total += node.weight
      entries.delete(key)
      entries.set(key, node)
      evictOverflow()
    },
    delete(key: string) {
      const node = entries.get(key)
      if (!node) return
      entries.delete(key)
      total -= node.weight
    },
    size: () => entries.size,
    weight: () => total,
  }
}
