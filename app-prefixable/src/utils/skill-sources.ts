import type { Config } from "../sdk/client"

export type SkillSourceKind = "path" | "url"

export type SkillSource = {
  kind: SkillSourceKind
  value: string
}

export type DisabledSkillSource = SkillSource & {
  hiddenPath?: string
}

export function normalizeSkillSource(source: SkillSource): SkillSource | null {
  const value = source.value.trim()
  if (!value) return null

  if (source.kind === "url") {
    try {
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:") return null
      url.hash = ""
      url.pathname = url.pathname.replace(/\/+$/, "") || "/"
      return { kind: "url", value: url.toString().replace(/\/$/, "") }
    } catch {
      return null
    }
  }

  return { kind: "path", value }
}

export function skillSourceKey(source: SkillSource): string {
  return `${source.kind}:${source.value}`
}

export function compareSkillSources(a: SkillSource, b: SkillSource): number {
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
  return a.value.localeCompare(b.value)
}

export function uniqueSkillSources(sources: SkillSource[]): SkillSource[] {
  const seen = new Set<string>()
  const result: SkillSource[] = []
  for (const source of sources) {
    const normalized = normalizeSkillSource(source)
    if (!normalized) continue
    const key = skillSourceKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result.sort(compareSkillSources)
}

export function getSkillSources(config?: Config): SkillSource[] {
  const skills = config?.skills
  return uniqueSkillSources([
    ...(skills?.paths ?? []).map((value) => ({ kind: "path" as const, value })),
    ...(skills?.urls ?? []).map((value) => ({ kind: "url" as const, value })),
  ])
}

export function setSkillSources(config: Config, sources: SkillSource[]): Config {
  const next = uniqueSkillSources(sources)
  return {
    ...config,
    skills: {
      paths: next.filter((source) => source.kind === "path").map((source) => source.value),
      urls: next.filter((source) => source.kind === "url").map((source) => source.value),
    },
  }
}

export function addSkillSource(config: Config, source: SkillSource): Config {
  return setSkillSources(config, [...getSkillSources(config), source])
}

export function removeSkillSource(config: Config, source: SkillSource): Config {
  const key = skillSourceKey(normalizeSkillSource(source) ?? source)
  return setSkillSources(config, getSkillSources(config).filter((item) => skillSourceKey(item) !== key))
}

function pathSeparator(value: string): string {
  return value.includes("\\") && !value.includes("/") ? "\\" : "/"
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "")
}

function baseName(value: string): string {
  const clean = trimTrailingSeparators(value)
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] || clean
}

function dirName(value: string): string {
  const clean = trimTrailingSeparators(value)
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"))
  if (index <= 0) return clean.startsWith("/") ? "/" : ""
  return clean.slice(0, index)
}

function joinPath(left: string, right: string): string {
  const sep = pathSeparator(left || right)
  const a = trimTrailingSeparators(left)
  const b = right.replace(/^[\\/]+/, "")
  if (!a) return b
  return `${a}${sep}${b}`
}

function hash(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h) ^ value.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

export function buildDisabledSkillPath(sourcePath: string): string {
  const parent = dirName(sourcePath)
  const hidden = joinPath(parent, ".prokube-disabled-skills")
  return joinPath(hidden, `${baseName(sourcePath)}-${hash(sourcePath)}`)
}

export function disabledSkillStoragePrefix(serverKey: string, scope: "global" | "project"): string {
  return `prokube.disabled-skill-sources:${serverKey}:${scope}:`
}

export function disabledSkillStorageKey(serverKey: string, scope: "global" | "project", directory?: string): string {
  return `${disabledSkillStoragePrefix(serverKey, scope)}${scope === "global" ? "global" : directory || "global"}`
}

function disabledSkillStorageKeys(serverKey: string, scope: "global" | "project", directory?: string): string[] {
  if (scope === "project") return [disabledSkillStorageKey(serverKey, scope, directory)]

  const prefix = disabledSkillStoragePrefix(serverKey, scope)
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }

  const shared = disabledSkillStorageKey(serverKey, scope)
  if (!keys.includes(shared)) keys.push(shared)
  return keys
}

function migrateDisabledSkillSources(serverKey: string, scope: "global" | "project", directory?: string): DisabledSkillSource[] {
  const keys = disabledSkillStorageKeys(serverKey, scope, directory)
  if (scope === "project") return readDisabledSkillSources(keys[0])

  const shared = disabledSkillStorageKey(serverKey, scope)
  const merged = uniqueDisabledSkillSources(keys.flatMap((key) => readDisabledSkillSources(key)))
  writeDisabledSkillSources(shared, merged)
  for (const key of keys) {
    if (key !== shared) localStorage.removeItem(key)
  }
  return merged
}

export function readDisabledSkillSourcesForScope(serverKey: string, scope: "global" | "project", directory?: string): DisabledSkillSource[] {
  return migrateDisabledSkillSources(serverKey, scope, directory)
}

export function writeDisabledSkillSourcesForScope(serverKey: string, scope: "global" | "project", sources: DisabledSkillSource[], directory?: string): void {
  writeDisabledSkillSources(disabledSkillStorageKey(serverKey, scope, directory), sources)
}

export function readDisabledSkillSources(storageKey: string): DisabledSkillSource[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const result: DisabledSkillSource[] = []
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue
      const entry = item as Record<string, unknown>
      const kind = entry.kind
      const value = entry.value
      const hiddenPath = typeof entry.hiddenPath === "string" ? entry.hiddenPath : undefined
      if ((kind === "path" || kind === "url") && typeof value === "string" && value.trim()) {
        const normalized = normalizeSkillSource({ kind, value })
        if (normalized) result.push({ ...normalized, hiddenPath })
      }
    }
    return uniqueDisabledSkillSources(result)
  } catch {
    return []
  }
}

export function writeDisabledSkillSources(storageKey: string, sources: DisabledSkillSource[]): void {
  localStorage.setItem(storageKey, JSON.stringify(uniqueDisabledSkillSources(sources)))
}

export function uniqueDisabledSkillSources(sources: DisabledSkillSource[]): DisabledSkillSource[] {
  const seen = new Set<string>()
  const result: DisabledSkillSource[] = []
  for (const source of sources) {
    const normalized = normalizeSkillSource(source)
    if (!normalized) continue
    const key = skillSourceKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...normalized, hiddenPath: source.hiddenPath })
  }
  return result.sort(compareSkillSources)
}
