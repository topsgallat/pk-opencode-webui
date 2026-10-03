import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { __resetPromptQueueForTests, __runWorkerPassForTests, handlePromptQueueEndpoint } from "./prompt-queue"
import { __resetSettingsStoreForTests } from "./settings-store"

const realFetch = globalThis.fetch

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>

function mockFetch(fn: FetchMock): string[] {
  const calls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push(`${init?.method ?? "GET"} ${url}`)
    return fn(url, init)
  }) as typeof fetch
  return calls
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

function endpointReq(path: string, method: string, body?: unknown): Request {
  const target = "http://ui.example" + path
  return new Request(target, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function queueItem(id: string, text = `hello ${id}`) {
  return {
    id,
    createdAt: 1000,
    text,
    parts: [{ type: "text", text }],
    agent: "build",
  }
}

async function setupTempStore() {
  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-prompt-queue-"))
  __resetSettingsStoreForTests(nodePath.join(dir, "settings.db"))
  return dir
}

afterEach(() => {
  globalThis.fetch = realFetch
  __resetPromptQueueForTests()
})

test("enqueue lists the item and returns it from GET", async () => {
  await setupTempStore()
  mockFetch(() => Promise.resolve(jsonResponse({})))

  const post = await handlePromptQueueEndpoint(
    "/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"),
    endpointReq("/api/ext/prompt-queue/ses_1", "POST", queueItem("a")),
    { defaultTarget: "http://fallback:4096" },
  )
  expect(post?.status).toBe(200)
  const posted = await post!.json() as { items: Array<{ id: string; status: string }> }
  expect(posted.items.map((item) => item.id)).toEqual(["a"])

  const get = await handlePromptQueueEndpoint(
    "/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://upstream"),
    endpointReq("/api/ext/prompt-queue/ses_1", "GET"),
    { defaultTarget: "http://fallback:4096" },
  )
  const listed = await get!.json() as { items: Array<{ id: string }> }
  expect(listed.items.map((item) => item.id)).toEqual(["a"])
})

test("queues are scoped per target and per session", async () => {
  await setupTempStore()
  mockFetch((url) => {
    if (url.endsWith("/session/status")) return Promise.resolve(jsonResponse({ ses_1: { type: "busy" }, ses_2: { type: "busy" } }))
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://a"), endpointReq("/x", "POST", queueItem("a1")))
  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://b"), endpointReq("/x", "POST", queueItem("b1")))
  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_2", "POST", new URL("http://ui/?target=http://a"), endpointReq("/x", "POST", queueItem("a2")))

  const a1 = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://a"), endpointReq("/x", "GET")))!.json() as { items: Array<{ id: string }> }
  expect(a1.items.map((i) => i.id)).toEqual(["a1"])
  const a2 = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_2", "GET", new URL("http://ui/?target=http://a"), endpointReq("/x", "GET")))!.json() as { items: Array<{ id: string }> }
  expect(a2.items.map((i) => i.id)).toEqual(["a2"])
})

test("rejects enqueue without id or parts", async () => {
  await setupTempStore()
  mockFetch(() => Promise.resolve(jsonResponse({})))

  const noId = await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/"), endpointReq("/x", "POST", { text: "hi", parts: [] }))
  expect(noId?.status).toBe(400)

  const noParts = await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/"), endpointReq("/x", "POST", { id: "a", text: "hi" }))
  expect(noParts?.status).toBe(400)
})

test("worker sends the head prompt when the session is idle (v1)", async () => {
  await setupTempStore()
  const calls: string[] = []
  const bodies: Array<Record<string, unknown>> = []
  mockFetch((url, init) => {
    calls.push(url)
    if (url.endsWith("/global/health")) return Promise.resolve(jsonResponse({ healthy: true }))
    if (url.endsWith("/session/status")) {
      return Promise.resolve(jsonResponse({ ses_1: { type: "idle" } }))
    }
    if (url.endsWith("/session/ses_1/prompt_async")) {
      bodies.push((init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown>)
      return Promise.resolve(jsonResponse({}))
    }
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  // POST kicks a pass immediately
  await new Promise((resolve) => setTimeout(resolve, 20))
  await __runWorkerPassForTests()

  expect(calls.some((url) => url.endsWith("/session/ses_1/prompt_async"))).toBe(true)
  // opencode rejects client-supplied message ids that aren't msg_* shaped
  expect(bodies[0].messageID).toBeUndefined()
  expect(bodies[0].parts).toEqual([{ type: "text", text: "hello a" }])
  const after = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "GET")))!.json() as { items: unknown[] }
  expect(after.items).toEqual([])
})

test("worker holds the prompt while the session is busy", async () => {
  await setupTempStore()
  const calls: string[] = []
  mockFetch((url) => {
    calls.push(url)
    if (url.endsWith("/global/health")) return Promise.resolve(jsonResponse({ healthy: true }))
    if (url.endsWith("/session/status")) return Promise.resolve(jsonResponse({ ses_1: { type: "busy" } }))
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  await new Promise((resolve) => setTimeout(resolve, 20))
  await __runWorkerPassForTests()

  expect(calls.some((url) => url.endsWith("/prompt_async"))).toBe(false)
  const after = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "GET")))!.json() as { items: Array<{ id: string }> }
  expect(after.items.map((i) => i.id)).toEqual(["a"])
})

test("worker marks the item failed after repeated send errors", async () => {
  await setupTempStore()
  mockFetch((url) => {
    if (url.endsWith("/global/health")) return Promise.resolve(jsonResponse({ healthy: true }))
    if (url.endsWith("/session/status")) return Promise.resolve(jsonResponse({ ses_1: { type: "idle" } }))
    if (url.endsWith("/prompt_async")) return Promise.resolve(new Response("boom", { status: 500 }))
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  await new Promise((resolve) => setTimeout(resolve, 20))
  await __runWorkerPassForTests()
  await __runWorkerPassForTests()
  await __runWorkerPassForTests()

  const after = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "GET")))!.json() as { items: Array<{ id: string; status: string; attempts: number }> }
  expect(after.items.length).toBe(1)
  expect(after.items[0].status).toBe("failed")
  expect(after.items[0].attempts).toBeGreaterThanOrEqual(3)
})

test("worker sends v2-shaped requests against a v2 upstream", async () => {
  await setupTempStore()
  const bodies: Array<{ url: string; body: unknown }> = []
  mockFetch((url, init) => {
    if (url.endsWith("/global/health")) return Promise.resolve(jsonResponse({}, 404))
    if (url.endsWith("/api/info")) return Promise.resolve(jsonResponse({ version: "2.0.0" }))
    if (url.endsWith("/api/session/active")) return Promise.resolve(jsonResponse({ data: [] }))
    bodies.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  await new Promise((resolve) => setTimeout(resolve, 20))
  await __runWorkerPassForTests()

  const prompt = bodies.find((entry) => entry.url.endsWith("/api/session/ses_1/prompt"))
  expect(prompt).toBeDefined()
  expect(prompt!.body).toEqual({ text: "hello a", files: [] })
})

test("delete removes a single queued item", async () => {
  await setupTempStore()
  mockFetch(() => Promise.resolve(jsonResponse({})))

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("b")))

  const res = await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1/a", "DELETE", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "DELETE"))
  const after = await res!.json() as { items: Array<{ id: string }> }
  expect(after.items.map((i) => i.id)).toEqual(["b"])
})

test("queued items survive a module reset via the settings store", async () => {
  await setupTempStore()
  mockFetch((url) => {
    if (url.endsWith("/global/health")) return Promise.resolve(jsonResponse({ healthy: true }))
    if (url.endsWith("/session/status")) return Promise.resolve(jsonResponse({ ses_1: { type: "busy" } }))
    return Promise.resolve(jsonResponse({}))
  })

  await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "POST", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "POST", queueItem("a")))
  __resetPromptQueueForTests()

  const after = await (await handlePromptQueueEndpoint("/api/ext/prompt-queue/ses_1", "GET", new URL("http://ui/?target=http://upstream"), endpointReq("/x", "GET")))!.json() as { items: Array<{ id: string }> }
  expect(after.items.map((i) => i.id)).toEqual(["a"])
})

test("non-matching paths return undefined so the proxy continues", async () => {
  const res = await handlePromptQueueEndpoint("/api/session", "GET", new URL("http://ui/"), endpointReq("/api/session", "GET"))
  expect(res).toBeUndefined()
})
