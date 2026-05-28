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
