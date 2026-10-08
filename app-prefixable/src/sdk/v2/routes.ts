import {
  eventFromV2,
  isV2EventEnvelope,
  messageFromV2,
  messageListFromV2,
  sessionFromV2,
} from "./translate"
import { cachedV2Version } from "./dialect"

type Dict = Record<string, unknown>

function dropDirectoryQuery(search: string): string {
  const params = new URLSearchParams(search)
  params.delete("directory")
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

// V2 validates query params strictly and caps list limits at 200.
function pagedQuery(search: string, max = 200): string {
  const params = new URLSearchParams(search)
  const out = new URLSearchParams()
  const raw = Number(params.get("limit"))
  if (Number.isFinite(raw) && raw > 0) out.set("limit", String(Math.min(Math.floor(raw), max)))
  const cursor = params.get("cursor")
  if (cursor) out.set("cursor", cursor)
  return out.toString() ? `?${out.toString()}` : ""
}

function jsonInit(method: string, url: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json()
  } catch {
    return undefined
  }
}

function unwrapData(payload: unknown): unknown {
  return payload && typeof payload === "object" && "data" in (payload as Dict)
    ? (payload as Dict).data
    : payload
}

// The prompt payload drifted across V2 generations: 2.0.x releases take the
// text top-level ({text, files}), newer dev builds wrap it ({prompt: {...}}).
// Distinguish by the /api/info version the dialect probe cached — default to
// the release shape since that is what ships.
function isWrappedPromptV2(url: URL): boolean {
  const version = cachedV2Version(url.searchParams.get("target") ?? undefined)
  return !!version && !/^2\.\d/.test(version)
}

function promptBodyFromV1(body: unknown, sessionID: string, url: URL): RouteToResult {
  const raw = (body ?? {}) as Dict
  const parts = Array.isArray(raw.parts) ? raw.parts : []
  const legacy = (raw.part ?? {}) as Dict
  const texts: string[] = []
  const files: Array<{ uri: string; name?: string }> = []
  if (typeof legacy.text === "string") texts.push(legacy.text)
  for (const item of parts) {
    const p = (item ?? {}) as Dict
    if (p.type === "text" && typeof p.text === "string") texts.push(p.text)
    if (p.type === "file" && typeof p.url === "string") {
      files.push({ uri: p.url, name: typeof p.filename === "string" ? p.filename : undefined })
    }
  }
  const text = texts.join("\n\n")
  const payload: Dict = { text, files }
  const wrapped = isWrappedPromptV2(url)
  let pre: RouteToResult["pre"]
  const model = (raw.model ?? {}) as Dict
  if (typeof model.providerID === "string" && typeof model.modelID === "string" && model.modelID) {
    const ref: Dict = { providerID: model.providerID, id: model.modelID }
    if (typeof raw.variant === "string" && raw.variant) ref.variant = raw.variant
    pre = { url: api(`/session/${sessionID}/model`, ""), init: jsonInit("POST", "", { model: ref }) }
  }
  return {
    url: api(`/session/${sessionID}/prompt`, ""),
    init: jsonInit("POST", "", wrapped ? { prompt: payload } : payload),
    pre,
  }
}

// V2 fs.list entries are {path, type} with paths relative to the queried
// workspace; V1 file nodes carry name + absolute paths (and consumers like
// the file tree render node.name). v2.0.22 also only routes the workspace
// via the x-opencode-directory header (the directory query is ignored) and
// 500s on subdirectory paths — handled by the file context's ext fallback.
async function fileListCustom({ url, send, directory }: { url: URL; send: Send; directory: string }): Promise<Response> {
  const base = directory.replace(/\/+$/, "")
  let requested = url.searchParams.get("path") ?? "."
  if (requested.startsWith("/") && base) {
    requested = requested === base ? "." : requested.startsWith(`${base}/`) ? requested.slice(base.length + 1) : requested
  }
  if (!requested) requested = "."
  const res = await send(`/api/fs/list?path=${encodeURIComponent(requested)}`, { method: "GET" })
  if (!res.ok) return res
  const payload = (await res.json().catch(() => null)) as { location?: { directory?: unknown }; data?: unknown } | null
  if (!payload) return res
  const workspace = (base || (typeof payload.location?.directory === "string" ? payload.location.directory : "")).replace(/\/+$/, "")
  const data = Array.isArray(payload.data) ? payload.data : []
  const nodes = data.map((item) => {
    const entry = dict2(item)
    const rel = str2(entry.path).replace(/\/+$/, "")
    const name = rel.split("/").pop() ?? rel
    const absolute = rel.startsWith("/") || !workspace ? rel : `${workspace}/${rel}`
    return { name, path: rel, absolute, type: str2(entry.type) || "file", ignored: false }
  })
  return jsonResponse(nodes)
}

function locationFromV2(payload: unknown): unknown {
  const raw = (payload ?? {}) as Dict
  const directory = typeof raw.directory === "string" ? raw.directory : ""
  // V1 /path returns {home, cwd, root}; V2 /api/location only knows the
  // instance directory — expose it as home so consumers like the project
  // dialog (which searches from home) keep working.
  return { home: directory, cwd: directory, root: directory }
}

function messagesFromV2Response(payload: unknown, url: URL): unknown {
  const segments = url.pathname.split("/").filter(Boolean)
  const sessionID = segments.length >= 2 ? segments[segments.length - 2] : (segments[0] ?? "")
  return messageListFromV2(unwrapData(payload), sessionID)
}

// Prompt responses also drifted: releases answer with the admitted user
// message ({data: User}), newer dev builds with an admitted-input record
// ({data: {id, prompt, timeCreated}}). Map both to the V1 {info, parts}.
function promptResponseFromV1(payload: unknown, url: URL): unknown {
  const segments = url.pathname.split("/").filter(Boolean)
  const sessionID = segments.length >= 2 ? segments[segments.length - 2] : (segments[0] ?? "")
  const raw = (unwrapData(payload) ?? {}) as Dict
  if (!isWrappedPromptV2(url)) {
    const item = messageFromV2(raw, sessionID)
    if (item) return item
  }
  const messageID = str2(raw.id) || `${sessionID}-prompt`
  const created = typeof raw.timeCreated === "number" ? raw.timeCreated : Date.now()
  const text = str2(dict2(raw.prompt).text)
  const info: Dict = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "", modelID: "" },
  }
  const parts: Dict[] = [{
    id: `${messageID}-text`,
    sessionID,
    messageID,
    type: "text",
    text,
    time: { start: created },
  }]
  return { info, parts }
}

type RouteToResult = {
  url: string
  init: RequestInit
  pre?: { url: string; init: RequestInit }
  // v2.0.22 PTY routes 500 when x-opencode-directory is present; routes
  // flagged with this move the directory into the query and drop the header
  // from the outgoing request.
  stripDirectoryHeader?: boolean
}

export type Send = (url: string, init?: RequestInit) => Promise<Response>

type RouteDef = {
  method: string
  pattern: RegExp
  to?: (args: { params: string[]; url: URL; body: unknown; headers?: Headers }) => RouteToResult
  from?: (payload: unknown, input: { url: URL }) => unknown
  respond?: (input: { url: URL; body: unknown }) => { status: number; payload: unknown }
  custom?: (args: { params: string[]; url: URL; body: unknown; send: Send; directory: string }) => Promise<Response>
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function str2(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function dict2(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {}
}

function num2(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

// V1 consumers read the full Model shape (capabilities/cost/limit/status) —
// and some fields feed numeric formatting that crashes on undefined. V2
// model entries carry a different subset, so guarantee the V1-required
// structure with safe defaults while keeping whatever V2 provided.
function modelEntryFromV2(m: Dict, pid: string, mid: string): Dict {
  const merged: Dict = {
    name: mid,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    ...m,
    // Bare model id: the UI sends it back as modelID on /session/:id/model,
    // which the V2 API expects unprefixed (a "pid/mid" id 400s as
    // "Model unavailable: pid/pid/mid").
    id: mid,
    providerID: pid,
    api: { id: mid, url: str2(dict2(m.settings).baseURL), npm: str2(m.package) },
  }
  const cost = dict2(merged.cost)
  merged.cost = {
    input: num2(cost.input),
    output: num2(cost.output),
    cache: { read: num2(dict2(cost.cache).read), write: num2(dict2(cost.cache).write) },
  }
  const limit = dict2(merged.limit)
  merged.limit = { context: num2(limit.context), input: num2(limit.input), output: num2(limit.output) }
  // V2 2.0.x lists variants as an array of {id, settings}; the V1 shape (and
  // the UI's Object.entries over it) expects a map keyed by variant id — an
  // array leaks numeric indexes as variant names ("Variant unavailable: 2").
  const rawVariants = merged.variants
  if (Array.isArray(rawVariants)) {
    const variants: Dict = {}
    for (const item of rawVariants) {
      const entry = dict2(item)
      const id = str2(entry.id)
      if (id) variants[id] = entry
    }
    merged.variants = variants
  }
  return merged
}

// V2 runs the session's STORED agent; sessions migrated from V1 can reference
// plugin agents that V2 builds didn't load ("Agent not found: ..."), and the
// V1 prompt body's agent choice is otherwise dropped. Before prompting,
// switch the session to the requested agent — falling back to "build" when
// the server doesn't know it — so migrated sessions keep working.
async function ensureAgentV2(send: Send, sessionID: string, agent?: string): Promise<void> {
  if (!agent) return
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent }) }
  const res = await send(`/api/session/${sessionID}/agent`, init).catch(() => undefined)
  if (res?.ok) return
  await send(`/api/session/${sessionID}/agent`, { ...init, body: JSON.stringify({ agent: "build" }) }).catch(() => undefined)
}

export async function promptCustom({
  params,
  body,
  url,
  send,
}: {
  params: string[]
  body: unknown
  url: URL
  send: Send
}): Promise<Response> {
  const sessionID = params[0]
  const raw = (body ?? {}) as Dict
  const agent = str2(raw.agent) || undefined
  const { url: promptUrl, init: promptInit, pre } = promptBodyFromV1(body, sessionID, url)
  if (pre) await send(pre.url, pre.init).catch(() => undefined)
  await ensureAgentV2(send, sessionID, agent)
  const res = await send(promptUrl, promptInit)
  if (!res.ok) return res
  const payload = await jsonOf(res)
  return jsonResponse(promptResponseFromV1(payload, url) ?? payload)
}

async function jsonOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

export async function providerListCustom({ send }: { send: Send }): Promise<Response> {
  const [provRes, modelRes, defRes] = await Promise.all([
    send("/api/provider"),
    send("/api/model"),
    send("/api/model/default").catch(() => undefined),
  ])
  if (!provRes.ok) return new Response(provRes.body, { status: provRes.status, headers: provRes.headers })
  const providers = (unwrapData(await jsonOf(provRes)) ?? []) as Dict[]
  const models = modelRes.ok ? ((unwrapData(await jsonOf(modelRes)) ?? []) as Dict[]) : []
  const def = defRes?.ok ? ((unwrapData(await jsonOf(defRes)) ?? {}) as Dict) : {}
  const all = providers.map((p) => {
    const pid = str2(p.id)
    const modelMap: Dict = {}
    for (const m of models) {
      if (str2(m.providerID) !== pid) continue
      const mid = str2(m.modelID) || str2(m.id)
      modelMap[mid] = modelEntryFromV2(m, pid, mid)
    }
    return { id: pid, name: str2(p.name) || pid, source: "custom", env: [], options: {}, models: modelMap }
  })
  // V1 /provider marks providers with credentials as "connected"; the V2
  // model list only contains usable providers, so treat those as connected —
  // an empty connected list makes the UI hide every model.
  const connected = [...new Set(models.map((m) => str2(m.providerID)).filter(Boolean))]
  const body: Dict = { all, connected }
  const defPid = str2(def.providerID)
  if (defPid) body.default = { [defPid]: str2(def.modelID) || str2(def.id) }
  return jsonResponse(body)
}

async function providerAuthCustom({ send }: { send: Send }): Promise<Response> {
  const res = await send("/api/integration")
  const list = res.ok ? ((unwrapData(await jsonOf(res)) ?? []) as Dict[]) : []
  const out: Dict = {}
  for (const item of list) {
    const methods = Array.isArray(item.methods) ? (item.methods as Dict[]) : []
    out[str2(item.id)] = methods.map((m) => ({ type: str2(m.type) === "key" ? "api" : str2(m.type) }))
  }
  return jsonResponse(out)
}

async function authSetCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const providerID = params[0] ?? ""
  const raw = dict2(body)
  const auth = raw.auth ? dict2(raw.auth) : raw
  const base = providerID.split(":")[0]
  const label = providerID.includes(":") ? providerID.split(":").slice(1).join(":") : undefined
  if (str2(auth.type) !== "api") {
    return jsonResponse({ error: "unsupported auth type for V2" }, 400)
  }
  const payload: Dict = { key: str2(auth.key) }
  if (label) payload.label = label
  return send(`/api/integration/${base}/connect/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function permissionFromV2List(payload: unknown): unknown {
  const list = unwrapData(payload)
  if (!Array.isArray(list)) return []
  return list.map((r) => {
    const p = dict2(r)
    return {
      id: str2(p.id),
      sessionID: str2(p.sessionID),
      permission: str2(p.action),
      patterns: Array.isArray(p.resources) ? p.resources : [],
      metadata: dict2(p.metadata),
      always: Array.isArray(p.save) ? p.save : [],
    }
  })
}

async function permissionReplyCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const sessionID = params[0] ?? ""
  const permissionID = params[1] ?? ""
  const response = str2(dict2(body).response) || "once"
  const listRes = await send(`/api/session/${sessionID}/permission`)
  const list = listRes.ok ? ((unwrapData(await jsonOf(listRes)) ?? []) as Dict[]) : []
  const entry = list.find((r) => str2(r.id) === permissionID)
  const payload: Dict = {
    id: permissionID,
    action: str2(entry?.action) || "reply",
    resources: Array.isArray(entry?.resources) ? entry.resources : [],
  }
  if (response === "always") payload.save = ["always"]
  if (response === "reject") payload.metadata = { rejected: true }
  return send(`/api/session/${sessionID}/permission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function questionFromV2List(payload: unknown): unknown {
  const list = unwrapData(payload)
  if (!Array.isArray(list)) return []
  return list.map((f) => {
    const form = dict2(f)
    const fields = Array.isArray(form.fields) ? (form.fields as Dict[]) : []
    const options = fields.flatMap((field) =>
      Array.isArray(field.options)
        ? (field.options as Dict[]).map((o) => ({ label: str2(o.label), description: str2(o.description) || undefined }))
        : [],
    )
    return {
      id: str2(form.id),
      sessionID: str2(form.sessionID),
      questions: [
        {
          question: str2(form.title),
          header: str2(form.title),
          options,
          multiple: fields.some((field) => field.type === "multiselect"),
        },
      ],
    }
  })
}

async function findForm(send: Send, requestID: string): Promise<Dict | undefined> {
  const res = await send("/api/form")
  const list = res.ok ? ((unwrapData(await jsonOf(res)) ?? []) as Dict[]) : []
  return list.find((f) => str2(f.id) === requestID)
}

async function questionReplyCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const requestID = params[0] ?? ""
  const form = await findForm(send, requestID)
  if (!form) return jsonResponse({ error: "form not found" }, 404)
  const sessionID = str2(form.sessionID)
  const fields = Array.isArray(form.fields) ? (form.fields as Dict[]) : []
  const rawAnswers = Array.isArray(dict2(body).answers) ? (dict2(body).answers as unknown[][]) : []
  const answer: Dict = {}
  fields.forEach((field, i) => {
    answer[str2(field.key) || String(i)] = rawAnswers[i] ?? rawAnswers[0] ?? []
  })
  return send(`/api/session/${sessionID}/form/${requestID}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  })
}

async function questionRejectCustom({ params, send }: { params: string[]; send: Send }): Promise<Response> {
  const requestID = params[0] ?? ""
  const form = await findForm(send, requestID)
  if (!form) return jsonResponse({ error: "form not found" }, 404)
  await send(`/api/session/${str2(form.sessionID)}/form/${requestID}`, { method: "DELETE" })
  return jsonResponse(true)
}

const api = (path: string, query: string) => `/api${path}${dropDirectoryQuery(query)}`

const ROUTES: RouteDef[] = [
  {
    method: "GET",
    pattern: /^\/session\/status$/,
    to: ({ url }) => ({ url: api("/session/active", url.search), init: { method: "GET" } }),
    // V2 active is {data: {<sessionID>: {type: "running"}}} — reshape into the
    // V1 status map and translate the only V2 state to V1's "busy".
    from: (payload) => {
      const data = unwrapData(payload)
      if (!data || typeof data !== "object" || Array.isArray(data)) return {}
      const out: Dict = {}
      for (const [sessionID, entry] of Object.entries(data as Dict)) {
        out[sessionID] = str2(dict2(entry).type) === "running" ? { type: "busy" } : entry
      }
      return out
    },
  },
  {
    method: "GET",
    pattern: /^\/session$/,
    custom: async ({ url, send }) => {
      // V2 pages its global session list (default 50) and ignores directory
      // filters, so follow cursor.next until the list is exhausted - the
      // caller filters by directory client-side like it did against V1.
      const requested = Number(new URL(url).searchParams.get("limit"))
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 200
      const sessions: Dict[] = []
      let cursor: string | undefined
      for (let page = 0; page < 100; page++) {
        const params = new URLSearchParams({ limit: String(limit) })
        if (cursor) params.set("cursor", cursor)
        const res = await send(`/api/session?${params.toString()}`)
        if (!res.ok) return res
        const payload = (await res.json().catch(() => undefined)) as { cursor?: { next?: unknown } } | undefined
        const data = unwrapData(payload)
        if (!Array.isArray(data)) return Response.json([], { status: 502 })
        sessions.push(...(data as Dict[]))
        const next = payload?.cursor?.next
        cursor = typeof next === "string" ? next : undefined
        if (!cursor) break
      }
      return Response.json(sessions.map(sessionFromV2))
    },
  },
  {
    method: "POST",
    pattern: /^\/session$/,
    to: ({ body }) => {
      const raw = (body ?? {}) as Dict
      const out: Dict = {}
      if (typeof raw.parentID === "string") out.parentID = raw.parentID
      if (typeof raw.title === "string") out.title = raw.title
      return { url: "/api/session", init: jsonInit("POST", "", out) }
    },
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/message$/,
    to: ({ url, params }) => ({ url: `/api/session/${params[0]}/message${pagedQuery(url.search)}`, init: { method: "GET" } }),
    from: (payload, { url }) => messagesFromV2Response(payload, url),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/prompt_async$/,
    custom: ({ params, body, url, send }) => promptCustom({ params, body, url, send }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/prompt$/,
    custom: ({ params, body, url, send }) => promptCustom({ params, body, url, send }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/abort$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}/interrupt`, ""), init: jsonInit("POST", "", {}) }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/summarize$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/compact`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/command$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/command`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/unrevert$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}/revert`, ""), init: { method: "DELETE" } }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/revert$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/revert/commit`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/diff$/,
    to: ({ url, params }) => ({ url: api(`/session/${params[0]}/diff`, url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}`, ""), init: { method: "GET" } }),
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "PATCH",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params, body }) => {
      const raw = (body ?? {}) as Dict
      const out: Dict = {}
      if (typeof raw.title === "string") out.title = raw.title
      return { url: api(`/session/${params[0]}`, ""), init: jsonInit("PATCH", "", out) }
    },
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "DELETE",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}`, ""), init: { method: "DELETE" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/config$/,
    respond: () => ({ status: 200, payload: {} }),
    to: () => ({ url: "", init: {} }),
  },
  {
    method: "GET",
    pattern: /^\/path$/,
    to: ({ url }) => ({ url: api("/location", url.search), init: { method: "GET" } }),
    from: locationFromV2,
  },
  {
    method: "GET",
    pattern: /^\/agent$/,
    to: ({ url }) => ({ url: api("/agent", url.search), init: { method: "GET" } }),
    // V1 agents are identified by their name field; V2 entries split id
    // ("build") from display name ("Build"). Copy the id into name so the
    // UI's selected agent value is the id the V2 API expects — sending the
    // display name fails with "Agent not found".
    from: (payload) => {
      const data = unwrapData(payload)
      if (!Array.isArray(data)) return data
      return data.map((entry) => {
        const a = dict2(entry)
        return { ...a, name: str2(a.id) || str2(a.name) }
      })
    },
  },
  {
    method: "GET",
    pattern: /^\/skill$/,
    to: ({ url }) => ({ url: api("/skill", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/file\/content$/,
    to: ({ url }) => {
      const path = url.searchParams.get("path") ?? ""
      return { url: `/api/fs/read${path}?${dropDirectoryQuery(url.search)}`, init: { method: "GET" } }
    },
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/file$/,
    custom: ({ url, send, directory }) => fileListCustom({ url, send, directory }),
  },
  {
    method: "GET",
    pattern: /^\/find\/file$/,
    to: ({ url }) => {
      const params = new URLSearchParams(url.search)
      params.delete("directory")
      const pattern = params.get("pattern") ?? ""
      params.delete("pattern")
      params.set("query", pattern)
      return { url: `/api/fs/find?${params.toString()}`, init: { method: "GET" } }
    },
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/vcs$/,
    to: ({ url }) => ({ url: api("/vcs", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/vcs\/diff$/,
    to: ({ url }) => ({ url: api("/vcs/diff", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    // v2.0.22 PTY routes 500 whenever x-opencode-directory is sent — move the
    // directory into the query (which they accept) and strip the header.
    method: "GET",
    pattern: /^\/pty$/,
    to: ({ url, headers }) => {
      const search = new URLSearchParams(url.search)
      const directory = headers?.get("x-opencode-directory") ?? search.get("directory")
      if (directory) search.set("directory", directory)
      return { url: `/api/pty?${search.toString()}`, init: { method: "GET" }, stripDirectoryHeader: true }
    },
    from: unwrapData,
  },
  {
    method: "POST",
    pattern: /^\/pty$/,
    to: ({ url, body, headers }) => {
      const search = new URLSearchParams(url.search)
      const directory = headers?.get("x-opencode-directory") ?? search.get("directory")
      if (directory) search.set("directory", directory)
      return {
        url: `/api/pty?${search.toString()}`,
        init: jsonInit("POST", "", body ?? {}),
        stripDirectoryHeader: true,
      }
    },
    from: unwrapData,
  },
  {
    method: "PUT",
    pattern: /^\/pty\/([^/]+)$/,
    to: ({ url, params, body, headers }) => {
      const search = new URLSearchParams(url.search)
      const directory = headers?.get("x-opencode-directory") ?? search.get("directory")
      if (directory) search.set("directory", directory)
      return {
        url: `/api/pty/${params[0]}?${search.toString()}`,
        init: jsonInit("PUT", "", body ?? {}),
        stripDirectoryHeader: true,
      }
    },
  },
  {
    method: "DELETE",
    pattern: /^\/pty\/([^/]+)$/,
    to: ({ url, params, headers }) => {
      const search = new URLSearchParams(url.search)
      const directory = headers?.get("x-opencode-directory") ?? search.get("directory")
      if (directory) search.set("directory", directory)
      return {
        url: `/api/pty/${params[0]}?${search.toString()}`,
        init: { method: "DELETE" },
        stripDirectoryHeader: true,
      }
    },
  },
  {
    method: "GET",
    pattern: /^\/pty\/([^/]+)\/connect$/,
    to: ({ url, params }) => ({ url: api(`/pty/${params[0]}/connect`, url.search), init: { method: "GET" } }),
  },
  {
    method: "GET",
    pattern: /^\/mcp$/,
    to: ({ url }) => ({ url: api("/mcp", url.search), init: { method: "GET" } }),
    from: (payload) => {
      const data = unwrapData(payload)
      if (!Array.isArray(data)) return data ?? {}
      return Object.fromEntries(data.map((entry) => [str2(dict2(entry).name), entry]))
    },
  },
  {
    method: "POST",
    pattern: /^\/mcp\/([^/]+)\/(connect|disconnect)$/,
    to: ({ params }) => ({
      url: api(`/experimental/mcp/${params[0]}/${params[1]}`, ""),
      init: jsonInit("POST", "", {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/share$/,
    respond: () => ({ status: 400, payload: { message: "Session sharing is not available on opencode v2" } }),
    to: () => ({ url: "", init: {} }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/unshare$/,
    respond: () => ({ status: 400, payload: { message: "Session sharing is not available on opencode v2" } }),
    to: () => ({ url: "", init: {} }),
  },
  {
    method: "POST",
    pattern: /^\/instance\/dispose$/,
    respond: () => ({ status: 200, payload: { ok: true } }),
    to: () => ({ url: "", init: {} }),
  },
  {
    method: "GET",
    pattern: /^\/provider$/,
    custom: providerListCustom,
    to: () => ({ url: "/api/provider", init: { method: "GET" } }),
  },
  {
    method: "GET",
    pattern: /^\/provider\/auth$/,
    custom: ({ send }) => providerAuthCustom({ send }),
    to: () => ({ url: "/api/integration", init: { method: "GET" } }),
  },
  {
    method: "PUT",
    pattern: /^\/auth\/(.+)$/,
    custom: ({ params, body, send }) => authSetCustom({ params, body, send }),
    to: ({ params }) => ({ url: `/api/credential/${params[0]}`, init: { method: "PATCH" } }),
  },
  {
    method: "DELETE",
    pattern: /^\/auth\/(.+)$/,
    to: ({ params }) => ({ url: `/api/credential/${params[0]}`, init: { method: "DELETE" } }),
    from: () => true,
  },
  {
    method: "GET",
    pattern: /^\/permission$/,
    to: ({ url }) => ({ url: api("/permission/request", url.search), init: { method: "GET" } }),
    from: permissionFromV2List,
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/permissions\/([^/]+)$/,
    custom: ({ params, body, send }) => permissionReplyCustom({ params, body, send }),
    to: ({ params }) => ({
      url: api(`/session/${params[0]}/permission`, ""),
      init: jsonInit("POST", "", { id: params[1] }),
    }),
  },
  {
    method: "GET",
    pattern: /^\/question$/,
    to: ({ url }) => ({ url: api("/form", url.search), init: { method: "GET" } }),
    from: questionFromV2List,
  },
  {
    method: "POST",
    pattern: /^\/question\/([^/]+)\/reply$/,
    custom: ({ params, body, send }) => questionReplyCustom({ params, body, send }),
    to: ({ params }) => ({ url: api(`/form/${params[0]}`, ""), init: jsonInit("POST", "", {}) }),
  },
  {
    method: "POST",
    pattern: /^\/question\/([^/]+)\/reject$/,
    custom: ({ params, send }) => questionRejectCustom({ params, send }),
    to: ({ params }) => ({ url: api(`/form/${params[0]}`, ""), init: { method: "DELETE" } }),
  },
  {
    method: "POST",
    pattern: /^\/config$/,
    to: ({ body }) => ({
      url: "/api/experimental/config",
      init: jsonInit("PATCH", "", { shell: dict2(dict2(body).config).shell ?? null }),
    }),
  },
  {
    method: "POST",
    pattern: /^\/mcp$/,
    to: ({ body }) => {
      const raw = dict2(body)
      return { url: `/api/experimental/mcp/${str2(raw.name)}`, init: jsonInit("PUT", "", raw.config ?? {}) }
    },
    from: () => true,
  },
]

function matchRoute(method: string, pathname: string): { def: RouteDef; params: string[] } | undefined {
  for (const def of ROUTES) {
    if (def.method !== method) continue
    const match = def.pattern.exec(pathname)
    if (match) return { def, params: match.slice(1) }
  }
  return undefined
}

export type V2RequestResult =
  | { kind: "passthrough" }
  | { kind: "local"; status: number; payload: unknown }
  | { kind: "custom"; run: (send: Send) => Promise<Response> }
  | {
      kind: "rewrite"
      url: string
      init: RequestInit
      pre?: { url: string; init: RequestInit }
      from?: RouteDef["from"]
      input: { url: URL }
      stripDirectoryHeader?: boolean
    }

export async function planV2Request(request: Request): Promise<V2RequestResult> {
  const url = new URL(request.url)
  const match = matchRoute(request.method, url.pathname)
  if (!match) return { kind: "passthrough" }
  const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await parseBody(request) : undefined
  const input = { url, body }
  if (match.def.respond) {
    const local = match.def.respond(input)
    return { kind: "local", status: local.status, payload: local.payload }
  }
  if (match.def.custom) {
    const def = match.def
    const params = match.params
    const headerDir = request.headers.get("x-opencode-directory")
    const directory = headerDir ? safeDecode(headerDir) : url.searchParams.get("directory") || ""
    return { kind: "custom", run: (send) => def.custom!({ params, url, body, send, directory }) }
  }
  if (!match.def.to) return { kind: "passthrough" }
  const target = match.def.to({ params: match.params, url, body, headers: request.headers })
  return {
    kind: "rewrite",
    url: target.url,
    init: { ...target.init, headers: { ...(target.init.headers ?? {}) } },
    pre: target.pre,
    from: match.def.from,
    input: { url },
    stripDirectoryHeader: target.stripDirectoryHeader,
  }
}

export async function applyV2Response(plan: V2RequestResult, response: Response): Promise<Response> {
  if (plan.kind !== "rewrite" || !plan.from || !response.ok) return response
  const payload = await response.clone().json().catch(() => undefined)
  if (payload === undefined) return response
  const mapped = plan.from(payload, plan.input)
  return new Response(JSON.stringify(mapped), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
