/**
 * Server-side prompt queue
 *
 * Keeps queued chat prompts inside the UI server process so they are
 * delivered even when the browser window is closed: a background worker
 * polls each upstream's session status and submits the head of every
 * session queue via prompt_async once the session is idle. The queue
 * survives UI server restarts through the shared settings store.
 *
 * Endpoints (all local, never proxied):
 *   POST   /api/ext/prompt-queue/{sessionID}?target=<url>   enqueue
 *   GET    /api/ext/prompt-queue/{sessionID}?target=<url>   list
 *   DELETE /api/ext/prompt-queue/{sessionID}/{itemID}?t=..  remove one
 *   DELETE /api/ext/prompt-queue/{sessionID}?target=<url>   clear
 */

type Dict = Record<string, unknown>

export interface PromptQueueItem {
  id: string
  createdAt: number
  // Display fields echoed back to the UI
  text: string
  fileContext?: Dict[]
  imageAttachments?: Dict[]
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string | null
  // Delivery fields used by the worker
  parts: Array<Dict>
  status: "queued" | "failed"
  attempts: number
  lastError?: string
  authHeader?: string
}

type PromptEndpointOptions = {
  resolveUpstreamAuthHeader?: (target: string) => string | undefined
  defaultTarget?: string
}

const NAMESPACE = "promptQueue"
const POLL_MS = 1_500
const MAX_ATTEMPTS = 3
const PATH_PREFIX = "/api/ext/prompt-queue"
const PATH_PATTERN = /^\/api\/ext\/prompt-queue\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?$/

// target base URL -> sessionID -> queued items (oldest first)
const queues = new Map<string, Map<string, PromptQueueItem[]>>()
const dialects = new Map<string, "v1" | "v2">()
let loaded = false
let loading: Promise<void> | undefined
let workerTimer: Timer | null = null
let workerRunning = false

function normalizeTarget(target: string): string {
  return target.endsWith("/") ? target.slice(0, -1) : target
}

async function loadPersisted(): Promise<void> {
  try {
    const { getSettingsStore } = await import("./settings-store")
    const stored = getSettingsStore().load(NAMESPACE) as Dict
    for (const [target, sessions] of Object.entries(stored)) {
      if (!sessions || typeof sessions !== "object") continue
      const perSession = new Map<string, PromptQueueItem[]>()
      for (const [sessionID, items] of Object.entries(sessions as Dict)) {
        if (!Array.isArray(items)) continue
        const valid = items.filter(isValidItem).map((item) => item as PromptQueueItem)
        if (valid.length > 0) perSession.set(sessionID, valid)
      }
      if (perSession.size > 0) queues.set(target, perSession)
    }
    // Items restored from storage (e.g. after a UI server restart) still
    // need delivering — nothing will POST again to kick the worker.
    if (hasPendingWork()) ensureWorker()
  } catch {
    // Settings store unavailable — run in-memory only
  }
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve()
  loading ??= loadPersisted().then(() => {
    loaded = true
  })
  return loading
}

/**
 * Load persisted queues at server boot so items queued before a restart
 * resume delivering immediately, even before any browser reconnects.
 */
export function warmPromptQueue(): Promise<void> {
  return ensureLoaded()
}

function isValidItem(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<PromptQueueItem>
  return typeof item.id === "string" && item.id.length > 0 &&
    Array.isArray(item.parts) &&
    item.status !== "failed"
}

async function persistTarget(target: string): Promise<void> {
  try {
    const { getSettingsStore } = await import("./settings-store")
    const perSession = queues.get(target)
    const record: Dict = {}
    if (perSession) {
      for (const [sessionID, items] of perSession) {
        // authHeader stays in memory only — never persist credentials
        record[sessionID] = items.map(({ authHeader, ...rest }) => rest)
      }
    }
    getSettingsStore().save(NAMESPACE, target, record)
  } catch {
    // In-memory only when the store is unavailable
  }
}

function sessionQueue(target: string, sessionID: string): PromptQueueItem[] {
  let perSession = queues.get(target)
  if (!perSession) {
    perSession = new Map()
    queues.set(target, perSession)
  }
  let items = perSession.get(sessionID)
  if (!items) {
    items = []
    perSession.set(sessionID, items)
  }
  return items
}

function publicItems(target: string, sessionID: string): Dict[] {
  return (queues.get(target)?.get(sessionID) ?? []).map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    text: item.text,
    fileContext: item.fileContext,
    imageAttachments: item.imageAttachments,
    agent: item.agent,
    model: item.model,
    variant: item.variant,
    status: item.status,
    attempts: item.attempts,
    lastError: item.lastError,
  }))
}

// --- Upstream dialect handling -------------------------------------------

async function dialectFor(target: string, authHeader?: string): Promise<"v1" | "v2"> {
  const cached = dialects.get(target)
  if (cached) return cached
  const headers: Record<string, string> = {}
  if (authHeader) headers.Authorization = authHeader
  const health = await fetchJson(`${target}/global/health`, headers)
  if (health && (health as Dict).healthy === true) {
    dialects.set(target, "v1")
    return "v1"
  }
  const info = await fetchJson(`${target}/api/info`, headers)
  if (info && typeof (info as Dict).version === "string") {
    dialects.set(target, "v2")
    return "v2"
  }
  return "v1"
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return undefined
    return await res.json()
  } catch {
    return undefined
  }
}

function sessionBusy(statusPayload: unknown, sessionID: string): boolean {
  if (!statusPayload || typeof statusPayload !== "object") return true
  if (Array.isArray(statusPayload)) return false
  const raw = statusPayload as Dict
  const entry = raw[sessionID]
  if (entry && typeof entry === "object") {
    const type = (entry as Dict).type
    if (typeof type === "string") return type === "busy" || type === "retry"
    return true
  }
  // v2 /api/session/active: { data: [...] } lists busy sessions
  if (Array.isArray(raw.data)) {
    return raw.data.some((item) => {
      if (!item || typeof item !== "object") return false
      const e = item as Dict
      return e.id === sessionID || e.sessionID === sessionID
    })
  }
  return false
}

function partsToBody(parts: Array<Dict>): { text: string; files: Array<{ uri: string; name?: string }> } {
  const texts: string[] = []
  const files: Array<{ uri: string; name?: string }> = []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") texts.push(part.text)
    if (part.type === "file" && typeof part.url === "string") {
      files.push({ uri: part.url, name: typeof part.filename === "string" ? part.filename : undefined })
    }
  }
  return { text: texts.join("\n\n"), files }
}

async function sendPrompt(target: string, dialect: "v1" | "v2", sessionID: string, item: PromptQueueItem): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (item.authHeader) headers.Authorization = item.authHeader

  if (dialect === "v1") {
    return fetch(`${target}/session/${sessionID}/prompt_async`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messageID: item.id,
        agent: item.agent,
        model: item.model,
        variant: item.variant ?? undefined,
        parts: item.parts,
      }),
      signal: AbortSignal.timeout(20_000),
    })
  }

  if (item.model && item.model.modelID) {
    const model: Dict = { providerID: item.model.providerID, id: item.model.modelID }
    if (typeof item.variant === "string" && item.variant) model.variant = item.variant
    const modelRes = await fetch(`${target}/api/session/${sessionID}/model`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!modelRes.ok) return modelRes
  }
  return fetch(`${target}/api/session/${sessionID}/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify(partsToBody(item.parts)),
    signal: AbortSignal.timeout(20_000),
  })
}

// --- Worker ---------------------------------------------------------------

function hasPendingWork(): boolean {
  for (const perSession of queues.values()) {
    for (const items of perSession.values()) {
      if (items.some((item) => item.status === "queued")) return true
    }
  }
  return false
}

function ensureWorker(): void {
  if (workerTimer) return
  workerTimer = setInterval(() => {
    void runWorkerPass()
  }, POLL_MS)
}

async function runWorkerPass(): Promise<void> {
  if (workerRunning) return
  workerRunning = true
  try {
    for (const [target, perSession] of queues) {
      const targets = [...perSession.entries()].filter(([, items]) => items.some((item) => item.status === "queued"))
      if (targets.length === 0) continue

      const authHeader = targets.flatMap(([, items]) => items)[0]?.authHeader
      const dialect = await dialectFor(target, authHeader)
      const statusUrl = dialect === "v2" ? `${target}/api/session/active` : `${target}/session/status`
      const statusHeaders: Record<string, string> = {}
      if (authHeader) statusHeaders.Authorization = authHeader
      const status = await fetchJson(statusUrl, statusHeaders)

      let mutated = false
      for (const [sessionID, items] of perSession) {
        const head = items[0]
        if (!head || head.status !== "queued") continue
        if (sessionBusy(status, sessionID)) continue

        try {
          const res = await sendPrompt(target, dialect, sessionID, head)
          if (res.ok) {
            console.log(`[PromptQueue] Sent queued prompt ${head.id} to session ${sessionID}`)
            items.shift()
            mutated = true
          } else {
            const message = `${res.status} ${res.statusText}`
            head.attempts += 1
            head.lastError = message
            if (head.attempts >= MAX_ATTEMPTS) {
              head.status = "failed"
              console.error(`[PromptQueue] Giving up on prompt ${head.id} after ${head.attempts} attempts: ${message}`)
            }
            mutated = true
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          head.attempts += 1
          head.lastError = message
          if (head.attempts >= MAX_ATTEMPTS) head.status = "failed"
          mutated = true
        }
      }

      if (mutated) await persistTarget(target)
      if (perSession.size === 0 || [...perSession.values()].every((items) => items.length === 0)) {
        queues.delete(target)
      }
    }
  } finally {
    workerRunning = false
    if (!hasPendingWork() && workerTimer) {
      clearInterval(workerTimer)
      workerTimer = null
    }
  }
}

// --- Endpoint handler -----------------------------------------------------

export async function handlePromptQueueEndpoint(
  path: string,
  method: string,
  url: URL,
  req: Request,
  options?: PromptEndpointOptions,
): Promise<Response | undefined> {
  if (!path.startsWith(PATH_PREFIX)) return undefined
  const match = PATH_PATTERN.exec(path)
  if (!match) return Response.json({ error: "not found" }, { status: 404 })

  const sessionID = match[1]
  const itemID = match[2]
  const target = normalizeTarget(
    url.searchParams.get("target") || options?.defaultTarget || "http://127.0.0.1:4096",
  )

  await ensureLoaded()

  if (method === "GET") {
    return Response.json({ items: publicItems(target, sessionID) })
  }

  if (method === "POST") {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return Response.json({ error: "json body required" }, { status: 400 })
    }
    const raw = body as Dict
    if (typeof raw.id !== "string" || !raw.id) {
      return Response.json({ error: "id is required" }, { status: 400 })
    }
    if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
      return Response.json({ error: "parts are required" }, { status: 400 })
    }
    if (typeof raw.text !== "string") {
      return Response.json({ error: "text is required" }, { status: 400 })
    }

    const authHeader =
      options?.resolveUpstreamAuthHeader?.(target + "/") || req.headers.get("authorization") || undefined
    const items = sessionQueue(target, sessionID)
    const item: PromptQueueItem = {
      id: raw.id,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      text: raw.text,
      fileContext: Array.isArray(raw.fileContext) ? raw.fileContext as Dict[] : undefined,
      imageAttachments: Array.isArray(raw.imageAttachments) ? raw.imageAttachments as Dict[] : undefined,
      agent: typeof raw.agent === "string" ? raw.agent : undefined,
      model: raw.model && typeof raw.model === "object"
        ? raw.model as { providerID: string; modelID: string }
        : undefined,
      variant: typeof raw.variant === "string" ? raw.variant : null,
      parts: raw.parts as Array<Dict>,
      status: "queued",
      attempts: 0,
      authHeader,
    }
    items.push(item)
    await persistTarget(target)
    // The session may already be idle — deliver without waiting for a tick
    ensureWorker()
    void runWorkerPass()
    return Response.json({ items: publicItems(target, sessionID) })
  }

  if (method === "DELETE") {
    const perSession = queues.get(target)
    if (itemID) {
      const items = perSession?.get(sessionID) ?? []
      const index = items.findIndex((item) => item.id === itemID)
      if (index >= 0) items.splice(index, 1)
    } else if (perSession) {
      perSession.delete(sessionID)
    }
    if (perSession && (perSession.size === 0 || [...perSession.values()].every((items) => items.length === 0))) {
      queues.delete(target)
    }
    await persistTarget(target)
    return Response.json({ items: publicItems(target, sessionID) })
  }

  return Response.json({ error: "method not allowed" }, { status: 405 })
}

export function __resetPromptQueueForTests(): void {
  queues.clear()
  dialects.clear()
  loaded = false
  loading = undefined
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
  workerRunning = false
}

export async function __runWorkerPassForTests(): Promise<void> {
  await runWorkerPass()
}
