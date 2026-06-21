import { beforeEach, expect, test } from "bun:test"
import { hydrateSoundSettingsFromDb, readSoundSettings, SOUND_STORAGE_KEY, writeSoundSettings, type SoundSettings } from "./sound"

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length() {
    return this.map.size
  }

  clear() {
    this.map.clear()
  }

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.map.delete(key)
  }

  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

function setupWindow() {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, "window", {
    value: {
      __OPENCODE__: { serverUrl: "http://127.0.0.1:4096" },
      localStorage: storage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  setupWindow()
})

test("writes sound settings to localStorage and the ui namespace", () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init: RequestInit }> = []

  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init: init || {} })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch

  try {
    const settings: SoundSettings = { enabled: true, sound: "gentle" }
    writeSoundSettings(settings)

    expect(JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) || "{}" )).toEqual(settings)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain("/api/ext/settings")
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ ns: "ui", key: "soundSettings", value: settings })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("hydrates sound settings from the db when present", async () => {
  const originalFetch = globalThis.fetch
  const stored: SoundSettings = { enabled: true, sound: "duo" }

  globalThis.fetch = (async (input) => {
    if (String(input).includes("/api/ext/settings?ns=ui")) {
      return new Response(JSON.stringify({ soundSettings: stored }), { status: 200, headers: { "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch

  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify({ enabled: false, sound: "alert" }))

    const resolved = await hydrateSoundSettingsFromDb()
    expect(resolved).toEqual(stored)
    expect(readSoundSettings()).toEqual(stored)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("backfills the db from local sound settings when the db is empty", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init: RequestInit }> = []
  const stored: SoundSettings = { enabled: true, sound: "ping" }

  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init: init || {} })

    if (String(input).includes("/api/ext/settings?ns=ui")) {
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch

  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(stored))

    const resolved = await hydrateSoundSettingsFromDb()
    expect(resolved).toEqual(stored)
    expect(requests).toHaveLength(2)
    expect(JSON.parse(String(requests[1].init.body))).toEqual({ ns: "ui", key: "soundSettings", value: stored })
  } finally {
    globalThis.fetch = originalFetch
  }
})
