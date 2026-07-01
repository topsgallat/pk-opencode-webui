import type { Part } from "../sdk/client"

function sameUnknown(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a == null || b == null) return false
  if (typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!sameUnknown(a[i], b[i])) return false
    }
    return true
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i]
    if (key !== rightKeys[i]) return false
    if (!sameUnknown(left[key], right[key])) return false
  }
  return true
}

function unknownWeight(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "string") return value.length
  if (typeof value === "number" || typeof value === "boolean") return String(value).length
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + unknownWeight(item), value.length)
  if (typeof value !== "object") return 0

  const record = value as Record<string, unknown>
  let total = 0
  for (const key of Object.keys(record)) total += key.length + unknownWeight(record[key])
  return total
}

function sameProjectedPart(a: Part, b: Part) {
  if (a.type !== b.type) return false
  if (a.type === "text" && b.type === "text") return a.text === b.text
  if (a.type === "reasoning" && b.type === "reasoning") return a.text === b.text
  if (a.type === "file" && b.type === "file") {
    return a.mime === b.mime && a.filename === b.filename && a.url === b.url
  }
  if (a.type === "tool" && b.type === "tool") {
    return a.tool === b.tool && sameUnknown(a.state, b.state)
  }
  return true
}

function projectedPartWeight(part: Part) {
  if (part.type === "text") return part.type.length + part.text.length
  if (part.type === "reasoning") return part.type.length + part.text.length
  if (part.type === "file") return part.type.length + part.mime.length + (part.filename?.length ?? 0) + part.url.length
  if (part.type === "tool") return part.type.length + part.tool.length + unknownWeight(part.state)
  return part.type.length
}

export function sameProjectedParts(a: Part[], b: Part[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!sameProjectedPart(a[i], b[i])) return false
  }
  return true
}

export function projectedPartsWeight(parts: Part[]) {
  return parts.reduce((sum, part) => sum + projectedPartWeight(part), parts.length)
}
