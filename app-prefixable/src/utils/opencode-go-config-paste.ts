const BEARER_RE = /bearer\s+([A-Za-z0-9._-]+)/i
const KEY_VALUE_RE = /(?:OPENCODE(?:_GO)?_)?API[_-]?KEY["':=\s]+([A-Za-z0-9._-]{8,})/i

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? text
}

function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 16 && /^[A-Za-z0-9._-]+$/.test(trimmed)
}

export function extractOpenCodeGoApiKey(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  const bearerMatch = trimmed.match(BEARER_RE)
  if (bearerMatch?.[1]) return bearerMatch[1]

  const envMatch = trimmed.match(KEY_VALUE_RE)
  if (envMatch?.[1]) return envMatch[1]

  const first = firstLine(trimmed)
  const parts = first.split(/\t/)
  if (parts.length >= 2) {
    const name = parts[0].trim().toLowerCase()
    const value = parts[1].trim()
    if (name.includes("authorization") && value) return value.replace(/^bearer\s+/i, "")
  }

  if (looksLikeApiKey(trimmed)) return trimmed
  return undefined
}
