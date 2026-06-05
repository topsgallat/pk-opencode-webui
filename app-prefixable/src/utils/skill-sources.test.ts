import { expect, test } from "bun:test"
import type { Config } from "../sdk/client"
import { beforeEach } from "bun:test"
import {
  addSkillSource,
  buildDisabledSkillPath,
  disabledSkillStorageKey,
  readDisabledSkillSourcesForScope,
  getSkillSources,
  removeSkillSource,
  skillSourceKey,
  uniqueSkillSources,
  writeDisabledSkillSourcesForScope,
} from "./skill-sources"

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

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
})

test("collects and sorts custom skill sources", () => {
  const config: Config = {
    skills: {
      paths: ["/b", "/a", "/a"],
      urls: ["https://example.com/.well-known/skills/", "https://example.com/.well-known/skills/"],
    },
  }

  expect(getSkillSources(config)).toEqual([
    { kind: "path", value: "/a" },
    { kind: "path", value: "/b" },
    { kind: "url", value: "https://example.com/.well-known/skills" },
  ])
})

test("adds and removes skill sources from config", () => {
  const config: Config = {}
  const next = addSkillSource(config, { kind: "path", value: "/skills/custom" })
  expect(next.skills?.paths).toEqual(["/skills/custom"])

  const removed = removeSkillSource(next, { kind: "path", value: "/skills/custom" })
  expect(removed.skills?.paths).toEqual([])
})

test("builds a hidden disabled path for local sources", () => {
  expect(buildDisabledSkillPath("/home/user/skills/custom")).toMatch(/\.prokube-disabled-skills\/custom-/)
})

test("unique sources preserve kind and value", () => {
  expect(uniqueSkillSources([
    { kind: "path", value: "/skills/a" },
    { kind: "path", value: "/skills/a" },
    { kind: "url", value: "https://example.com/.well-known/skills" },
  ]).map(skillSourceKey)).toEqual([
    "path:/skills/a",
    "url:https://example.com/.well-known/skills",
  ])
})

test("global disabled skill storage is shared across directories", () => {
  const serverKey = "http://127.0.0.1:4096"
  const globalKey = disabledSkillStorageKey(serverKey, "global")
  const projectKey = disabledSkillStorageKey(serverKey, "project", "/test")

  writeDisabledSkillSourcesForScope(serverKey, "global", [{ kind: "path", value: "/home/user/.config/opencode/skills/a", hiddenPath: "/tmp/a" }], "/home/user")
  writeDisabledSkillSourcesForScope(serverKey, "project", [{ kind: "path", value: "/test/.config/opencode/skills/b", hiddenPath: "/tmp/b" }], "/test")

  expect(readDisabledSkillSourcesForScope(serverKey, "global", "/test")).toEqual([
    { kind: "path", value: "/home/user/.config/opencode/skills/a", hiddenPath: "/tmp/a" },
  ])
  expect(readDisabledSkillSourcesForScope(serverKey, "project", "/test")).toEqual([
    { kind: "path", value: "/test/.config/opencode/skills/b", hiddenPath: "/tmp/b" },
  ])
  expect(localStorage.getItem(globalKey)).toContain("/home/user/.config/opencode/skills/a")
  expect(localStorage.getItem(projectKey)).toContain("/test/.config/opencode/skills/b")
})
