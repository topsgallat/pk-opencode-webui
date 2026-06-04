import { createEffect, createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { Check, Folder, Link2, RefreshCw } from "lucide-solid"
import { Button } from "./ui/button"
import { useSDK } from "../context/sdk"
import { useServer } from "../context/server"
import { getServerKey } from "../utils/servers"
import { mkdir, moveItem } from "../utils/extended-api"
import { appendTargetParam } from "../utils/path"
import {
  buildDisabledSkillPath,
  disabledSkillStorageKey,
  readDisabledSkillSources,
  skillSourceKey,
  type DisabledSkillSource,
  type SkillSource,
  uniqueDisabledSkillSources,
  writeDisabledSkillSources,
} from "../utils/skill-sources"
import { isLocallyManagedSkill, skillSourcePathFromLocation } from "../utils/skill-discovery"

type Scope = "global" | "project"

type Skill = {
  name: string
  description: string
  location: string
  content: string
}

type SkillView = Skill & {
  scope: Scope
  sourcePath: string | null
  disabled: boolean
  hiddenPath?: string
}

function baseName(value: string): string {
  const clean = value.replace(/[\\/]+$/, "")
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] || clean
}

function sourceLabel(source: SkillView): string {
  if (source.sourcePath) return "Local folder source"
  return source.location.startsWith("http") ? "Remote URL source" : "Built-in or generated source"
}

function sourceIcon(source: SkillView) {
  return source.sourcePath ? <Folder class="w-3.5 h-3.5" /> : <Link2 class="w-3.5 h-3.5" />
}

export function SkillSourcesTab() {
  const { global, directory, url: serverUrl, targetUrl } = useSDK()
  const server = useServer()
  const serverKey = createMemo(() => getServerKey(server.selectedServer() ?? { url: serverUrl }))
  const [loading, setLoading] = createSignal(true)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  const [savingKey, setSavingKey] = createSignal<string | null>(null)
  const [active, setActive] = createSignal<Record<Scope, Skill[]>>({ global: [], project: [] })
  const [disabled, setDisabled] = createSignal<Record<Scope, DisabledSkillSource[]>>({ global: [], project: [] })

  function storageKey(scope: Scope) {
    return disabledSkillStorageKey(serverKey(), scope, directory)
  }

  function loadDisabled() {
    setDisabled({
      global: readDisabledSkillSources(storageKey("global")),
      project: readDisabledSkillSources(storageKey("project")),
    })
  }

  function writeDisabled(scope: Scope, next: DisabledSkillSource[]) {
    const unique = uniqueDisabledSkillSources(next)
    setDisabled((current) => ({ ...current, [scope]: unique }))
    writeDisabledSkillSources(storageKey(scope), unique)
  }

  function showSaved() {
    setSaveError(null)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  async function refresh() {
    setLoading(true)
    setSaveError(null)
    try {
      const stamp = Date.now().toString(36)
      const [globalRes, projectRes] = await Promise.all([
        fetch(appendTargetParam(`${serverUrl}/skill?_=${stamp}`, targetUrl), { cache: "no-store" }).then((res) => res.ok ? res.json() : []).catch(() => []),
        directory
          ? fetch(appendTargetParam(`${serverUrl}/skill?directory=${encodeURIComponent(directory)}&_= ${stamp}`.replace("&_= ", "&_="), targetUrl), { cache: "no-store" }).then((res) => res.ok ? res.json() : []).catch(() => [])
          : Promise.resolve([]),
      ])

      setActive({
        global: globalRes as Skill[],
        project: projectRes as Skill[],
      })
      loadDisabled()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    refresh()
    const handleStorage = (e: StorageEvent) => {
      if (!e.key?.startsWith("prokube.disabled-skill-sources:")) return
      loadDisabled()
    }
    window.addEventListener("storage", handleStorage)
    onCleanup(() => window.removeEventListener("storage", handleStorage))
  })

  createEffect(() => {
    const activeGlobal = new Set(active().global.map((skill) => skillSourceKey({ kind: "path", value: skillSourcePathFromLocation(skill.location) ?? skill.location })))
    const activeProject = new Set(active().project.map((skill) => skillSourceKey({ kind: "path", value: skillSourcePathFromLocation(skill.location) ?? skill.location })))

    const nextGlobal = disabled().global.filter((item) => !activeGlobal.has(skillSourceKey(item)))
    const nextProject = disabled().project.filter((item) => !activeProject.has(skillSourceKey(item)))
    if (nextGlobal.length !== disabled().global.length) writeDisabled("global", nextGlobal)
    if (nextProject.length !== disabled().project.length) writeDisabled("project", nextProject)
  })

  function views(scope: Scope): SkillView[] {
    const list = active()[scope]
    const disabledList = disabled()[scope]
    const disabledKeys = new Set(disabledList.map((item) => skillSourceKey(item)))

    const activeViews = list.map((skill) => {
        const sourcePath = skillSourcePathFromLocation(skill.location)
        const key = sourcePath ? skillSourceKey({ kind: "path", value: sourcePath }) : skillSourceKey({ kind: "url", value: skill.location })
        const hiddenPath = disabledList.find((item) => skillSourceKey(item) === key)?.hiddenPath
        return { ...skill, scope, sourcePath, disabled: disabledKeys.has(key), hiddenPath }
      })

    const activeKeys = new Set(activeViews.map((item) => skillSourceKey({ kind: "path", value: item.sourcePath ?? item.location })))
    const disabledViews = disabledList
      .filter((item) => !activeKeys.has(skillSourceKey(item)))
      .map((item) => ({
        name: baseName(item.value),
        description: "",
        location: item.hiddenPath || item.value,
        content: "",
        scope,
        sourcePath: item.value,
        disabled: true,
        hiddenPath: item.hiddenPath,
      }))

    return [...activeViews, ...disabledViews].sort((a, b) => a.name.localeCompare(b.name))
  }

  async function updateLocalSource(scope: Scope, source: SkillSource, restore: boolean) {
    const key = `${scope}:${skillSourceKey(source)}`
    if (savingKey()) return
    setSavingKey(key)
    setSaveError(null)

    const current = disabled()[scope]
    const existing = current.find((item) => skillSourceKey(item) === skillSourceKey(source))

    if (restore) {
      if (!existing) {
        setSavingKey(null)
        return
      }
      const hiddenPath = existing.hiddenPath || buildDisabledSkillPath(source.value)
      const ok = await moveItem(serverUrl, hiddenPath, source.value, targetUrl)
      if (!ok) {
        setSaveError(`Could not restore ${source.value}`)
        setSavingKey(null)
        return
      }
      writeDisabled(scope, current.filter((item) => skillSourceKey(item) !== skillSourceKey(source)))
      showSaved()
      setSavingKey(null)
      await refresh()
      return
    }

    const hiddenPath = buildDisabledSkillPath(source.value)
    const hiddenDir = hiddenPath.replace(/[\\/][^\\/]+$/, "")
    const made = await mkdir(serverUrl, hiddenDir, targetUrl)
    if (!made) {
      setSaveError(`Could not create hidden folder for ${source.value}`)
      setSavingKey(null)
      return
    }

    const moved = await moveItem(serverUrl, source.value, hiddenPath, targetUrl)
    if (!moved) {
      setSaveError(`Could not move ${source.value}`)
      setSavingKey(null)
      return
    }

    writeDisabled(scope, [...current, { ...source, hiddenPath }])
    setActive((currentActive) => ({
      ...currentActive,
      [scope]: currentActive[scope].filter((item) => {
        const path = skillSourcePathFromLocation(item.location) ?? item.location
        return path !== source.value
      }),
    }))
    showSaved()
    setSavingKey(null)
    await refresh()
  }

  async function restoreAll(scope: Scope) {
    const list = disabled()[scope]
    if (list.length === 0 || savingKey()) return
    setSavingKey(`${scope}:restore-all`)
    setSaveError(null)

    for (const item of list) {
      if (!isLocallyManagedSkill(item.value)) continue
      const hiddenPath = item.hiddenPath || buildDisabledSkillPath(item.value)
      const ok = await moveItem(serverUrl, hiddenPath, item.value, targetUrl)
      if (!ok) {
        setSaveError(`Could not restore ${item.value}`)
        setSavingKey(null)
        return
      }
    }

    writeDisabled(scope, [])
    showSaved()
    setSavingKey(null)
    await refresh()
  }

  function row(scope: Scope, skill: SkillView) {
    const source = skill.sourcePath ? { kind: "path" as const, value: skill.sourcePath } : { kind: "url" as const, value: skill.location }
    const working = savingKey() === `${scope}:${skillSourceKey(source)}`
    const canToggle = !!skill.sourcePath

    return (
      <div class="px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0 flex items-center gap-2">
          <span class="shrink-0 flex items-center justify-center w-6 h-6 rounded-md" style={{ background: "var(--surface-inset)", color: "var(--text-interactive-base)" }}>
            {sourceIcon(skill)}
          </span>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>{skill.name}</div>
            <div class="text-xs truncate" style={{ color: "var(--text-weak)" }}>
              {skill.location}
              {skill.sourcePath ? ` · ${sourceLabel(skill)}` : ` · ${sourceLabel(skill)}`}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Show when={!canToggle} fallback={
            <button
              type="button"
              onClick={() => updateLocalSource(scope, source, skill.disabled)}
              disabled={working}
              role="switch"
              aria-checked={!skill.disabled}
              aria-label={skill.disabled ? `Enable ${skill.name}` : `Disable ${skill.name}`}
              class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50"
              style={{ background: skill.disabled ? "var(--surface-inset)" : "var(--interactive-base)" }}
            >
              <div class="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ background: "var(--background-base)", left: skill.disabled ? "2px" : "calc(100% - 18px)" }} />
            </button>
          }>
            <span class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-weak)" }}>
              read-only
            </span>
          </Show>
        </div>
      </div>
    )
  }

  function section(scope: Scope, title: string, description: string) {
    const list = views(scope)
    const disabledCount = disabled()[scope].length

    return (
      <section class="rounded-lg overflow-hidden" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}>
        <div class="px-4 py-3 flex items-center justify-between gap-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
          <div>
            <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>{title}</h2>
            <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>{description}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={disabledCount > 0}>
              <Button variant="secondary" size="sm" onClick={() => restoreAll(scope)} disabled={savingKey() !== null}>
                Restore all
              </Button>
            </Show>
            <span class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-weak)" }}>
              {list.filter((item) => !item.disabled).length} active · {disabledCount} disabled
            </span>
          </div>
        </div>

        <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
          <Show when={list.length > 0} fallback={<div class="px-4 py-3 text-sm" style={{ color: "var(--text-weak)" }}>No skills discovered.</div>}>
            <For each={list}>{(skill) => row(scope, skill)}</For>
          </Show>
        </div>
      </section>
    )
  }

  return (
    <div class="space-y-6">
      <header>
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>Skills</h1>
            <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
              Discovered skills are scanned automatically. Only local folder skills can be disabled and restored.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Show when={loading()}>
              <RefreshCw class="w-4 h-4 animate-spin" style={{ color: "var(--text-weak)" }} />
            </Show>
            <Show when={saved()}>
              <span class="text-xs flex items-center gap-1" style={{ color: "var(--icon-success-base)" }}>
                <Check class="w-3 h-3" /> Saved
              </span>
            </Show>
          </div>
        </div>
      </header>

      <Show when={saveError()}>
        <div class="p-3 rounded-md text-sm" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)", "border-left": "3px solid var(--interactive-critical)", color: "var(--interactive-critical)" }}>
          {saveError()}
        </div>
      </Show>

      {section("global", "Global skills", "Skills discovered from your global OpenCode config and ~/.config/opencode/skills.")}

      <Show when={directory}>
        {section("project", "Project skills", "Skills discovered from this project.")}
      </Show>

      <Show when={!directory}>
        <div class="p-3 rounded-md text-sm" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)", color: "var(--text-weak)" }}>
          Open a project to see project-specific skills.
        </div>
      </Show>

      <div class="text-xs" style={{ color: "var(--text-weak)" }}>
        Built-in skills are shown read-only. Local folder skills can be moved out of discovery and restored later.
      </div>
    </div>
  )
}
