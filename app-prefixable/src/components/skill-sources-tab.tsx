import { createSignal, For, Show, onMount } from "solid-js"
import { Check, Folder, Link2, RefreshCw } from "lucide-solid"
import { Button } from "./ui/button"
import { useSDK } from "../context/sdk"
import { deleteFile, mkdir, moveItem, writeFile } from "../utils/extended-api"
import { appendTargetParam } from "../utils/path"
import { buildDisabledSkillPath, readDisabledSkillSources, skillSourceKey, type SkillSource } from "../utils/skill-sources"

type Scope = "global" | "project"

type Skill = {
  name: string
  description: string
  location: string
  content: string
  scope?: Scope
  state?: "active" | "disabled"
  sourcePath?: string
  hiddenPath?: string
  originalPath?: string
}

function sourceLabel(source: Skill): string {
  if (source.sourcePath) return source.state === "disabled" ? "Disabled local source" : "Local folder source"
  return source.location.startsWith("http") ? "Remote URL source" : "Built-in or generated source"
}

function sourceIcon(source: Skill) {
  return source.sourcePath ? <Folder class="w-3.5 h-3.5" /> : <Link2 class="w-3.5 h-3.5" />
}

export function SkillSourcesTab() {
  const { directory, url: serverUrl, targetUrl } = useSDK()
  const [loading, setLoading] = createSignal(true)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  const [savingKey, setSavingKey] = createSignal<string | null>(null)
  const [legacyMigrated, setLegacyMigrated] = createSignal(false)
  const [skills, setSkills] = createSignal<Record<Scope, Skill[]>>({ global: [], project: [] })

  function showSaved() {
    setSaveError(null)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  async function migrateLegacyDisabledSkills() {
    if (legacyMigrated()) return
    const prefix = "prokube.disabled-skill-sources:"

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const scope = key.match(/^prokube\.disabled-skill-sources:.*:(global|project):/)?.[1] as Scope | undefined
      if (!scope) continue

      for (const item of readDisabledSkillSources(key)) {
        if (!item.hiddenPath) continue
        const manifest = JSON.stringify({ version: 1, originalPath: item.value, scope, disabledAt: new Date().toISOString() }, null, 2)
        await writeFile(serverUrl, `${item.hiddenPath}/.prokube-skill.json`, manifest, targetUrl)
      }
    }

    setLegacyMigrated(true)
  }

  async function refresh() {
    setLoading(true)
    setSaveError(null)
    try {
      await migrateLegacyDisabledSkills()
      const stamp = Date.now().toString(36)
      const [globalRes, projectRes] = await Promise.all([
        fetch(appendTargetParam(`${serverUrl}/skill?_=${stamp}`, targetUrl), { cache: "no-store" }).then((res) => res.ok ? res.json() : []).catch(() => []),
        directory
          ? fetch(appendTargetParam(`${serverUrl}/skill?directory=${encodeURIComponent(directory)}&_= ${stamp}`.replace("&_= ", "&_="), targetUrl), { cache: "no-store" }).then((res) => res.ok ? res.json() : []).catch(() => [])
          : Promise.resolve([]),
      ])

      setSkills({
        global: (globalRes as Skill[]).filter((item) => item.scope === "global" || !item.scope),
        project: (projectRes as Skill[]).filter((item) => item.scope === "project"),
      })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    refresh()
  })

  function views(scope: Scope): Skill[] {
    return skills()[scope].slice().sort((a, b) => a.name.localeCompare(b.name))
  }

  async function updateLocalSource(scope: Scope, source: SkillSource, restore: boolean) {
    const key = `${scope}:${skillSourceKey(source)}`
    if (savingKey()) return
    setSavingKey(key)
    setSaveError(null)

    const existing = views(scope).find((item) => item.state === "disabled" && item.sourcePath === source.value)

    if (restore) {
      if (!existing?.hiddenPath || !existing?.originalPath) {
        setSavingKey(null)
        return
      }
      const ok = await moveItem(serverUrl, existing.hiddenPath, existing.originalPath, targetUrl)
      if (!ok) {
        setSaveError(`Could not restore ${source.value}`)
        setSavingKey(null)
        return
      }
      await deleteFile(serverUrl, `${existing.hiddenPath}/.prokube-skill.json`, targetUrl).catch(() => false)
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

    const manifest = JSON.stringify({ version: 1, originalPath: source.value, scope, disabledAt: new Date().toISOString() }, null, 2)
    const written = await writeFile(serverUrl, `${hiddenPath}/.prokube-skill.json`, manifest, targetUrl)
    if (!written) {
      await moveItem(serverUrl, hiddenPath, source.value, targetUrl)
      setSaveError(`Could not save disabled metadata for ${source.value}`)
      setSavingKey(null)
      return
    }

    showSaved()
    setSavingKey(null)
    await refresh()
  }

  async function disableAll(scope: Scope) {
    const list = views(scope).filter((skill): skill is Skill & { sourcePath: string; state: "active" } => skill.state === "active" && !!skill.sourcePath)
    if (list.length === 0 || savingKey()) return

    setSavingKey(`${scope}:disable-all`)
    setSaveError(null)

    for (const skill of list) {
      const source = { kind: "path" as const, value: skill.sourcePath! }
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

      const manifest = JSON.stringify({ version: 1, originalPath: source.value, scope, disabledAt: new Date().toISOString() }, null, 2)
      const written = await writeFile(serverUrl, `${hiddenPath}/.prokube-skill.json`, manifest, targetUrl)
      if (!written) {
        await moveItem(serverUrl, hiddenPath, source.value, targetUrl)
        setSaveError(`Could not save disabled metadata for ${source.value}`)
        setSavingKey(null)
        return
      }
    }

    showSaved()
    setSavingKey(null)
    await refresh()
  }

  async function restoreAll(scope: Scope) {
    const list = views(scope).filter((skill): skill is Skill & { state: "disabled"; hiddenPath: string; originalPath: string } => skill.state === "disabled" && !!skill.hiddenPath && !!skill.originalPath)
    if (list.length === 0 || savingKey()) return
    setSavingKey(`${scope}:restore-all`)
    setSaveError(null)

    for (const item of list) {
      const ok = await moveItem(serverUrl, item.hiddenPath!, item.originalPath!, targetUrl)
      if (!ok) {
        setSaveError(`Could not restore ${item.originalPath}`)
        setSavingKey(null)
        return
      }
      await deleteFile(serverUrl, `${item.hiddenPath}/.prokube-skill.json`, targetUrl).catch(() => false)
    }

    showSaved()
    setSavingKey(null)
    await refresh()
  }

  function row(scope: Scope, skill: Skill) {
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
              {` · ${sourceLabel(skill)}`}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Show when={!canToggle} fallback={
            <button
              type="button"
              onClick={() => updateLocalSource(scope, source, skill.state === "disabled")}
              disabled={working}
              role="switch"
              aria-checked={skill.state !== "disabled"}
              aria-label={skill.state === "disabled" ? `Enable ${skill.name}` : `Disable ${skill.name}`}
              class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50"
              style={{ background: skill.state === "disabled" ? "var(--surface-inset)" : "var(--interactive-base)" }}
            >
              <div class="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ background: "var(--background-base)", left: skill.state === "disabled" ? "2px" : "calc(100% - 18px)" }} />
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
    const disabledCount = list.filter((skill) => skill.state === "disabled").length
    const disableCount = list.filter((skill) => skill.state === "active" && skill.sourcePath).length

    return (
      <section class="rounded-lg overflow-hidden" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}>
        <div class="px-4 py-3 flex items-center justify-between gap-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
          <div>
            <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>{title}</h2>
            <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>{description}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={disableCount > 0}>
              <Button variant="secondary" size="sm" onClick={() => disableAll(scope)} disabled={savingKey() !== null}>
                Disable all
              </Button>
            </Show>
            <Show when={disabledCount > 0}>
              <Button variant="secondary" size="sm" onClick={() => restoreAll(scope)} disabled={savingKey() !== null}>
                Restore all
              </Button>
            </Show>
            <span class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-weak)" }}>
              {list.filter((item) => item.state !== "disabled").length} active · {disabledCount} disabled
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
