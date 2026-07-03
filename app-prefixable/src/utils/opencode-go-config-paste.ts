const WORKSPACE_RE = /workspace\/([a-zA-Z0-9_-]+)/i
const AUTH_COOKIE_RE = /(?:^|;|\s)auth=([^;\s]+)/i

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? text
}

function looksLikeWorkspaceId(value: string): boolean {
  return /^[a-z0-9_-]+$/i.test(value.trim()) && value.trim().length >= 3
}

function looksLikeAuthCookie(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 8 && !trimmed.includes(" ") && !trimmed.includes("\t")
}

export function extractOpenCodeGoWorkspaceId(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  if (looksLikeWorkspaceId(trimmed)) return trimmed

  const match = trimmed.match(WORKSPACE_RE)
  if (match) {
    const id = match[1]
    if (id) return id
  }

  return undefined
}

function cleanCookieValue(value: string): string {
  return value.trim().replace(/['"`]+$/, "")
}

export function extractOpenCodeGoAuthCookie(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  const headerMatch = trimmed.match(/cookie:\s*([^\n]+)/i)
  if (headerMatch) {
    const cookieMatch = headerMatch[1].match(AUTH_COOKIE_RE)
    if (cookieMatch?.[1]) return cleanCookieValue(cookieMatch[1])
  }

  const authMatch = trimmed.match(AUTH_COOKIE_RE)
  if (authMatch?.[1]) return cleanCookieValue(authMatch[1])

  const first = firstLine(trimmed)
  const parts = first.split(/\t/)
  if (parts.length >= 2) {
    const name = parts[0].trim()
    const value = parts[1].trim()
    if (name.toLowerCase() === "auth" && value) return value
  }

  if (looksLikeAuthCookie(trimmed)) return trimmed

  return undefined
}