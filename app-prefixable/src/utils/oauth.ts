function readCode(value: string): string | null {
  const input = value.trim()
  if (!input.includes("code=")) return null

  const query = input.startsWith("?") || input.startsWith("#") ? input.slice(1) : input
  const code = new URLSearchParams(query).get("code")?.trim()
  return code || null
}

function mergeFragment(url: URL): void {
  if (!url.hash) return

  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  if (!fragment) {
    url.hash = ""
    return
  }

  const fragmentParams = new URLSearchParams(fragment)
  for (const [key, value] of fragmentParams) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
  }

  url.hash = ""
}

export function extractOAuthCode(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  const direct = readCode(value)
  if (direct) return direct

  try {
    const url = new URL(value)
    mergeFragment(url)
    return readCode(url.search) || null
  } catch {
    return value
  }
}

export function normalizeOAuthCallbackUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    mergeFragment(url)
    if (!url.searchParams.get("code")) return null
    if (!url.searchParams.get("state")) return null
    return url.toString()
  } catch {
    return null
  }
}

export function needsOAuthReplay(providerID: string, methodLabel: string, authUrl?: string): boolean {
  if (providerID !== "openai" && !providerID.startsWith("openai:")) return false
  if (authUrl && /\/device(?:\?|$)/i.test(authUrl)) return false
  return /\b(browser|local)\b/i.test(methodLabel)
}

export function isOAuthCodeOnly(providerID: string, methodLabel: string, authUrl?: string): boolean {
  if (providerID !== "openai" && !providerID.startsWith("openai:")) return false
  if (authUrl && /\/deviceauth\/usercode(?:\?|$)/i.test(authUrl)) return true
  return /\b(headless|code)\b/i.test(methodLabel)
}

export function extractOAuthInstructionCode(instructions: string): string {
  const text = instructions.replace(/https?:\/\/\S+/gi, " ")
  const labeled = text.match(/:\s*([A-Z0-9][A-Z0-9-]{5,20}[A-Z0-9])/i)
  if (labeled) return labeled[1].toUpperCase()

  const fallback = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b|\b[A-Z0-9]{9}\b/i)
  return fallback ? fallback[0].toUpperCase() : ""
}
