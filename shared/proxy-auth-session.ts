const COOKIE_NAME = "opencode_proxy_session"

const sessions = new Map<string, Map<string, string>>()

function parseCookies(raw: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!raw) return out
  for (const part of raw.split(";")) {
    const i = part.indexOf("=")
    if (i <= 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    out.set(k, decodeURIComponent(v))
  }
  return out
}

function getSessionId(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.get("cookie"))
  const id = cookies.get(COOKIE_NAME)
  if (!id) return undefined
  if (!/^[a-f0-9]{32}$/i.test(id)) return undefined
  return id
}

function makeSessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function getOrCreateSession(req: Request): { id: string; values: Map<string, string>; created: boolean } {
  const existing = getSessionId(req)
  if (existing) {
    const values = sessions.get(existing) || new Map<string, string>()
    sessions.set(existing, values)
    return { id: existing, values, created: false }
  }

  const id = makeSessionId()
  const values = new Map<string, string>()
  sessions.set(id, values)
  return { id, values, created: true }
}

function buildSessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`
}

function makeBasicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64")
  return `Basic ${token}`
}

export function canonicalizeTarget(target: string): string | undefined {
  try {
    const parsed = new URL(target)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    parsed.hash = ""
    const p = parsed.pathname || "/"
    parsed.pathname = p.length > 1 ? p.replace(/\/+$/g, "") : "/"
    const q = new URLSearchParams(parsed.search)
    q.sort()
    parsed.search = q.toString() ? `?${q.toString()}` : ""
    return `${parsed.origin}${parsed.pathname}${parsed.search}`
  } catch {
    return undefined
  }
}

function resolveSessionKey(values: Map<string, string>, target: string): string | undefined {
  const key = canonicalizeTarget(target)
  if (!key) return undefined
  if (values.has(key)) return key

  let parsedTarget: URL
  try {
    parsedTarget = new URL(key)
  } catch {
    return undefined
  }

  const candidates: string[] = []
  for (const stored of values.keys()) {
    let parsedStored: URL
    try {
      parsedStored = new URL(stored)
    } catch {
      continue
    }
    if (parsedStored.origin !== parsedTarget.origin) continue
    if (parsedStored.search && parsedStored.search !== parsedTarget.search) continue
    const base = parsedStored.pathname
    const path = parsedTarget.pathname
    if (path === base || path.startsWith(`${base}/`)) {
      candidates.push(stored)
    }
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

export function syncProxyAuthSession(req: Request, body: unknown): Response {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const target = typeof (body as Record<string, unknown>).target === "string" ? (body as Record<string, string>).target : ""
  const password = typeof (body as Record<string, unknown>).password === "string" ? (body as Record<string, string>).password : ""
  const username = typeof (body as Record<string, unknown>).username === "string" && (body as Record<string, string>).username.trim()
    ? (body as Record<string, string>).username.trim()
    : "opencode"

  const key = canonicalizeTarget(target)
  if (!key) {
    return Response.json({ error: "target must be a valid http/https URL" }, { status: 400 })
  }
  if (!password) {
    return Response.json({ error: "password is required" }, { status: 400 })
  }

  const session = getOrCreateSession(req)
  session.values.set(key, makeBasicAuth(username, password))

  const headers = new Headers()
  if (session.created) {
    headers.set("Set-Cookie", buildSessionCookie(session.id))
  }
  return new Response(JSON.stringify({ ok: true, target: key, username }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(headers.get("Set-Cookie") ? { "Set-Cookie": headers.get("Set-Cookie")! } : {}),
    },
  })
}

export function clearProxyAuthSession(req: Request, target: string): Response {
  const id = getSessionId(req)
  const key = canonicalizeTarget(target)
  if (!key) {
    return Response.json({ error: "target must be a valid http/https URL" }, { status: 400 })
  }
  if (!id) {
    return Response.json({ ok: true, target: key, cleared: false })
  }
  const values = sessions.get(id)
  if (!values) {
    return Response.json({ ok: true, target: key, cleared: false })
  }
  const existed = values.delete(key)
  if (values.size === 0) sessions.delete(id)
  return Response.json({ ok: true, target: key, cleared: existed })
}

export function resolveProxyAuthHeader(req: Request, target: string): string | undefined {
  const id = getSessionId(req)
  if (!id) return undefined
  const values = sessions.get(id)
  if (!values) return undefined
  const key = resolveSessionKey(values, target)
  if (!key) return undefined
  return values.get(key)
}

export function __resetProxyAuthSessionsForTests() {
  sessions.clear()
}
