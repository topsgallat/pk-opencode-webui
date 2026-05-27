function readCode(value: string): string | null {
  const input = value.trim()
  if (!input.includes("code=")) return null

  const query = input.startsWith("?") || input.startsWith("#") ? input.slice(1) : input
  const code = new URLSearchParams(query).get("code")?.trim()
  return code || null
}

export function extractOAuthCode(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  const direct = readCode(value)
  if (direct) return direct

  try {
    const url = new URL(value)
    return readCode(url.search) || readCode(url.hash) || null
  } catch {
    return value
  }
}
