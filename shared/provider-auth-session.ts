const COOKIE_NAME = "opencode_proxy_session"

const sessions = new Map<string, Map<string, string>>()

function normalizeProviderID(providerID: string): string {
  const id = providerID.trim()
  if (id === "github-copilot") return "copilot"
  return id
}

export function getProviderIDCandidates(providerID: string): string[] {
  const id = providerID.trim()
  if (!id) return []

  const normalized = normalizeProviderID(id)
  if (normalized === id) {
    return id === "copilot" ? ["copilot", "github-copilot"] : [id]
  }

  return [normalized, id]
}

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

function canonicalizeTarget(target: string): string | undefined {
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

function buildStoreKey(target: string, providerID: string): string | undefined {
  const key = canonicalizeTarget(target)
  const id = providerID.trim()
  if (!key || !id) return undefined
  return `${key}::${id}`
}

function resolveStoreKey(values: Map<string, string>, target: string, providerID: string): string | undefined {
  for (const candidate of getProviderIDCandidates(providerID)) {
    const key = buildStoreKey(target, candidate)
    if (!key) continue
    if (values.has(key)) return key

    const prefix = `${key}:`
    for (const stored of values.keys()) {
      if (stored === key || stored.startsWith(prefix)) return stored
    }
  }

  return undefined
}

export function syncProviderAuthSession(req: Request, target: string, body: unknown): Response {
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const providerID = typeof raw.providerID === "string" ? raw.providerID.trim() : ""
  const authHeader = typeof raw.authHeader === "string" ? raw.authHeader.trim() : ""

  const key = buildStoreKey(target, providerID)
  const normalizedKey = buildStoreKey(target, normalizeProviderID(providerID))
  const storeKey = normalizedKey || key
  if (!storeKey) {
    return Response.json({ error: "target and providerID are required" }, { status: 400 })
  }
  if (!authHeader) {
    return Response.json({ error: "authHeader is required" }, { status: 400 })
  }

  const session = getOrCreateSession(req)
  session.values.set(storeKey, authHeader)

  const headers = new Headers()
  if (session.created) {
    headers.set("Set-Cookie", buildSessionCookie(session.id))
  }
  return new Response(JSON.stringify({ ok: true, target: canonicalizeTarget(target), providerID: normalizeProviderID(providerID) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(headers.get("Set-Cookie") ? { "Set-Cookie": headers.get("Set-Cookie")! } : {}),
    },
  })
}

export function clearProviderAuthSession(req: Request, target: string, providerID: string): Response {
  const id = getSessionId(req)
  const candidates = getProviderIDCandidates(providerID)
  if (candidates.length === 0) {
    return Response.json({ error: "target and providerID are required" }, { status: 400 })
  }
  if (!id) {
    return Response.json({ ok: true, target: canonicalizeTarget(target), providerID, cleared: false })
  }
  const values = sessions.get(id)
  if (!values) {
    return Response.json({ ok: true, target: canonicalizeTarget(target), providerID, cleared: false })
  }
  let existed = false
  for (const candidate of candidates) {
    const key = buildStoreKey(target, candidate)
    if (!key) continue
    const prefix = `${key}:`
    for (const stored of [...values.keys()]) {
      if (stored !== key && !stored.startsWith(prefix)) continue
      values.delete(stored)
      existed = true
    }
  }
  if (values.size === 0) sessions.delete(id)
  return Response.json({ ok: true, target: canonicalizeTarget(target), providerID, cleared: existed })
}

export function resolveProviderAuthHeader(req: Request, target: string, providerID: string): string | undefined {
  const id = getSessionId(req)
  if (!id) return undefined
  const values = sessions.get(id)
  if (!values) return undefined
  const key = resolveStoreKey(values, target, providerID)
  if (!key) return undefined
  return values.get(key)
}

export function __resetProviderAuthSessionsForTests() {
  sessions.clear()
}
