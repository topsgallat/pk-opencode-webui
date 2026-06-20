import { createSignal, For, Index, Show, type JSX, type Accessor, createMemo, onMount, onCleanup, createEffect, createResource } from "solid-js"
import { Portal } from "solid-js/web"
import { closestCenter, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, createSortable } from "@thisbeyond/solid-dnd"
import type { DragEvent as SolidDragEvent } from "@thisbeyond/solid-dnd"
import { Spinner } from "../components/ui/spinner"
import { useProviders } from "../context/providers"
import { useMCP } from "../context/mcp"
import { useSDK } from "../context/sdk"
import { useBasePath } from "../context/base-path"
import { useConfig } from "../context/config"
import type { Config, PermissionActionConfig, ProviderConfig } from "../sdk/client"
import { MCPAddDialog } from "../components/mcp-add-dialog"
import { ConfirmDialog } from "../components/confirm-dialog"
import { Button } from "../components/ui/button"
import { Check, Copy, Plug, GitBranch, Server, ExternalLink, Key, Search, X, Trash2, BookmarkPlus, Pencil, Palette, Sun, Moon, Monitor, BookOpen, Plus, Save, Volume2, Play, Settings2, Code, Shield, Cpu, Wrench, ChevronDown, ChevronRight, Info, Shuffle, GripVertical as DragHandle } from "lucide-solid"
import { SOUND_OPTIONS, readSoundSettings, writeSoundSettings, playSound, primeAudioContext, SOUND_STORAGE_KEY, type SoundSettings } from "../utils/sound"
import { useSavedPrompts } from "../context/saved-prompts"
import { useTheme } from "../context/theme"
import { useDevice } from "../context/device"
import { useServer } from "../context/server"
import { ConstrainDragXAxis } from "../utils/solid-dnd"
import { generateUUID } from "../utils/uuid"
import { writeFile } from "../utils/extended-api"
import { deleteGlobalProvider, validateProviderConnection, replayProviderOAuthCallback, restartOpencode, checkOpencodeHealth } from "../utils/extended-api"
import { appendTargetParam } from "../utils/path"
import { extractOAuthCode, extractOAuthInstructionCode, needsOAuthReplay, normalizeOAuthCallbackUrl } from "../utils/oauth"
import { loadFallbackSettings, resolveFallbackPolicies, saveGlobalFallbackPolicy as saveFallbackGlobalPolicy, saveProjectFallbackPolicy as saveFallbackProjectPolicy } from "../utils/fallback-settings"
import { getServerCapabilities } from "../utils/server-capabilities"
import { modelPolicyEnabled, providerBaseID, providerModelConfig } from "../utils/model-policy"
import {
  getServers,
  saveServer,
  removeServer,
  generateServerId,
  isValidServerUrl,
  type ServerConfig,
} from "../utils/servers"
import {
  getServerAuth,
  setServerAuth,
  removeServerAuth,
  clearServerAuthRevalidation,
} from "../utils/server-auth"
import { QuotaContent } from "../components/quota/quota-panel"
import { SkillSourcesTab } from "../components/skill-sources-tab"

export function Settings() {
  const providers = useProviders()
  const mcp = useMCP()
  const { client, global, url, directory, targetUrl } = useSDK()
  const theme = useTheme()
  const device = useDevice()
  const server = useServer()
  const capabilities = () => getServerCapabilities(server.selectedServer())
  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null)
  const [apiKey, setApiKey] = createSignal("")
  const [accountName, setAccountName] = createSignal("")
  const [connecting, setConnecting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal<string | null>(null)
  // Initialize tab from URL hash, default to "providers"
  const getInitialTab = () => {
    const hash = window.location.hash.slice(1)
    const validTabs = directory
      ? ["providers", "git", "mcp", "prompts", "instructions", "skills", "config", "fallback", "appearance", "sounds", "servers", "quota"]
      : ["providers", "git", "mcp", "prompts", "instructions", "skills", "fallback", "appearance", "sounds", "servers", "quota"]
    return validTabs.includes(hash) ? hash : "providers"
  }
  const [activeTab, setActiveTab] = createSignal(getInitialTab())
  const [showMCPAddDialog, setShowMCPAddDialog] = createSignal(false)
  const [mcpLoading, setMcpLoading] = createSignal<string | null>(null)
  const [mcpDeleting, setMcpDeleting] = createSignal<string | null>(null)
  const [mcpToDelete, setMcpToDelete] = createSignal<string | null>(null)

  // Saved prompts
  const savedPrompts = useSavedPrompts()
  const [promptDialogOpen, setPromptDialogOpen] = createSignal(false)
  const [editingPromptId, setEditingPromptId] = createSignal<string | null>(null)
  const [promptTitle, setPromptTitle] = createSignal("")
  const [promptText, setPromptText] = createSignal("")
  const [promptToDelete, setPromptToDelete] = createSignal<string | null>(null)

  // Sound settings
  const [soundSettings, setSoundSettings] = createSignal<SoundSettings>(readSoundSettings())

  // Keep soundSettings in sync with localStorage changes from other tabs
  onMount(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === SOUND_STORAGE_KEY) setSoundSettings(readSoundSettings())
    }
    window.addEventListener("storage", handleStorage)
    onCleanup(() => window.removeEventListener("storage", handleStorage))
  })

  function updateSoundSettings(patch: Partial<SoundSettings>) {
    const next = { ...soundSettings(), ...patch }
    setSoundSettings(next)
    writeSoundSettings(next)
  }

  // Server management
  const [servers, setServers] = createSignal<ServerConfig[]>(getServers())
  const [showServerDialog, setShowServerDialog] = createSignal(false)
  const [editingServer, setEditingServer] = createSignal<ServerConfig | null>(null)
  const [serverNameInput, setServerNameInput] = createSignal("")
  const [serverUrlInput, setServerUrlInput] = createSignal("")
  const [serverUsernameInput, setServerUsernameInput] = createSignal("")
  const [serverPasswordInput, setServerPasswordInput] = createSignal("")
  const [serverError, setServerError] = createSignal<string | null>(null)
  const [serverWarn, setServerWarn] = createSignal<string | null>(null)
  const [serverChecking, setServerChecking] = createSignal(false)
  const [showRestartConfirm, setShowRestartConfirm] = createSignal(false)
  const [restartLoading, setRestartLoading] = createSignal(false)
  const [restartChecking, setRestartChecking] = createSignal(false)
  const [restartState, setRestartState] = createSignal<"idle" | "restarting" | "checking" | "ready" | "error">("idle")
  const [restartInfo, setRestartInfo] = createSignal<string | null>(null)
  const [restartError, setRestartError] = createSignal<string | null>(null)
  const [restartSuccess, setRestartSuccess] = createSignal<string | null>(null)

  // Keep servers in sync with localStorage
  onMount(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === "opencode.servers") setServers(getServers())
    }
    window.addEventListener("storage", handleStorage)
    onCleanup(() => window.removeEventListener("storage", handleStorage))
  })

  function refreshServers() {
    setServers(getServers())
  }

  function openAddServerDialog() {
    setShowServerDialog(true)
    setEditingServer(null)
    setServerNameInput("")
    setServerUrlInput("")
    setServerUsernameInput("")
    setServerPasswordInput("")
    setServerError(null)
  }

  function openEditServerDialog(server: ServerConfig) {
    setShowServerDialog(true)
    setEditingServer(server)
    setServerNameInput(server.name)
    setServerUrlInput(server.url)
    const auth = getServerAuth(server.id)
    setServerUsernameInput(auth?.username || "")
    setServerPasswordInput(auth?.password || "")
    setServerError(null)
  }

  function closeServerDialog() {
    setShowServerDialog(false)
    setEditingServer(null)
    setServerNameInput("")
    setServerUrlInput("")
    setServerUsernameInput("")
    setServerPasswordInput("")
    setServerError(null)
    setServerWarn(null)
    setServerChecking(false)
  }

  async function saveServerDialog() {
    const name = serverNameInput().trim()
    const url = serverUrlInput().trim()
    if (!name || !url) return

    if (!isValidServerUrl(url)) {
      setServerError("Invalid URL. Must start with http:// or https://")
      return
    }

    const cleanUrl = url.replace(/\/$/, "")

    if (!editingServer()) {
      setServerChecking(true)
      setServerError(null)
      setServerWarn(null)
      const probeUrl = basePath.prefix(`/api/ext/probe-server?url=${encodeURIComponent(cleanUrl)}`)
      const probe: { ok: boolean; reachable?: boolean; authRequired?: boolean; status?: number; error?: string } = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) })
        .then(r => r.json())
        .catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      setServerChecking(false)
      if (probe.authRequired) {
        setServerWarn("Server is reachable but requires authentication. Credentials saved.")
      } else if (!probe.ok) {
        if (probe.reachable) {
          setServerWarn(`Server responded with status ${probe.status ?? "unknown"}. Added anyway.`)
        } else {
          setServerWarn(`Server may be unreachable from this host: ${probe.error ?? "no response"}. Added anyway.`)
        }
      }
    }

    const server: ServerConfig = {
      id: editingServer()?.id ?? generateServerId(),
      name,
      url: cleanUrl,
      isDefault: editingServer()?.isDefault ?? servers().length === 0,
    }

    const pwd = serverPasswordInput()
    if (pwd) {
      setServerAuth(server.id, {
        username: serverUsernameInput().trim() || "opencode",
        password: pwd,
        needsRevalidation: false
      })
      clearServerAuthRevalidation(server.id)
    } else {
      removeServerAuth(server.id)
    }

    saveServer(server)
    refreshServers()
    closeServerDialog()
  }

  function confirmServerDelete(id: string) {
    removeServer(id)
    refreshServers()
  }

  function toggleServerDefault(id: string) {
    const server = servers().find((s) => s.id === id)
    if (!server) return
    saveServer({ ...server, isDefault: true })
    refreshServers()
  }

  async function confirmRestartOpencode() {
    if (restartLoading() || restartChecking()) return
    setRestartLoading(true)
    setRestartChecking(false)
    setRestartState("restarting")
    setRestartError(null)
    setRestartSuccess(null)
    setRestartInfo("Restarting...")

    const result = await restartOpencode(url)

    if (!result.ok) {
      setRestartLoading(false)
      setRestartState("error")
      setRestartInfo(null)
      setRestartError(result.error || `Failed to restart OpenCode${result.status ? ` (HTTP ${result.status})` : ""}`)
      return
    }

    setRestartLoading(false)
    setRestartChecking(true)
    setRestartState("checking")
    setRestartInfo("Waiting for the backend to go down and come back online...")
    setShowRestartConfirm(false)
    void waitForRestartHealth()
  }

  async function waitForRestartHealth() {
    const deadline = Date.now() + 60_000
    let seenDown = false
    while (Date.now() < deadline) {
      const health = await checkOpencodeHealth(url)
      if (!health.ok || health.healthy !== true) {
        seenDown = true
      setRestartInfo("Waiting for the backend to come back...")
      }

      if (seenDown && health.ok && health.healthy) {
        setRestartChecking(false)
        setRestartState("ready")
        setRestartInfo(null)
        setRestartSuccess("Restart complete")
        window.setTimeout(() => {
          setRestartSuccess((current) => current === "Restart complete" ? null : current)
        }, 6000)
        return
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }

    setRestartChecking(false)
    setRestartState("error")
    setRestartInfo(null)
    setRestartError(seenDown ? "Restart began, but the backend did not become healthy in time." : "Restart was accepted, but the backend never appeared to restart.")
  }

  // Provider search
  const [providerSearch, setProviderSearch] = createSignal("")

  // Instructions state
  const basePath = useBasePath()
  const [instructionPaths, setInstructionPaths] = createSignal<string[]>([])
  const [instructionContents, setInstructionContents] = createSignal<Record<string, { content: string; exists: boolean }>>({})
  const [instructionEdits, setInstructionEdits] = createSignal<Record<string, string>>({})
  const [instructionLoading, setInstructionLoading] = createSignal(false)
  const [instructionSaving, setInstructionSaving] = createSignal<string | null>(null)
  const [instructionSaved, setInstructionSaved] = createSignal<string | null>(null)
  const [instructionError, setInstructionError] = createSignal<string | null>(null)
  const [instructionCreating, setInstructionCreating] = createSignal(false)
  const [instructionLoaded, setInstructionLoaded] = createSignal(false)

  // OAuth state
  const [oauthPending, setOauthPending] = createSignal<{
    providerID: string
    providerName: string
    methodIndex: number
    method: "auto" | "code"
    requiresReplay: boolean
    authUrl: string
    instructions: string
    code: string // Extracted code from instructions (e.g., "XXXX-YYYY")
  } | null>(null)
  const [oauthCode, setOauthCode] = createSignal("")
  const [codeCopied, setCodeCopied] = createSignal(false)

  function openOAuthTab() {
    const pending = oauthPending()
    if (!pending?.authUrl) return
    window.open(pending.authUrl, "_blank")
  }

  // Git SSH Key state - read-only, display all existing keys
  interface SshKey {
    name: string // e.g. "id_ed25519"
    content: string // public key content
  }
  const [sshKeys, setSshKeys] = createSignal<SshKey[]>([])
  const [sshKeyLoading, setSshKeyLoading] = createSignal(false)
  const [sshKeyError, setSshKeyError] = createSignal<string | null>(null)
  const [sshKeyCopied, setSshKeyCopied] = createSignal<string | null>(null) // tracks which key was copied
  const [sshCommandCopied, setSshCommandCopied] = createSignal(false)
  const [sshKeyLoaded, setSshKeyLoaded] = createSignal(false)

  // Disconnect progress state for provider actions
  const [disconnectingProvider, setDisconnectingProvider] = createSignal<string | null>(null)

  // Get auth methods for selected provider
  const selectedProviderAuthMethods = createMemo(() => {
    const id = selectedProvider()
    if (!id) return []
    return providers.authMethods[id] || []
  })

  // Popular providers shown first
  const popularProviders = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter"]

  const filteredProviders = createMemo(() => {
    const search = providerSearch().toLowerCase().trim()
    const all = providers.rawProviders

    // Filter by search
    const filtered = search
      ? all.filter((p) => p.name.toLowerCase().includes(search) || p.id.toLowerCase().includes(search))
      : all

    // Sort: popular first, then alphabetically
    return filtered.sort((a, b) => {
      const aPopular = popularProviders.indexOf(a.id)
      const bPopular = popularProviders.indexOf(b.id)
      if (aPopular >= 0 && bPopular >= 0) return aPopular - bPopular
      if (aPopular >= 0) return -1
      if (bPopular >= 0) return 1
      return a.name.localeCompare(b.name)
    })
  })

  // Load SSH key when Git tab is first accessed
  function onTabChange(tabId: string) {
    setActiveTab(tabId)
    // Persist tab in URL hash for refresh persistence
    const url = new URL(window.location.href)
    url.hash = tabId
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    if (tabId === "git" && !sshKeyLoaded()) {
      setSshKeyLoaded(true)
      loadSshKey()
    }
    if (tabId === "instructions" && directory && !instructionLoaded()) {
      setInstructionLoaded(true)
      loadInstructions()
    }
  }

  // Load SSH key on mount if starting on git tab
  onMount(() => {
    if (activeTab() === "git" && !sshKeyLoaded()) {
      setSshKeyLoaded(true)
      loadSshKey()
    }
    if (activeTab() === "instructions" && directory && !instructionLoaded()) {
      setInstructionLoaded(true)
      loadInstructions()
    }
  })

  async function runPtyCommand(command: string, timeout = 5000): Promise<string> {
    if (import.meta.env.DEV) console.debug("[runPtyCommand] Starting with command:", command)
    try {
      // Create PTY that directly runs the command via sh -c
      // Add a sleep at the end to give us time to connect and read the output
      // The sleep keeps the process alive until we've read all data
      // cd to $HOME first to ensure we're in a valid directory for SSH operations
      const marker = `__DONE_${Date.now()}__`
      const fullCommand = `cd ~ && ${command}; echo "${marker}"; sleep 2`

      // Use global client (no directory header) to avoid project context issues
      // Use /usr/bin/env sh instead of /bin/sh to avoid the PTY code
      // appending -l flag which breaks -c execution
      // Use /tmp as cwd - it always exists and is writable
      const ptyRes = await global.pty.create({
        command: "/usr/bin/env",
        args: ["sh", "-c", fullCommand],
        cwd: "/tmp",
      })

      if (import.meta.env.DEV) console.debug("[runPtyCommand] PTY create response:", ptyRes)

      if (!ptyRes.data?.id) {
        console.error("[runPtyCommand] Failed to create PTY:", ptyRes)
        return ""
      }

      const ptyId = ptyRes.data.id
      const wsUrl = appendTargetParam(`${url.replace(/^http/, "ws")}/pty/${ptyId}/connect`, targetUrl)
      if (import.meta.env.DEV) console.debug("[runPtyCommand] Connecting to:", wsUrl)

      const output = await new Promise<string>((resolve) => {
        let data = ""
        const ws = new WebSocket(wsUrl)

          const timeoutId = setTimeout(() => {
          if (import.meta.env.DEV) console.debug("[runPtyCommand] Timeout reached. Data collected:", data)
          ws.close()
          resolve(data)
        }, timeout)

        ws.addEventListener("open", () => {
          if (import.meta.env.DEV) console.debug("[runPtyCommand] WebSocket connected")
        })

        ws.addEventListener("message", async (event) => {
          const text = event.data instanceof Blob ? await event.data.text() : String(event.data)
          if (import.meta.env.DEV) console.debug("[runPtyCommand] Received message:", text)
          data += text

          // Check if we got the completion marker
          if (data.includes(marker)) {
            if (import.meta.env.DEV) console.debug("[runPtyCommand] Marker found, closing")
            clearTimeout(timeoutId)
            ws.close()
            resolve(data)
          }
        })

        ws.addEventListener("close", () => {
          if (import.meta.env.DEV) console.debug("[runPtyCommand] WebSocket closed, total output length:", data.length)
          clearTimeout(timeoutId)
          resolve(data)
        })

        ws.addEventListener("error", (e) => {
          console.error("[runPtyCommand] WebSocket error:", e)
          clearTimeout(timeoutId)
          resolve(data)
        })
      })

      if (import.meta.env.DEV) console.debug("[runPtyCommand] Final output:", output)
      await global.pty.remove({ ptyID: ptyId }).catch(() => { })
      return output
    } catch (e) {
      console.error("[runPtyCommand] Error:", e)
      return ""
    }
  }

  // Strip ANSI escape codes and PTY protocol artifacts from terminal output
  function stripTerminalArtifacts(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[a-zA-Z]/g, "") // ANSI codes
      .replace(/[\x00-\x1f\uFFFD]*\{"cursor":\d+\}/g, "") // PTY cursor position JSON with any leading control chars
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // Remove remaining control characters (except \t \n \r)
  }

  // Load SSH keys - read-only, find all .pub files in ~/.ssh/
  async function loadSshKey() {
    setSshKeyLoading(true)
    setSshKeyError(null)
    if (import.meta.env.DEV) console.debug("[loadSshKey] Starting")
    try {
      // List all .pub files in ~/.ssh/
      const lsOutput = await runPtyCommand(`ls -1 ~/.ssh/*.pub 2>/dev/null`)
      const cleanLsOutput = stripTerminalArtifacts(lsOutput)

      // Extract filenames from ls output
      const pubFiles = cleanLsOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".pub") && !line.includes("*"))

      if (import.meta.env.DEV) console.debug("[loadSshKey] Found .pub files:", pubFiles)

      const foundKeys: SshKey[] = []

      for (const pubFile of pubFiles) {
        const content = await runPtyCommand(`cat "${pubFile}" 2>/dev/null`)
        const cleanContent = stripTerminalArtifacts(content)
        const keyContent = cleanContent
          .split("\n")
          .find((line) => {
            const trimmed = line.trim()
            return trimmed.startsWith("ssh-") || trimmed.startsWith("ecdsa-")
          })
          ?.trim()

          if (keyContent) {
          // Extract just the filename without path and .pub extension
          const keyName =
            pubFile
              .split("/")
              .pop()
              ?.replace(/\.pub$/, "") || pubFile
            if (import.meta.env.DEV) console.debug("[loadSshKey] Found key:", keyName)
            foundKeys.push({ name: keyName, content: keyContent })
          }
        }

      // Sort keys: standard names first, then alphabetically
      const standardOrder = ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"]
      foundKeys.sort((a, b) => {
        const aIdx = standardOrder.indexOf(a.name)
        const bIdx = standardOrder.indexOf(b.name)
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx
        if (aIdx >= 0) return -1
        if (bIdx >= 0) return 1
        return a.name.localeCompare(b.name)
      })

      if (import.meta.env.DEV) console.debug("[loadSshKey] Total keys found:", foundKeys.length)
      setSshKeys(foundKeys)
    } catch (e) {
      console.error("[loadSshKey] Failed to load SSH keys:", e)
      setSshKeyError("Failed to check for SSH keys")
    } finally {
      setSshKeyLoading(false)
    }
  }

  async function copySshKey(keyName: string, keyContent: string) {
    try {
      await navigator.clipboard.writeText(keyContent)
      setSshKeyCopied(keyName)
      setTimeout(() => setSshKeyCopied(null), 2000)
    } catch (e) {
      console.error("Failed to copy:", e)
    }
  }

  async function copySshCommand() {
    const cmd = "ssh-keygen -t ed25519"
    try {
      await navigator.clipboard.writeText(cmd)
      setSshCommandCopied(true)
      setTimeout(() => setSshCommandCopied(false), 2000)
    } catch (e) {
      console.error("Failed to copy:", e)
    }
  }

  async function loadInstructions() {
    setInstructionLoading(true)
    setInstructionError(null)
    const configRes = await client.config.get().catch(() => null)
    const cfg = configRes?.data as Config | undefined
    const paths = cfg?.instructions ?? []
    setInstructionPaths(paths)

    const contents: Record<string, { content: string; exists: boolean }> = {}
    for (const p of paths) {
      const fileRes = await client.file.read({ path: p, directory }).catch(() => null)
      const data = fileRes?.data as { content?: string } | undefined
      if (data?.content !== undefined) {
        contents[p] = { content: data.content, exists: true }
      } else {
        contents[p] = { content: "", exists: false }
      }
    }
    setInstructionContents(contents)
    setInstructionEdits({})
    setInstructionLoading(false)
  }

  async function saveInstruction(path: string) {
    if (!capabilities().canEditLocalInstructionFiles) {
      setInstructionError("Instruction file editing is available only for the local OpenCode backend.")
      return
    }
    const edits = instructionEdits()
    const content = edits[path]
    if (content === undefined) return

    // Build absolute path if relative
    const absolute = path.startsWith("/") ? path : (directory ? `${directory.replace(/\/$/, "")}/${path}` : path)

    setInstructionSaving(path)
    setInstructionError(null)
    const ok = await writeFile(basePath.serverUrl, absolute, content)
    setInstructionSaving(null)
    if (!ok) {
      setInstructionError(`Failed to save ${path}`)
      return
    }
    // Update stored content
    setInstructionContents((prev) => ({ ...prev, [path]: { content, exists: true } }))
    setInstructionEdits((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
    setInstructionSaved(path)
    setTimeout(() => setInstructionSaved(null), 2000)
  }

  async function createInstructionsFile() {
    if (!capabilities().canEditLocalInstructionFiles) {
      setInstructionError("Instruction file creation is available only for the local OpenCode backend.")
      return
    }
    if (!directory) return
    setInstructionCreating(true)
    setInstructionError(null)

    const template = `# Project Instructions

These instructions are automatically included in every session.

## Coding Conventions

- Use TypeScript for all new code
- Follow existing code style and patterns
- Prefer functional style where possible

## Project-Specific Notes

Add your project-specific instructions here.
`
    const agentsPath = `${directory.replace(/\/$/, "")}/AGENTS.md`

    // Check if AGENTS.md already exists before writing to avoid overwriting user content
    const existingAgents = await client.file.read({ path: "AGENTS.md", directory }).catch(() => null)
    const agentsData = existingAgents?.data as { content?: string } | undefined
    if (!agentsData?.content) {
      // File doesn't exist — write the template
      const ok = await writeFile(basePath.serverUrl, agentsPath, template)
      if (!ok) {
        setInstructionError("Failed to create AGENTS.md")
        setInstructionCreating(false)
        return
      }
    }

    // Update config via backend API so the change is immediately visible
    const configRes = await client.config.get().catch(() => null)
    if (!configRes?.data) {
      setInstructionError("Failed to fetch project config")
      setInstructionCreating(false)
      return
    }
    const cfg = configRes.data as Config
    const existingInstructions = cfg.instructions ?? []
    const hasAgents = existingInstructions.includes("AGENTS.md")
    if (!hasAgents) {
      const instructions = [...existingInstructions, "AGENTS.md"]
      const updateRes = await client.config.update({ config: { instructions } }).catch(() => null)
      if (!updateRes?.data) {
        setInstructionError("Failed to update project instructions. Please try again.")
        setInstructionCreating(false)
        return
      }
    }

    setInstructionCreating(false)
    // Reload instructions
    await loadInstructions()
  }

  async function handleConnect(e: SubmitEvent) {
    e.preventDefault()
    const providerID = selectedProvider()
    const key = apiKey().trim()
    const name = accountName().trim() || undefined

    if (!providerID || !key) return

    setConnecting(true)
    setError(null)
    setSuccess(null)

    const ok = await providers.connectProvider(providerID, key, name)

    setConnecting(false)

    if (ok) {
      const displayName = name ? `${providerID}:${name}` : providerID
      setSuccess(`Connected to ${displayName}!`)
      setApiKey("")
      setAccountName("")
      setSelectedProvider(null)
    } else {
      setError("Failed to connect. Please check your API key.")
    }
  }

  async function handleOAuthStart(providerID: string, methodIndex: number) {
    setError(null)
    setSuccess(null)

    const isOpenAI = providerID === "openai" || providerID.startsWith("openai:")
    const isCopilot = providerID === "github-copilot" || providerID.startsWith("github-copilot:")
    const methodLabel = providers.authMethods[providerID]?.[methodIndex]?.label ?? ""

    const result = await providers.startOAuth(providerID, methodIndex)

    if (result) {
      const code = extractOAuthInstructionCode(result.instructions)
      const replay = needsOAuthReplay(providerID, methodLabel, result.url)

      const providerName = getProviderDisplayName(providerID)
      setOauthCode("")
      setCodeCopied(false)

      if (replay) {
        // Browser OAuth needs the callback URL replayed back to the local listener.
        // OpenAI stays on the modal so the user can explicitly open the auth page.
        setOauthPending({
          providerID,
          providerName,
          methodIndex,
          method: "code",
          instructions: result.instructions,
          requiresReplay: replay,
          authUrl: result.url,
          code,
        })
        return
      } else {
        // Device/headless flow - show the code and keep polling. Open the auth page only when the user clicks the button.
        setOauthPending({
          providerID,
          providerName,
          methodIndex,
          method: "auto",
          instructions: result.instructions,
          requiresReplay: false,
          authUrl: result.url,
          code,
        })

        if (!isOpenAI && !isCopilot) {
          // Keep the old auto-open for non-OpenAI providers that expect it.
          window.open(result.url, "_blank")
        }

        // Start the callback immediately - it will poll until user authorizes
        // This call blocks until authorization succeeds or fails
        if (import.meta.env.DEV) console.debug("[OAuth] Starting auto callback for", providerID, "with code:", code)
        setConnecting(true)
        const oauthComplete = await providers.completeOAuth(providerID, methodIndex)
        if (import.meta.env.DEV) console.debug("[OAuth] Callback result:", oauthComplete)
        setConnecting(false)

        if (oauthComplete.ok) {
          setSuccess(`Connected to ${providerName}!`)
          setOauthPending(null)
          setSelectedProvider(null)
          setProviderSearch("")
        } else {
          const where = oauthComplete.stage === "callback"
            ? "while completing the provider callback"
            : oauthComplete.stage === "sync"
              ? "while syncing the provider auth back into the UI"
              : "while refreshing provider state"
          const details = oauthComplete.status ? ` (HTTP ${oauthComplete.status})` : ""
          setError(`${where}: ${oauthComplete.error}${details}`)
          setOauthPending(null)
        }
      }
    } else {
      setError("Failed to start authentication.")
    }
  }

  async function handleOAuthComplete() {
    const pending = oauthPending()
    if (!pending) return

    setConnecting(true)
    setError(null)

    // Keep this path rebuild-stable while we debug the browser replay flow.

    const replay = pending.requiresReplay === true
    const callbackUrl = replay ? normalizeOAuthCallbackUrl(oauthCode()) : undefined
    if (replay && !callbackUrl) {
      setConnecting(false)
      setError("Paste the full callback URL from your browser.")
      return
    }

    if (replay) {
      const replayed = await replayProviderOAuthCallback(url, pending.providerID, callbackUrl!, targetUrl)
      if (!replayed.ok) {
        const retryable = replayed.status === 502 || replayed.status === 504 || (replayed.error && /connect|reachable|reset/i.test(replayed.error))
        if (!retryable) {
          setConnecting(false)
          setError(replayed.error ? (replayed.status ? `${replayed.error} (HTTP ${replayed.status})` : replayed.error) : "Failed to replay the callback URL. Please copy the full browser URL and try again.")
          return
        }

        console.warn("[OAuth] replay listener unreachable, continuing with code exchange", replayed)
      }
    }

    const code = replay ? extractOAuthCode(callbackUrl!) : extractOAuthCode(oauthCode())
    if (!replay && !code) {
      setConnecting(false)
      setError("Paste the code from the auth page.")
      return
    }

    const oauthComplete = await providers.completeOAuth(pending.providerID, pending.methodIndex, code || undefined)

    setConnecting(false)

    if (oauthComplete.ok) {
      setSuccess(`Connected to ${pending.providerName}!`)
      setOauthPending(null)
      setOauthCode("")
      setSelectedProvider(null)
      setProviderSearch("")
    } else {
      const where = oauthComplete.stage === "callback"
        ? "while completing the provider callback"
        : oauthComplete.stage === "sync"
          ? "while syncing the provider auth back into the UI"
          : "while refreshing provider state"
      const details = oauthComplete.status ? ` (HTTP ${oauthComplete.status})` : ""
      setError(`${where}: ${oauthComplete.error}${details}`)
    }
  }

  function cancelOAuth() {
    setOauthPending(null)
    setOauthCode("")
    setCodeCopied(false)
    setConnecting(false)
  }

  async function copyCode() {
    const pending = oauthPending()
    if (!pending?.code) return
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && await navigator.clipboard.writeText(pending.code).then(() => true).catch(() => false)) {
        setCodeCopied(true)
      }
      setTimeout(() => setCodeCopied(false), 2000)
    } catch (e) {
      console.error("Failed to copy code:", e)
    }
  }

  function getProviderDisplayName(id: string): string {
    const provider = providers.rawProviders.find((p) => p.id === id)
    return provider?.name ?? id
  }

  async function confirmMcpDelete() {
    const name = mcpToDelete()
    if (!name) return
    if (!capabilities().canUseLocalExtFileOps) {
      setMcpToDelete(null)
      return
    }
    setMcpToDelete(null)
    setMcpDeleting(name)
    try {
      await mcp.remove(name)
    } catch (e) {
      console.error("[Settings] Failed to remove MCP server:", e)
    } finally {
      setMcpDeleting(null)
    }
  }

  function openAddPromptDialog() {
    setEditingPromptId(null)
    setPromptTitle("")
    setPromptText("")
    setPromptDialogOpen(true)
  }

  function openEditPromptDialog(id: string) {
    const prompt = savedPrompts.prompts().find((p) => p.id === id)
    if (!prompt) return
    setEditingPromptId(id)
    setPromptTitle(prompt.title)
    setPromptText(prompt.text)
    setPromptDialogOpen(true)
  }

  function savePromptDialog() {
    const title = promptTitle().trim()
    const text = promptText().trim()
    if (!title || !text) return
    const editing = editingPromptId()
    if (editing) {
      savedPrompts.update(editing, { title, text })
    } else {
      savedPrompts.add(title, text)
    }
    setPromptDialogOpen(false)
    setEditingPromptId(null)
    setPromptTitle("")
    setPromptText("")
  }

  function confirmPromptDelete() {
    const id = promptToDelete()
    if (!id) return
    savedPrompts.remove(id)
    setPromptToDelete(null)
  }

  // Scope badge type for each tab
  type ScopeBadge = "Global" | "Project" | "Global + Project" | null

  const tabs = createMemo(() => {
    const base: Array<{ id: string; label: string; icon: () => JSX.Element; scope: ScopeBadge }> = [
      { id: "providers", label: "Providers", icon: () => <Plug class="w-4 h-4" />, scope: "Global" },
      { id: "git", label: "Git", icon: () => <GitBranch class="w-4 h-4" />, scope: "Global" },
      { id: "mcp", label: "MCP Servers", icon: () => <Server class="w-4 h-4" />, scope: "Global + Project" },
      { id: "prompts", label: "Prompts", icon: () => <BookmarkPlus class="w-4 h-4" />, scope: directory ? "Project" : null },
      { id: "instructions", label: "Instructions", icon: () => <BookOpen class="w-4 h-4" />, scope: directory ? "Project" : null },
      { id: "skills", label: "Skills", icon: () => <Wrench class="w-4 h-4" />, scope: "Global + Project" },
    ]
    if (directory) {
      base.push({ id: "config", label: "Project Config", icon: () => <Settings2 class="w-4 h-4" />, scope: "Project" })
    }
    base.push({ id: "fallback", label: "Model Fallback", icon: () => <Shuffle class="w-4 h-4" />, scope: directory ? "Global + Project" : "Global" })
    base.push({ id: "appearance", label: "Appearance", icon: () => <Palette class="w-4 h-4" />, scope: null })
    base.push({ id: "sounds", label: "Sounds", icon: () => <Volume2 class="w-4 h-4" />, scope: null })
    base.push({ id: "servers", label: "Servers", icon: () => <Server class="w-4 h-4" />, scope: null })
    base.push({ id: "quota", label: "Quota", icon: () => <Cpu class="w-4 h-4" />, scope: null })
    return base
  })

  return (
    <div class="h-full flex flex-col md:flex-row" style={{ background: "var(--background-stronger)" }}>
      {/* Tabs sidebar - Hidden on mobile, dropdown used instead */}
      <Show when={!device.isMobile()}>
        <div
          class="w-56 shrink-0 flex flex-col py-3 px-2"
          style={{
            background: "var(--background-base)",
            "border-right": "1px solid var(--border-base)",
          }}
        >
          <div class="text-xs font-medium uppercase tracking-wide px-3 py-2" style={{ color: "var(--text-weak)" }}>
            Settings
          </div>
          {/* Project indicator */}
          <Show when={directory}>
            <div
              class="mx-2 mb-2 px-2 py-1.5 rounded-md text-xs truncate"
              style={{
                background: "var(--surface-inset)",
                color: "var(--text-weak)",
                border: "1px solid var(--border-base)",
              }}
              title={directory}
            >
              <span style={{ color: "var(--text-base)" }}>{directory!.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}</span>
            </div>
          </Show>
          <div class="space-y-0.5">
            <For each={tabs()}>
              {(tab) => (
                <button
                  onClick={() => onTabChange(tab.id)}
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left"
                  style={{
                    color: activeTab() === tab.id ? "var(--text-interactive-base)" : "var(--text-base)",
                    background: activeTab() === tab.id ? "var(--surface-inset)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (activeTab() !== tab.id) e.currentTarget.style.background = "var(--surface-inset)"
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab() !== tab.id) e.currentTarget.style.background = "transparent"
                  }}
                >
                  {tab.icon()}
                  <span class="flex-1 truncate">{tab.label}</span>
                  <Show when={tab.scope}>
                    <span
                      class="text-[10px] px-1 py-0.5 rounded shrink-0"
                      style={{
                        background: "var(--surface-inset)",
                        color: "var(--text-weak)",
                      }}
                    >
                      {tab.scope}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Content */}
      <div class="flex-1 overflow-y-auto relative">
        <div class="max-w-2xl p-4 md:p-6 space-y-6">
          {/* Mobile Tab Selector */}
          <Show when={device.isMobile()}>
            <div class="mb-4">
              <label class="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--text-weak)" }}>
                Settings Menu
              </label>
              <div class="relative">
                <select
                  class="w-full appearance-none px-3 py-2.5 rounded-lg text-sm font-medium border focus:outline-none"
                  style={{
                    background: "var(--background-base)",
                    "border-color": "var(--border-base)",
                    color: "var(--text-strong)",
                  }}
                  value={activeTab()}
                  onChange={(e) => onTabChange(e.currentTarget.value)}
                >
                  <For each={tabs()}>
                    {(tab) => (
                      <option value={tab.id}>
                        {tab.label} {tab.scope ? `(${tab.scope})` : ""}
                      </option>
                    )}
                  </For>
                </select>
                <ChevronDown class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-weak)" }} />
              </div>
            </div>
          </Show>

          {/* Project header banner */}
          <Show when={directory}>
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
              style={{
                background: "var(--surface-inset)",
                color: "var(--text-weak)",
                border: "1px solid var(--border-base)",
              }}
            >
              <Info class="w-3.5 h-3.5 shrink-0" />
              <span>
                Project: <span style={{ color: "var(--text-base)" }}>{directory}</span>
              </span>
            </div>
          </Show>

          {/* Providers Tab */}
          <Show when={activeTab() === "providers"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Providers
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Connect AI providers to enable chat functionality
                </p>
              </header>

              {/* Connected Providers */}
              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="px-4 py-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Connected Providers
                  </h2>
                </div>
                <div class="p-4">
                  <Show when={providers.loading}>
                    <div class="flex items-center gap-2" style={{ color: "var(--text-weak)" }}>
                      <Spinner class="w-4 h-4" />
                      <span class="text-sm">Loading connected providers...</span>
                    </div>
                  </Show>

                    <Show when={!providers.loading && providers.rawConnected.length === 0}>
                    <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                      No providers connected yet.
                    </p>
                  </Show>

                    <Show when={!providers.loading && providers.rawConnected.length > 0}>
                    <div class="space-y-2">
                      <For each={providers.rawConnected}>
                        {(providerID) => {
                          const colonIdx = providerID.indexOf(":")
                          const baseProvider = colonIdx > 0 ? providerID.slice(0, colonIdx) : providerID
                          const account = colonIdx > 0 ? providerID.slice(colonIdx + 1) : null
                          const disconnecting = () => disconnectingProvider() === providerID

                          return (
                            <div
                              class="flex flex-col gap-3 p-3 rounded-md md:flex-row md:items-center md:justify-between"
                              style={{ background: "var(--surface-inset)" }}
                            >
                              <div class="flex items-center gap-3 min-w-0">
                                <div class="w-6 h-6 rounded flex items-center justify-center shrink-0" style={{ background: "var(--surface-strong)" }}>
                                  <Check class="w-3 h-3" style={{ color: "var(--icon-success-base)" }} />
                                </div>
                                <div class="min-w-0">
                                  <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                                      {getProviderDisplayName(baseProvider)}
                                    </span>
                                    <Show when={account}>
                                      <span class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-raised)", color: "var(--text-weak)" }}>
                                        {account}
                                      </span>
                                    </Show>
                                  </div>
                                  <div class="text-xs mt-0.5" style={{ color: "var(--text-weak)" }}>
                                    Connected
                                  </div>
                                </div>
                              </div>
                              <div class="flex items-center gap-2 flex-wrap md:justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedProvider(baseProvider)
                                    setAccountName("")
                                    setApiKey("")
                                  }}
                                  class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                                  style={{ background: "var(--surface-raised)", color: "var(--text-base)" }}
                                >
                                  <Plus class="w-3 h-3" />
                                  Add account
                                </button>
                                <button
                                  type="button"
                                  disabled={disconnecting()}
                                  onClick={async () => {
                                    setDisconnectingProvider(providerID)
                                    const ok = await providers.disconnectProvider(providerID)
                                    if (ok) {
                                      setSuccess(`Disconnected ${providerID}.`)
                                      if (selectedProvider() === baseProvider) setSelectedProvider(null)
                                    } else {
                                      setError(`Failed to disconnect ${providerID}.`)
                                    }
                                    setDisconnectingProvider(null)
                                  }}
                                  class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                  style={{ background: "var(--surface-raised)", color: "var(--interactive-critical)" }}
                                >
                                  <Show when={disconnecting()} fallback={<X class="w-3 h-3" />}>
                                    <Spinner class="w-3 h-3" />
                                  </Show>
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              </section>

              {/* Add Provider */}
              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="px-4 py-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Add Provider
                  </h2>
                </div>
                <div class="p-4">
                  {/* Success/Error messages at top */}
                  <Show when={success()}>
                    <div
                      class="mb-4 p-3 rounded-md text-sm flex items-center justify-between"
                      style={{
                        background: "var(--surface-inset)",
                        border: "1px solid var(--border-base)",
                        "border-left": "3px solid var(--icon-success-base)",
                        color: "var(--icon-success-base)",
                      }}
                    >
                      <span>{success()}</span>
                      <button onClick={() => setSuccess(null)} class="ml-2">
                        <X class="w-4 h-4" />
                      </button>
                    </div>
                  </Show>

                  <Show when={error()}>
                    <div
                      class="mb-4 p-3 rounded-md text-sm flex items-center justify-between"
                      style={{
                        background: "var(--surface-inset)",
                        border: "1px solid var(--border-base)",
                        "border-left": "3px solid var(--interactive-critical)",
                        color: "var(--interactive-critical)",
                      }}
                    >
                      <span>{error()}</span>
                      <button onClick={() => setError(null)} class="ml-2">
                        <X class="w-4 h-4" />
                      </button>
                    </div>
                  </Show>

                  {/* OAuth Pending - show prominently at top */}
                  <Show when={oauthPending()}>
                    {(pending) => (
                      <div
                        class="mb-4 p-4 rounded-lg"
                        style={{
                          background: "var(--surface-inset)",
                          border: "1px solid var(--border-base)",
                        }}
                      >
                        <div class="flex items-center justify-between mb-3">
                          <span class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                            Connecting to {pending().providerName}
                          </span>
                          <Show when={!connecting()}>
                            <button
                              onClick={cancelOAuth}
                              class="text-xs px-2 py-1 rounded"
                              style={{ color: "var(--text-weak)" }}
                            >
                              Cancel
                            </button>
                          </Show>
                        </div>

                        <Show when={pending().authUrl}>
                          <div class="mb-3 space-y-2">
                            <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                              {pending().requiresReplay
                                ? "After you sign in, copy the full callback URL from your browser and paste it below."
                                : "Open the auth page, enter the code shown there, and paste the code on auth page."}
                            </p>
                            <Show when={pending().code && !pending().requiresReplay}>
                              <div>
                                <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                                  Use this code on the auth page.
                                </div>
                                <div class="flex items-center gap-2">
                                  <code
                                    class="text-2xl font-mono font-bold tracking-wider px-4 py-2 rounded"
                                    style={{
                                      background: "var(--background-base)",
                                      color: "var(--text-strong)",
                                      border: "1px solid var(--border-base)",
                                    }}
                                  >
                                    {pending().code}
                                  </code>
                                  <button
                                    onClick={copyCode}
                                    class="p-2 rounded transition-colors"
                                    style={{
                                      background: "var(--background-base)",
                                      border: "1px solid var(--border-base)",
                                      color: codeCopied() ? "var(--icon-success-base)" : "var(--icon-base)",
                                    }}
                                    title="Copy code"
                                  >
                                    <Show when={codeCopied()} fallback={<Copy class="w-4 h-4" />}>
                                      <Check class="w-4 h-4" />
                                    </Show>
                                  </button>
                                </div>
                              </div>
                            </Show>

                            <button
                              type="button"
                              onClick={openOAuthTab}
                              class="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                              style={{
                                background: "var(--interactive-base)",
                                color: "white",
                              }}
                            >
                              {pending().requiresReplay ? "Open auth tab" : "Open auth page"}
                            </button>
                          </div>
                        </Show>

                        {/* Auto method - show waiting spinner */}
                        <Show when={pending().method === "auto"}>
                          <div class="flex items-center gap-2">
                            <Spinner class="w-4 h-4" />
                            <span class="text-sm" style={{ color: "var(--text-weak)" }}>
                              Waiting for authorization...
                            </span>
                          </div>
                        </Show>

                        {/* Code / replay method - show callback URL input */}
                        <Show when={pending().method === "code"}>
                          <div class="space-y-2">
                            <div class="text-xs" style={{ color: "var(--text-weak)" }}>
                              {pending().requiresReplay ? "Paste the full callback URL from your browser:" : "Paste the code from the auth page:"}
                            </div>
                            <input
                              type="text"
                              value={oauthCode()}
                              onInput={(e) => setOauthCode(e.currentTarget.value)}
                              placeholder={pending().requiresReplay ? "Paste callback URL here..." : "Paste code here..."}
                              class="w-full px-3 py-2 rounded-md text-sm font-mono"
                              style={{
                                background: "var(--background-base)",
                                border: "1px solid var(--border-base)",
                                color: "var(--text-base)",
                              }}
                            />
                            <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                              {pending().requiresReplay
                                ? "We will replay the callback URL to the backend listener, including state."
                                : "Paste the code shown on the auth page to complete authentication."}
                            </p>
                            <button
                              type="button"
                              disabled={connecting() || (pending().requiresReplay ? !normalizeOAuthCallbackUrl(oauthCode()) : !oauthCode().trim())}
                              onClick={handleOAuthComplete}
                              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                              style={{
                                background: "var(--interactive-base)",
                                color: "white",
                              }}
                            >
                              <Show when={connecting()} fallback="Complete Authentication">
                                <Spinner class="w-4 h-4" />
                                Verifying...
                              </Show>
                            </button>
                          </div>
                        </Show>
                      </div>
                    )}
                  </Show>

                  <form onSubmit={handleConnect} class="space-y-4">
                    {/* Search and Provider Selection */}
                    <Show when={!oauthPending()}>
                      <div>
                        {/* Search input */}
                        <div class="relative mb-3">
                          <Search
                            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                            style={{ color: "var(--text-weak)" }}
                          />
                          <input
                            type="text"
                            value={providerSearch()}
                            onInput={(e) => setProviderSearch(e.currentTarget.value)}
                            placeholder="Search providers..."
                            class="w-full pl-9 pr-8 py-2 rounded-md text-sm"
                            style={{
                              background: "var(--background-base)",
                              border: "1px solid var(--border-base)",
                              color: "var(--text-base)",
                            }}
                          />
                          <Show when={providerSearch()}>
                            <button
                              type="button"
                              onClick={() => setProviderSearch("")}
                              class="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                              style={{ color: "var(--text-weak)" }}
                            >
                              <X class="w-4 h-4" />
                            </button>
                          </Show>
                        </div>

                        {/* Provider grid - max height with scroll */}
                        <div class="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                          <For each={filteredProviders()}>
                            {(provider) => (
                              <button
                                type="button"
                                onClick={() => setSelectedProvider(provider.id)}
                                class="p-3 rounded-md text-left transition-colors"
                                style={{
                                  border:
                                    selectedProvider() === provider.id
                                      ? "1px solid var(--interactive-base)"
                                      : "1px solid var(--border-base)",
                                  background:
                                    selectedProvider() === provider.id ? "var(--surface-inset)" : "transparent",
                                }}
                              >
                                <div class="flex items-center gap-2">
                                  <span class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                                    {provider.name}
                                  </span>
                                  <Show when={provider.id === "opencode"}>
                                    <span
                                      class="text-xs px-1.5 py-0.5 rounded"
                                      style={{
                                        background: "var(--interactive-base)",
                                        color: "white",
                                      }}
                                    >
                                      Recommended
                                    </span>
                                  </Show>
                                </div>
                                <div class="text-xs" style={{ color: "var(--text-weak)" }}>
                                  {Object.keys(provider.models).length} models
                                </div>
                              </button>
                            )}
                          </For>
                        </div>

                        <Show when={filteredProviders().length === 0 && providerSearch()}>
                          <p class="text-sm text-center py-4" style={{ color: "var(--text-weak)" }}>
                            No providers found matching "{providerSearch()}"
                          </p>
                        </Show>
                      </div>
                    </Show>

                    {/* Auth Methods for Selected Provider */}
                    <Show when={selectedProvider() && !oauthPending()}>
                      <div class="space-y-3">
                        <label class="block text-sm font-medium" style={{ color: "var(--text-base)" }}>
                          Connect {getProviderDisplayName(selectedProvider()!)}
                        </label>

                        {/* Show auth method buttons */}
                        <Show
                          when={selectedProviderAuthMethods().length > 0}
                          fallback={
                            /* Fallback to API key input if no auth methods defined */
                            <div class="space-y-3">
                              <input
                                type="text"
                                value={accountName()}
                                onInput={(e) => setAccountName(e.currentTarget.value)}
                                placeholder="Account name (optional, e.g., work, personal)"
                                class="w-full px-3 py-2 rounded-md text-sm"
                                style={{
                                  background: "var(--background-base)",
                                  border: "1px solid var(--border-base)",
                                  color: "var(--text-base)",
                                }}
                              />
                              <input
                                type="password"
                                value={apiKey()}
                                onInput={(e) => setApiKey(e.currentTarget.value)}
                                placeholder="Enter your API key..."
                                class="w-full px-3 py-2 rounded-md text-sm"
                                style={{
                                  background: "var(--background-base)",
                                  border: "1px solid var(--border-base)",
                                  color: "var(--text-base)",
                                }}
                              />
                              <button
                                type="submit"
                                disabled={connecting() || !apiKey().trim()}
                                class="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                style={{
                                  background: "var(--interactive-base)",
                                  color: "white",
                                }}
                              >
                                <Show when={connecting()} fallback="Connect with API Key">
                                  <Spinner class="w-4 h-4" />
                                  Connecting...
                                </Show>
                              </button>
                            </div>
                          }
                        >
                          <div class="space-y-2">
                            <For each={selectedProviderAuthMethods()}>
                              {(method, index) => (
                                <Show
                                  when={method.type === "oauth"}
                                  fallback={
                                    /* API key method */
                                    <div class="space-y-2">
                                      <div
                                        class="flex items-center gap-2 text-xs"
                                        style={{ color: "var(--text-weak)" }}
                                      >
                                        <Key class="w-3 h-3" />
                                        <span>{method.label}</span>
                                      </div>
                                      <input
                                        type="text"
                                        value={accountName()}
                                        onInput={(e) => setAccountName(e.currentTarget.value)}
                                        placeholder="Account name (optional)"
                                        class="w-full px-3 py-2 rounded-md text-sm"
                                        style={{
                                          background: "var(--background-base)",
                                          border: "1px solid var(--border-base)",
                                          color: "var(--text-base)",
                                        }}
                                      />
                                      <input
                                        type="password"
                                        value={apiKey()}
                                        onInput={(e) => setApiKey(e.currentTarget.value)}
                                        placeholder="Enter your API key..."
                                        class="w-full px-3 py-2 rounded-md text-sm"
                                        style={{
                                          background: "var(--background-base)",
                                          border: "1px solid var(--border-base)",
                                          color: "var(--text-base)",
                                        }}
                                      />
                                      <button
                                        type="submit"
                                        disabled={connecting() || !apiKey().trim()}
                                        class="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                        style={{
                                          background: "var(--interactive-base)",
                                          color: "white",
                                        }}
                                      >
                                        <Show when={connecting()} fallback="Connect">
                                          <Spinner class="w-4 h-4" />
                                          Connecting...
                                        </Show>
                                      </button>
                                    </div>
                                  }
                                >
                                  {/* OAuth method */}
                                  <button
                                    type="button"
                                    disabled={connecting()}
                                    onClick={() => handleOAuthStart(selectedProvider()!, index())}
                                    class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                    style={{
                                      background: "var(--interactive-base)",
                                      color: "white",
                                    }}
                                  >
                                    <Show when={connecting()} fallback={<ExternalLink class="w-4 h-4" />}>
                                      <Spinner class="w-4 h-4" />
                                    </Show>
                                    {method.label}
                                  </button>
                                </Show>
                              )}
                            </For>
                          </div>
                        </Show>

                        <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                          Your credentials are stored securely and never shared.
                        </p>
                      </div>
                    </Show>
                  </form>
                </div>
              </section>

              <ProjectProvidersTab />
            </div>
          </Show>

          {/* Git Tab */}
          <Show when={activeTab() === "git"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Git Authentication
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Configure SSH keys to push and pull from remote repositories
                </p>
              </header>

              {/* SSH Key Section */}
              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="px-4 py-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    SSH Key
                  </h2>
                </div>
                <div class="p-4">
                  <Show when={sshKeyLoading()}>
                    <div class="flex items-center gap-2" style={{ color: "var(--text-weak)" }}>
                      <Spinner class="w-4 h-4" />
                      <span class="text-sm">Checking for SSH key...</span>
                    </div>
                  </Show>

                  <Show when={sshKeyError()}>
                    <div
                      class="p-3 rounded-md text-sm mb-4"
                      style={{
                        background: "var(--surface-inset)",
                        border: "1px solid var(--border-base)",
                        "border-left": "3px solid var(--interactive-critical)",
                        color: "var(--interactive-critical)",
                      }}
                    >
                      {sshKeyError()}
                    </div>
                  </Show>

                  {/* No keys found */}
                  <Show when={!sshKeyLoading() && sshKeys().length === 0}>
                    <div class="space-y-4">
                      <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                        No SSH keys found. Generate one using the terminal:
                      </p>

                      {/* Command to copy */}
                      <div class="relative">
                        <pre
                          class="p-3 rounded-md text-sm font-mono"
                          style={{
                            background: "var(--surface-inset)",
                            color: "var(--text-base)",
                          }}
                        >
                          ssh-keygen -t ed25519
                        </pre>
                        <button
                          onClick={copySshCommand}
                          class="absolute top-2 right-2 p-1.5 rounded transition-colors"
                          style={{
                            background: "var(--background-base)",
                            border: "1px solid var(--border-base)",
                            color: sshCommandCopied() ? "var(--icon-success-base)" : "var(--icon-base)",
                          }}
                          title="Copy command"
                        >
                          <Show when={sshCommandCopied()} fallback={<Copy class="w-4 h-4" />}>
                            <Check class="w-4 h-4" />
                          </Show>
                        </button>
                      </div>

                      <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                        Run this command in the terminal, then click Refresh.
                        <br />
                        To use an existing key, copy it to ~/.ssh/ via the terminal.
                      </p>

                      <Button onClick={loadSshKey} variant="secondary" size="sm">
                        Refresh
                      </Button>
                    </div>
                  </Show>

                  {/* Keys found */}
                  <Show when={!sshKeyLoading() && sshKeys().length > 0}>
                    <div class="space-y-4">
                      <div class="flex items-center gap-2 text-sm" style={{ color: "var(--text-base)" }}>
                        <Check class="w-4 h-4" style={{ color: "var(--icon-success-base)" }} />
                        <span>
                          {sshKeys().length} SSH key{sshKeys().length > 1 ? "s" : ""} found
                        </span>
                      </div>

                      {/* All Keys Display */}
                      <div class="space-y-3">
                        <For each={sshKeys()}>
                          {(key) => (
                            <div>
                              <label class="block text-sm font-medium mb-2" style={{ color: "var(--text-base)" }}>
                                {key.name}.pub
                              </label>
                              <div class="relative">
                                <pre
                                  class="p-3 rounded-md text-xs overflow-x-auto"
                                  style={{
                                    background: "var(--surface-inset)",
                                    color: "var(--text-base)",
                                    "word-break": "break-all",
                                    "white-space": "pre-wrap",
                                  }}
                                >
                                  {key.content}
                                </pre>
                                <button
                                  onClick={() => copySshKey(key.name, key.content)}
                                  class="absolute top-2 right-2 p-1.5 rounded transition-colors"
                                  style={{
                                    background: "var(--background-base)",
                                    border: "1px solid var(--border-base)",
                                    color:
                                      sshKeyCopied() === key.name ? "var(--icon-success-base)" : "var(--icon-base)",
                                  }}
                                  title="Copy to clipboard"
                                >
                                  <Show when={sshKeyCopied() === key.name} fallback={<Copy class="w-4 h-4" />}>
                                    <Check class="w-4 h-4" />
                                  </Show>
                                </button>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>

                      <Button onClick={loadSshKey} variant="secondary" size="sm">
                        Refresh
                      </Button>
                    </div>
                  </Show>
                </div>
              </section>

              {/* Instructions Section */}
              <section
                class="rounded-lg p-4"
                style={{
                  background: "var(--surface-inset)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <h3 class="text-sm font-medium mb-3" style={{ color: "var(--text-strong)" }}>
                  Add your key to a Git provider
                </h3>
                <div class="space-y-2 text-sm" style={{ color: "var(--text-weak)" }}>
                  <p>Copy your public key above and add it to:</p>
                  <ul class="list-disc list-inside space-y-1 ml-2">
                    <li>
                      <a
                        href="https://github.com/settings/ssh/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                        style={{ color: "var(--text-interactive-base)" }}
                      >
                        GitHub
                      </a>
                      {" → Settings → SSH and GPG keys → New SSH key"}
                    </li>
                    <li>
                      <a
                        href="https://gitlab.com/-/user_settings/ssh_keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                        style={{ color: "var(--text-interactive-base)" }}
                      >
                        GitLab
                      </a>
                      {" → Preferences → SSH Keys"}
                    </li>
                    <li>
                      <a
                        href="https://bitbucket.org/account/settings/ssh-keys/"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                        style={{ color: "var(--text-interactive-base)" }}
                      >
                        Bitbucket
                      </a>
                      {" → Personal settings → SSH keys"}
                    </li>
                  </ul>
                </div>
              </section>
            </div>
          </Show>

          {/* MCP Servers Tab */}
          <Show when={activeTab() === "mcp"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  MCP Servers
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Model Context Protocol servers extend AI capabilities with tools and resources
                </p>
              </header>

              {/* Server List */}
              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div
                  class="px-4 py-3 flex items-center justify-between"
                  style={{ "border-bottom": "1px solid var(--border-base)" }}
                >
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Configured Servers ({mcp.stats().enabled}/{mcp.stats().total} connected)
                  </h2>
                  <Button onClick={() => setShowMCPAddDialog(true)} variant="primary" size="sm">
                    + Add Server
                  </Button>
                </div>

                <Show when={mcp.loading()}>
                  <div class="p-6 flex items-center justify-center gap-2" style={{ color: "var(--text-weak)" }}>
                    <Spinner class="w-4 h-4" />
                    <span class="text-sm">Loading MCP servers...</span>
                  </div>
                </Show>

                <Show when={!mcp.loading() && Object.keys(mcp.servers).length === 0}>
                  <div class="p-6 text-center">
                    <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                      No MCP servers configured yet.
                    </p>
                    <button
                      onClick={() => setShowMCPAddDialog(true)}
                      class="mt-2 text-sm hover:underline"
                      style={{ color: "var(--text-interactive-base)" }}
                    >
                      Add your first server
                    </button>
                  </div>
                </Show>

                <Show when={!mcp.loading() && Object.keys(mcp.servers).length > 0}>
                  <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
                    <For each={Object.entries(mcp.servers).sort((a, b) => a[0].localeCompare(b[0]))}>
                      {([name, status]) => {
                        const isConnected = () => status.status === "connected"
                        const isFailed = () => status.status === "failed"
                        const needsAuth = () => status.status === "needs_auth"
                        const errorMsg = () => (status.status === "failed" ? (status as any).error : undefined)
                        const disabledByProject = () => mcp.projectOverrides()[name]?.enabled === false
                        const isActive = () => isConnected() && !disabledByProject()

                        return (
                          <div class="px-4 py-3 flex items-center justify-between gap-4">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                <span class="font-medium text-sm" style={{ color: "var(--text-strong)" }}>
                                  {name}
                                </span>
                                <span
                                  class="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--surface-inset)",
                                    color: isConnected()
                                      ? "var(--icon-success-base)"
                                      : isFailed()
                                        ? "var(--icon-critical-base)"
                                        : needsAuth()
                                          ? "var(--icon-warning-base)"
                                          : "var(--text-weak)",
                                  }}
                                >
                                  {status.status === "connected"
                                    ? "Connected"
                                    : status.status === "disabled"
                                      ? "Disabled"
                                      : status.status === "failed"
                                        ? "Failed"
                                        : status.status === "needs_auth"
                                          ? "Needs Auth"
                                          : status.status}
                                </span>
                                <Show when={mcpLoading() === name}>
                                  <Spinner class="w-3 h-3" />
                                </Show>
                              </div>
                              <Show when={errorMsg()}>
                                <p class="text-xs mt-0.5 truncate" style={{ color: "var(--text-weak)" }}>
                                  {errorMsg()}
                                </p>
                              </Show>
                            </div>

                            <div class="flex items-center gap-2">
                              <Show when={needsAuth()}>
                                <button
                                  onClick={async () => {
                                    setMcpLoading(name)
                                    const result = await mcp.startAuth(name)
                                    if (result?.authorizationUrl) {
                                      window.open(result.authorizationUrl, "_blank")
                                    }
                                    setMcpLoading(null)
                                  }}
                                  class="text-xs px-2 py-1 rounded"
                                  style={{
                                    background: "var(--surface-inset)",
                                    color: "var(--text-interactive-base)",
                                  }}
                                >
                                  Authenticate
                                </button>
                              </Show>

                              {/* Toggle Switch */}
                              <button
                                onClick={async () => {
                                  setMcpLoading(name)
                                  if (isConnected()) {
                                    await mcp.disconnect(name)
                                  } else {
                                    await mcp.connect(name)
                                  }
                                  setMcpLoading(null)
                                }}
                                disabled={mcpLoading() === name || mcpDeleting() === name || disabledByProject()}
                                title={disabledByProject() ? "Disabled for this project via Project Overrides" : undefined}
                                role="switch"
                                aria-checked={isActive()}
                                aria-label={`Toggle ${name} connection`}
                                class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50"
                                style={{
                                  background: isActive() ? "var(--interactive-base)" : "var(--surface-inset)",
                                }}
                              >
                                <div
                                  class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                                  style={{
                                    background: "var(--background-base)",
                                    left: isActive() ? "calc(100% - 18px)" : "2px",
                                  }}
                                />
                              </button>

                              {/* Delete Button */}
                              <Show when={capabilities().canUseLocalExtFileOps}>
                                <button
                                  onClick={() => {
                                    if (mcpLoading() || mcpDeleting()) return
                                    setMcpToDelete(name)
                                  }}
                                  disabled={mcpLoading() === name || mcpDeleting() === name}
                                  class="p-1 rounded transition-colors opacity-50 hover:opacity-100 disabled:opacity-30"
                                  style={{ color: "var(--icon-critical-base)" }}
                                  title="Remove server"
                                >
                                  <Trash2 class="w-4 h-4" />
                                </button>
                              </Show>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </section>

              {/* Project Overrides Section */}
              <Show when={directory && Object.keys(mcp.servers).length > 0}>
                <section
                  class="rounded-lg overflow-hidden"
                  style={{
                    background: "var(--background-base)",
                    border: "1px solid var(--border-base)",
                  }}
                >
                  <div
                    class="px-4 py-3"
                    style={{ "border-bottom": "1px solid var(--border-base)" }}
                  >
                    <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                      Project Overrides
                    </h2>
                    <p class="text-xs mt-0.5" style={{ color: "var(--text-weak)" }}>
                      Enable or disable globally configured servers for this project
                    </p>
                  </div>
                  <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
                    <For each={Object.entries(mcp.servers).sort((a, b) => a[0].localeCompare(b[0]))}>
                      {([name]) => {
                        const override = () => mcp.projectOverrides()[name]
                        const isEnabled = () => override()?.enabled ?? true
                        const isUpdating = () => mcp.isOverrideLoading(name)

                        return (
                          <div class="px-4 py-3 flex items-center justify-between gap-4">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                <span
                                  class="text-sm"
                                  style={{
                                    color: isEnabled() ? "var(--text-strong)" : "var(--text-weak)",
                                  }}
                                >
                                  {name}
                                </span>
                                <Show when={isUpdating()}>
                                  <Spinner class="w-3 h-3" />
                                </Show>
                                <Show when={!isEnabled() && !isUpdating()}>
                                  <span
                                    class="text-xs px-1.5 py-0.5 rounded"
                                    style={{
                                      background: "var(--surface-inset)",
                                      color: "var(--text-weak)",
                                    }}
                                  >
                                    Disabled for this project
                                  </span>
                                </Show>

                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                if (isEnabled()) {
                                  // Currently enabled: set an explicit override to disable
                                  await mcp.setProjectOverride(name, false)
                                } else {
                                  // Currently disabled via override: reset to default (enabled) state
                                  await mcp.resetProjectOverride(name)
                                }
                              }}
                              disabled={isUpdating()}
                              class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50"
                              style={{
                                background: isEnabled() ? "var(--interactive-base)" : "var(--surface-inset)",
                              }}
                              role="switch"
                              aria-checked={isEnabled()}
                              aria-label={`Toggle ${name} for this project`}
                            >
                              <div
                                class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                                style={{
                                  background: "var(--background-base)",
                                  left: isEnabled() ? "calc(100% - 18px)" : "2px",
                                }}
                              />
                            </button>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </section>
              </Show>

              {/* No project message for overrides */}
              <Show when={!directory}>
                <section
                  class="rounded-lg p-4"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border-base)",
                  }}
                >
                  <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                    Select a project to enable per-project MCP server overrides.
                  </p>
                </section>
              </Show>

              {/* Info Section */}
              <section
                class="rounded-lg p-4"
                style={{
                  background: "var(--surface-inset)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <h3 class="text-sm font-medium mb-2" style={{ color: "var(--text-strong)" }}>
                  About MCP
                </h3>
                <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                  The Model Context Protocol (MCP) allows AI assistants to access external tools, APIs, and data
                  sources. Servers can be local (running commands on your machine) or remote (connecting to hosted
                  services).
                </p>
                <a
                  href="https://modelcontextprotocol.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs mt-2 inline-block hover:underline"
                  style={{ color: "var(--text-interactive-base)" }}
                >
                  Learn more about MCP →
                </a>
              </section>
            </div>
          </Show>

          {/* Prompts Tab */}
          <Show when={activeTab() === "prompts"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Saved Prompts
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Create reusable prompts for quick access from the welcome screen or /prompt command
                </p>
              </header>

              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div
                  class="px-4 py-3 flex items-center justify-between"
                  style={{ "border-bottom": "1px solid var(--border-base)" }}
                >
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Prompts ({savedPrompts.prompts().length})
                  </h2>
                  <Button onClick={openAddPromptDialog} variant="primary" size="sm">
                    + Add Prompt
                  </Button>
                </div>

                <Show when={savedPrompts.prompts().length === 0}>
                  <div class="p-6 text-center">
                    <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                      No saved prompts yet.
                    </p>
                    <button
                      onClick={openAddPromptDialog}
                      class="mt-2 text-sm hover:underline"
                      style={{ color: "var(--text-interactive-base)" }}
                    >
                      Create your first prompt
                    </button>
                  </div>
                </Show>

                <Show when={savedPrompts.prompts().length > 0}>
                  <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
                    <For each={savedPrompts.prompts()}>
                      {(prompt) => (
                        <div class="px-4 py-3 flex items-start justify-between gap-4">
                          <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm" style={{ color: "var(--text-strong)" }}>
                              {prompt.title}
                            </div>
                            <p
                              class="text-xs mt-0.5 line-clamp-2"
                              style={{ color: "var(--text-weak)" }}
                            >
                              {prompt.text.length > 120 ? prompt.text.slice(0, 120) + "..." : prompt.text}
                            </p>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => openEditPromptDialog(prompt.id)}
                              class="p-1.5 rounded transition-colors"
                              style={{ color: "var(--text-weak)" }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--surface-inset)"
                                e.currentTarget.style.color = "var(--text-strong)"
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = "var(--text-weak)"
                              }}
                              title="Edit prompt"
                              aria-label="Edit prompt"
                            >
                              <Pencil class="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setPromptToDelete(prompt.id)}
                              class="p-1.5 rounded transition-colors opacity-50 hover:opacity-100"
                              style={{ color: "var(--icon-critical-base)" }}
                              title="Delete prompt"
                              aria-label="Delete prompt"
                            >
                              <Trash2 class="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>
          </Show>

          {/* Instructions Tab */}
          <Show when={activeTab() === "instructions"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Project Instructions
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Persistent instructions that are automatically included in every session for this project
                </p>
              </header>

              <Show when={!directory}>
                <section
                  class="rounded-lg overflow-hidden"
                  style={{
                    background: "var(--background-base)",
                    border: "1px solid var(--border-base)",
                  }}
                >
                  <div class="p-6 text-center space-y-2">
                    <BookOpen class="w-10 h-10 mx-auto" style={{ color: "var(--text-weak)", opacity: "0.5" }} />
                    <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                      Select a project to view and edit instructions.
                    </p>
                  </div>
                </section>
              </Show>

              <Show when={directory}>
                <Show when={instructionError()}>
                  <div
                    class="p-3 rounded-md text-sm"
                    style={{
                      background: "var(--surface-inset)",
                      border: "1px solid var(--border-base)",
                      "border-left": "3px solid var(--interactive-critical)",
                      color: "var(--interactive-critical)",
                    }}
                  >
                    {instructionError()}
                  </div>
                </Show>

                <Show when={instructionLoading()}>
                  <div class="flex items-center gap-2" style={{ color: "var(--text-weak)" }}>
                    <Spinner class="w-4 h-4" />
                    <span class="text-sm">Loading instructions...</span>
                  </div>
                </Show>

                {/* No instructions configured */}
                <Show when={!instructionLoading() && instructionPaths().length === 0}>
                  <section
                    class="rounded-lg overflow-hidden"
                    style={{
                      background: "var(--background-base)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    <div class="p-6 text-center space-y-4">
                      <BookOpen class="w-10 h-10 mx-auto" style={{ color: "var(--text-weak)", opacity: "0.5" }} />
                      <div>
                        <p class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                          No project instructions configured
                        </p>
                        <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                          Project instructions are defined in <code class="text-xs px-1 py-0.5 rounded" style={{ background: "var(--surface-inset)" }}>opencode.json</code> and included in every session automatically.
                        </p>
                      </div>
                      <Button
                        onClick={createInstructionsFile}
                        variant="primary"
                        size="sm"
                        disabled={instructionCreating()}
                      >
                        <Show when={instructionCreating()} fallback={
                          <>
                            <Plus class="w-4 h-4" />
                            Create Instructions File
                          </>
                        }>
                          <Spinner class="w-4 h-4" />
                          Creating...
                        </Show>
                      </Button>
                    </div>
                  </section>

                  <section
                    class="rounded-lg p-4"
                    style={{
                      background: "var(--surface-inset)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    <h3 class="text-sm font-medium mb-2" style={{ color: "var(--text-strong)" }}>
                      How instructions work
                    </h3>
                    <div class="text-xs space-y-2" style={{ color: "var(--text-weak)" }}>
                      <p>
                        Add an <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>instructions</code> field to your project's <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>opencode.json</code>:
                      </p>
                      <pre
                        class="p-3 rounded-md overflow-x-auto"
                        style={{ background: "var(--background-base)", color: "var(--text-base)" }}
                      >{`{
  "instructions": ["AGENTS.md", ".opencode/instructions/*.md"]
}`}</pre>
                      <p>
                        Each file path is resolved relative to the project root. The content is injected into the system prompt for every new session.
                      </p>
                    </div>
                  </section>
                </Show>

                {/* Instructions configured */}
                <Show when={!instructionLoading() && instructionPaths().length > 0}>
                  <For each={instructionPaths()}>
                    {(path) => {
                      const info = () => instructionContents()[path]
                      const edited = () => instructionEdits()[path]
                      const currentContent = () => edited() ?? info()?.content ?? ""
                      const isDirty = () => edited() !== undefined
                      const isSaving = () => instructionSaving() === path
                      const wasSaved = () => instructionSaved() === path

                      return (
                        <section
                          class="rounded-lg overflow-hidden"
                          style={{
                            background: "var(--background-base)",
                            border: "1px solid var(--border-base)",
                          }}
                        >
                          <div
                            class="px-4 py-3 flex items-center justify-between"
                            style={{ "border-bottom": "1px solid var(--border-base)" }}
                          >
                            <div class="flex items-center gap-2">
                              <BookOpen class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
                              <span class="text-sm font-medium font-mono" style={{ color: "var(--text-strong)" }}>
                                {path}
                              </span>
                              <Show when={info()?.exists === false}>
                                <span
                                  class="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--surface-inset)",
                                    color: "var(--icon-warning-base)",
                                  }}
                                >
                                  Missing
                                </span>
                              </Show>
                              <Show when={info()?.exists}>
                                <span
                                  class="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--surface-inset)",
                                    color: "var(--icon-success-base)",
                                  }}
                                >
                                  Active
                                </span>
                              </Show>
                            </div>
                            <div class="flex items-center gap-2">
                              <Show when={wasSaved()}>
                                <span class="text-xs flex items-center gap-1" style={{ color: "var(--icon-success-base)" }}>
                                  <Check class="w-3 h-3" /> Saved
                                </span>
                              </Show>
                              <Button
                                onClick={() => saveInstruction(path)}
                                variant="primary"
                                size="sm"
                                disabled={!isDirty() || isSaving()}
                              >
                                <Show when={isSaving()} fallback={
                                  <>
                                    <Save class="w-3.5 h-3.5" />
                                    Save
                                  </>
                                }>
                                  <Spinner class="w-3.5 h-3.5" />
                                  Saving...
                                </Show>
                              </Button>
                            </div>
                          </div>
                          <div class="p-4">
                            <textarea
                              value={currentContent()}
                              onInput={(e) => {
                                const val = e.currentTarget.value
                                setInstructionEdits((prev) => ({ ...prev, [path]: val }))
                              }}
                              rows={12}
                              class="w-full px-3 py-2 rounded-md text-sm font-mono resize-y"
                              style={{
                                background: "var(--surface-inset)",
                                border: "1px solid var(--border-base)",
                                color: "var(--text-base)",
                                "min-height": "160px",
                              }}
                              placeholder={info()?.exists === false ? "This file does not exist yet. Type content and save to create it." : "Enter instructions..."}
                            />
                          </div>
                        </section>
                      )
                    }}
                  </For>

                  <section
                    class="rounded-lg p-4"
                    style={{
                      background: "var(--surface-inset)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                      Instruction files are defined in your project's <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>opencode.json</code>. Changes take effect on the next session.
                    </p>
                  </section>
                </Show>
              </Show>
            </div>
          </Show>

          {/* Project Config Tab */}
          <Show when={activeTab() === "config"}>
            <ProjectConfigTab />
          </Show>

          {/* Model Fallback Tab */}
          <Show when={activeTab() === "fallback"}>
            <ProjectFallbackTab />
          </Show>

          {/* Skills Tab */}
          <Show when={activeTab() === "skills"}>
            <SkillSourcesTab />
          </Show>

          {/* Appearance Tab */}
          <Show when={activeTab() === "appearance"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Appearance
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Customize the look and feel of the interface
                </p>
              </header>

              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="px-4 py-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Theme
                  </h2>
                </div>
                <div class="p-4">
                  <div class="flex gap-2" role="group" aria-label="Theme selection">
                    <For each={[
                      { value: "light" as const, label: "Light", icon: () => <Sun class="w-4 h-4" /> },
                      { value: "dark" as const, label: "Dark", icon: () => <Moon class="w-4 h-4" /> },
                      { value: "system" as const, label: "System", icon: () => <Monitor class="w-4 h-4" /> },
                    ]}>
                      {(option) => (
                        <button
                          type="button"
                          aria-pressed={theme.theme() === option.value}
                          onClick={() => theme.setTheme(option.value)}
                          class="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                          style={{
                            background: theme.theme() === option.value ? "var(--interactive-base)" : "var(--surface-inset)",
                            color: theme.theme() === option.value ? "var(--background-base)" : "var(--text-base)",
                            border: theme.theme() === option.value ? "1px solid var(--interactive-base)" : "1px solid var(--border-base)",
                          }}
                        >
                          {option.icon()}
                          {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                  <p class="text-xs mt-3" style={{ color: "var(--text-weak)" }}>
                    {theme.theme() === "system"
                      ? `System preference detected: ${theme.resolved()}`
                      : `Current theme: ${theme.theme()}`}
                  </p>
                </div>
              </section>
            </div>
          </Show>

          {/* Sounds Tab */}
          <Show when={activeTab() === "sounds"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  Sound Notifications
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Play a sound when notification-worthy events occur (task complete, permission request, agent question)
                </p>
              </header>

              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="px-4 py-3 flex items-center justify-between" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Enable Sound
                  </h2>
                  <button
                    onClick={() => {
                      const enabling = !soundSettings().enabled
                      updateSoundSettings({ enabled: enabling })
                      if (enabling) primeAudioContext()
                    }}
                    class="relative w-10 h-5 rounded-full transition-colors"
                    style={{
                      background: soundSettings().enabled ? "var(--interactive-base)" : "var(--surface-inset)",
                    }}
                    role="switch"
                    aria-checked={soundSettings().enabled}
                    aria-label="Enable sound notifications"
                  >
                    <div
                      class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                      style={{
                        background: "var(--background-base)",
                        left: soundSettings().enabled ? "calc(100% - 18px)" : "2px",
                      }}
                    />
                  </button>
                </div>

                <div class="p-4">
                  <p class="text-xs mb-3" style={{ color: "var(--text-weak)" }}>
                    Sound only plays for sessions with the bell icon enabled. Enable the bell on individual sessions from the chat header.
                  </p>

                  <div class="space-y-2">
                    <label class="block text-sm font-medium" style={{ color: "var(--text-base)" }}>
                      Notification Sound
                    </label>
                    <div class="space-y-1">
                      <For each={SOUND_OPTIONS}>
                        {(option) => (
                          <label
                            for={`sound-option-${option.id}`}
                            class="flex items-center justify-between px-3 py-2 rounded-md transition-colors cursor-pointer"
                            style={{
                              background: soundSettings().sound === option.id ? "var(--surface-inset)" : "transparent",
                              border: soundSettings().sound === option.id ? "1px solid var(--interactive-base)" : "1px solid transparent",
                            }}
                            onMouseEnter={(e) => {
                              if (soundSettings().sound !== option.id) e.currentTarget.style.background = "var(--surface-inset)"
                            }}
                            onMouseLeave={(e) => {
                              if (soundSettings().sound !== option.id) e.currentTarget.style.background = "transparent"
                            }}
                          >
                            <div class="flex items-center gap-3">
                              <input
                                id={`sound-option-${option.id}`}
                                type="radio"
                                name="sound"
                                value={option.id}
                                checked={soundSettings().sound === option.id}
                                class="accent-[var(--interactive-base)]"
                                onChange={(e) => {
                                  e.stopPropagation()
                                  updateSoundSettings({ sound: option.id })
                                  playSound(option.id)
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span class="text-sm" style={{ color: "var(--text-base)" }}>{option.label}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                playSound(option.id)
                              }}
                              class="p-1 rounded transition-colors"
                              style={{ color: "var(--icon-weak)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--icon-base)")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--icon-weak)")}
                              title={`Preview ${option.label}`}
                              aria-label={`Preview ${option.label} sound`}
                            >
                              <Play class="w-4 h-4" />
                            </button>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </Show>

          {/* Servers Tab */}
          <Show when={activeTab() === "servers"}>
            <div class="space-y-6">
              <header>
                <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
                  OpenCode Backends
                </h1>
                <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
                  Manage connections to multiple OpenCode backend endpoints
                </p>
              </header>

              <section
                class="rounded-lg overflow-hidden"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div
                  class="px-4 py-3 flex items-center justify-between"
                  style={{ "border-bottom": "1px solid var(--border-base)" }}
                >
                  <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    Servers ({servers().length})
                  </h2>
                  <Button onClick={openAddServerDialog} variant="primary" size="sm">
                    + Add Server
                  </Button>
                </div>

                <Show when={servers().length === 0}>
                  <div class="p-6 text-center">
                    <p class="text-sm" style={{ color: "var(--text-weak)" }}>
                      No servers configured yet.
                    </p>
                    <button
                      onClick={openAddServerDialog}
                      class="mt-2 text-sm hover:underline"
                      style={{ color: "var(--text-interactive-base)" }}
                    >
                      Add your first server
                    </button>
                  </div>
                </Show>

                <Show when={servers().length > 0}>
                  <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
                    <For each={servers()}>
                      {(server) => (
                        <div class="px-4 py-3 flex items-center justify-between gap-4">
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="font-medium text-sm" style={{ color: "var(--text-strong)" }}>
                                {server.name}
                              </span>
                              <Show when={server.isDefault}>
                                <span
                                  class="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--interactive-base)",
                                    color: "white",
                                  }}
                                >
                                  Default
                                </span>
                              </Show>
                            </div>
                            <p class="text-xs mt-0.5 truncate" style={{ color: "var(--text-weak)" }}>
                              {server.url}
                            </p>
                          </div>
                          <div class="flex items-center gap-2">
                            <Show when={!server.isDefault}>
                              <button
                                onClick={() => toggleServerDefault(server.id)}
                                class="text-xs px-2 py-1 rounded"
                                style={{
                                  background: "var(--surface-inset)",
                                  color: "var(--text-base)",
                                }}
                              >
                                Set Default
                              </button>
                            </Show>
                            <button
                              onClick={() => openEditServerDialog(server)}
                              class="p-1.5 rounded transition-colors"
                              style={{ color: "var(--text-weak)" }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--surface-inset)"
                                e.currentTarget.style.color = "var(--text-strong)"
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = "var(--text-weak)"
                              }}
                              title="Edit server"
                            >
                              <Pencil class="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => confirmServerDelete(server.id)}
                              class="p-1.5 rounded transition-colors opacity-50 hover:opacity-100"
                              style={{ color: "var(--icon-critical-base)" }}
                              title="Delete server"
                            >
                              <Trash2 class="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              <section
                class="rounded-lg p-4"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <h3 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                      Local Service
                    </h3>
                    <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>
                      Restart the local s6-managed opencode service behind this UI. Remote backends are not affected.
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={restartState() !== "idle"}>
                      <span
                        class="text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 font-medium"
                        style={{
                          background: restartState() === "ready" ? "#059669" : restartState() === "error" ? "var(--surface-inset)" : "var(--background-base)",
                          color: restartState() === "ready" ? "white" : restartState() === "error" ? "var(--interactive-critical)" : "var(--text-weak)",
                          border: restartState() === "ready" ? "1px solid #059669" : "1px solid var(--border-base)",
                        }}
                      >
                        <Show when={restartState() === "ready"}>
                          <Check class="w-3 h-3" />
                        </Show>
                        {restartState() === "restarting"
                          ? "Restarting"
                          : restartState() === "checking"
                            ? "Checking"
                            : restartState() === "ready"
                              ? "Ready"
                              : "Error"}
                      </span>
                    </Show>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setShowRestartConfirm(true)}
                      disabled={restartLoading() || restartChecking()}
                    >
                      {restartLoading() ? "Restarting..." : restartChecking() ? "Checking..." : "Restart opencode"}
                    </Button>
                  </div>
                </div>
                <Show when={restartInfo()}>
                  <p class="text-xs mt-3" style={{ color: "var(--text-weak)" }}>
                    {restartInfo()}
                  </p>
                </Show>
                <Show when={restartError()}>
                  <p class="text-xs mt-3" style={{ color: "var(--text-critical-base)" }}>
                    {restartError()}
                  </p>
                </Show>
                <Show when={restartSuccess()}>
                  <p class="text-xs mt-3" style={{ color: "var(--text-success-base)" }}>
                    {restartSuccess()}
                  </p>
                </Show>
              </section>

              <section
                class="rounded-lg p-4"
                style={{
                  background: "var(--surface-inset)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <h3 class="text-sm font-medium mb-2" style={{ color: "var(--text-strong)" }}>
                  About Servers
                </h3>
                <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                  Add multiple OpenCode backends to switch between them. Each backend maintains its own sessions, projects, and server-scoped UI state.
                </p>
              </section>
            </div>
          </Show>

          <Show when={activeTab() === "quota"}>
            <div class="space-y-6">
              <QuotaContent />
            </div>
          </Show>
        </div>
      </div>

      {/* MCP Add Dialog */}
      <Show when={showMCPAddDialog()}>
        <MCPAddDialog onClose={() => setShowMCPAddDialog(false)} onBack={() => setShowMCPAddDialog(false)} />
      </Show>

      {/* MCP Delete Confirmation */}
      <ConfirmDialog
        open={!!mcpToDelete()}
        title="Remove MCP Server"
        message={`Are you sure you want to remove "${mcpToDelete()}"?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmMcpDelete}
        onCancel={() => setMcpToDelete(null)}
      />

      {/* Prompt Add/Edit Dialog */}
      <Show when={promptDialogOpen()}>
        <PromptDialog
          editing={editingPromptId()}
          title={promptTitle}
          setTitle={setPromptTitle}
          text={promptText}
          setText={setPromptText}
          onSave={savePromptDialog}
          onClose={() => setPromptDialogOpen(false)}
        />
      </Show>

      {/* Prompt Delete Confirmation */}
      <ConfirmDialog
        open={!!promptToDelete()}
        title="Delete Prompt"
        message="Are you sure you want to delete this saved prompt?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmPromptDelete}
        onCancel={() => setPromptToDelete(null)}
      />

      <ConfirmDialog
        open={showRestartConfirm()}
        title="Restart OpenCode"
        message="This will restart the local opencode service and briefly disconnect active sessions and requests."
        confirmLabel={restartLoading() ? "Restarting..." : "Restart"}
        cancelLabel="Cancel"
        confirmDisabled={restartLoading() || restartChecking()}
        cancelDisabled={restartLoading() || restartChecking()}
        error={restartError()}
        onConfirm={confirmRestartOpencode}
        onCancel={() => {
          if (!restartLoading() && !restartChecking()) {
            setShowRestartConfirm(false)
            setRestartError(null)
          }
        }}
      />

      {/* Server Add/Edit Dialog */}
      <Portal>
        <Show when={showServerDialog()}>
          <div
            class="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeServerDialog()
              }
            }}
          >
            <div
              class="w-full max-w-md rounded-lg p-6"
              style={{
                background: "var(--background-base)",
                border: "1px solid var(--border-base)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 class="text-lg font-medium mb-4" style={{ color: "var(--text-strong)" }}>
                {editingServer() ? "Edit Server" : "Add Server"}
              </h2>

              <Show when={serverError()}>
                <div
                  class="mb-4 p-3 rounded-md text-sm"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border-base)",
                    "border-left": "3px solid var(--interactive-critical)",
                    color: "var(--interactive-critical)",
                  }}
                >
                  {serverError()}
                </div>
              </Show>

              <Show when={serverWarn()}>
                <div
                  class="mb-4 p-3 rounded-md text-sm"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border-base)",
                    "border-left": "3px solid var(--interactive-warning)",
                    color: "var(--interactive-warning)",
                  }}
                >
                  {serverWarn()}
                </div>
              </Show>

              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={serverNameInput()}
                    onInput={(e) => setServerNameInput(e.currentTarget.value)}
                    placeholder="e.g., Production, Dev, Local"
                    class="w-full px-3 py-2 rounded-md text-sm"
                    style={{
                      background: "var(--background-base)",
                      border: "1px solid var(--border-base)",
                      color: "var(--text-base)",
                    }}
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                    Server URL
                  </label>
                  <input
                    type="text"
                    value={serverUrlInput()}
                    onInput={(e) => setServerUrlInput(e.currentTarget.value)}
                    placeholder="e.g., http://localhost:4096"
                    class="w-full px-3 py-2 rounded-md text-sm"
                    style={{
                      background: "var(--background-base)",
                      border: "1px solid var(--border-base)",
                      color: "var(--text-base)",
                    }}
                  />
                  <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>
                    The base URL of your OpenCode backend
                  </p>
                </div>
                <div class="flex gap-2">
                  <div class="flex-1">
                    <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                      Username (optional)
                    </label>
                    <input
                      type="text"
                      value={serverUsernameInput()}
                      onInput={(e) => setServerUsernameInput(e.currentTarget.value)}
                      placeholder="opencode"
                      class="w-full px-3 py-2 rounded-md text-sm"
                      style={{
                        background: "var(--background-base)",
                        border: "1px solid var(--border-base)",
                        color: "var(--text-base)",
                      }}
                    />
                  </div>
                  <div class="flex-1">
                    <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                      Password
                    </label>
                    <input
                      type="password"
                      value={serverPasswordInput()}
                      onInput={(e) => setServerPasswordInput(e.currentTarget.value)}
                      placeholder="Leave blank for no auth"
                      class="w-full px-3 py-2 rounded-md text-sm"
                      style={{
                        background: "var(--background-base)",
                        border: "1px solid var(--border-base)",
                        color: "var(--text-base)",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div class="flex justify-end gap-2 mt-6">
                <Button onClick={closeServerDialog} variant="secondary" disabled={serverChecking()}>
                  Cancel
                </Button>
                <Button
                  onClick={saveServerDialog}
                  variant="primary"
                  disabled={!serverNameInput().trim() || !serverUrlInput().trim() || serverChecking()}
                >
                  {serverChecking() ? "Checking..." : editingServer() ? "Save" : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </Show>
      </Portal>
    </div>
  )
}

// ── Known permission tools with human-friendly labels ──
// supportsPatterns: true for PermissionRuleConfig tools (allow pattern-specific rules),
// false for PermissionActionConfig-only tools (only allow/ask/deny globally)
const PERMISSION_TOOLS = [
  { key: "read", label: "Read Files", supportsPatterns: true },
  { key: "edit", label: "Edit Files", supportsPatterns: true },
  { key: "bash", label: "Bash Commands", supportsPatterns: true },
  { key: "glob", label: "Glob Search", supportsPatterns: true },
  { key: "grep", label: "Grep Search", supportsPatterns: true },
  { key: "list", label: "List Files", supportsPatterns: true },
  { key: "webfetch", label: "Web Fetch", supportsPatterns: false },
  { key: "task", label: "Task (Sub-agent)", supportsPatterns: true },
  { key: "todowrite", label: "Todo Write", supportsPatterns: false },
  { key: "todoread", label: "Todo Read", supportsPatterns: false },
  { key: "question", label: "Question", supportsPatterns: false },
  { key: "websearch", label: "Web Search", supportsPatterns: false },
  { key: "codesearch", label: "Code Search", supportsPatterns: false },
  { key: "lsp", label: "LSP", supportsPatterns: true },
  { key: "skill", label: "Skill", supportsPatterns: true },
] as const

// Known tools that can be toggled on/off
const TOGGLEABLE_TOOLS = [
  { key: "bash", label: "Bash" },
  { key: "webfetch", label: "Web Fetch" },
  { key: "websearch", label: "Web Search" },
  { key: "codesearch", label: "Code Search" },
  { key: "glob", label: "Glob" },
  { key: "grep", label: "Grep" },
  { key: "read", label: "Read" },
  { key: "edit", label: "Edit" },
  { key: "list", label: "List" },
  { key: "task", label: "Task" },
  { key: "todowrite", label: "Todo Write" },
  { key: "todoread", label: "Todo Read" },
  { key: "question", label: "Question" },
  { key: "lsp", label: "LSP" },
  { key: "skill", label: "Skill" },
] as const

const ACTION_OPTIONS: PermissionActionConfig[] = ["allow", "ask", "deny"]

function getPermissionAction(rule: unknown): PermissionActionConfig {
  if (rule === "allow" || rule === "ask" || rule === "deny") return rule
  if (typeof rule === "object" && rule !== null && "*" in rule) {
    const val = (rule as Record<string, unknown>)["*"]
    if (val === "allow" || val === "ask" || val === "deny") return val
  }
  return "ask"
}

function getPermissionPatterns(rule: unknown): Array<{ pattern: string; action: PermissionActionConfig }> {
  if (typeof rule !== "object" || rule === null) return []
  const patterns: Array<{ pattern: string; action: PermissionActionConfig }> = []
  for (const [k, v] of Object.entries(rule as Record<string, unknown>)) {
    if (k === "*" || k === "__originalKeys") continue
    if (v === "allow" || v === "ask" || v === "deny") {
      patterns.push({ pattern: k, action: v })
    }
  }
  return patterns
}

function ProjectConfigTab() {
  const config = useConfig()
  const { directory } = useSDK()
  const basePath = useBasePath()
  const server = useServer()
  const capabilities = () => getServerCapabilities(server.selectedServer())
  const [view, setView] = createSignal<"form" | "json">("form")
  const [jsonText, setJsonText] = createSignal("")
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [expandedPerms, setExpandedPerms] = createSignal<string | null>(null)
  const [newPatternTool, setNewPatternTool] = createSignal<string | null>(null)
  const [newPatternValue, setNewPatternValue] = createSignal("")
  const [newPatternAction, setNewPatternAction] = createSignal<PermissionActionConfig>("deny")

  // Sync JSON text from config only when switching into JSON view,
  // not on every reactive config update (which would overwrite in-progress edits).
  // Also clear errors on any view switch.
  let prevView: "form" | "json" = "form"
  createEffect(() => {
    const current = view()
    if (current !== prevView) {
      setSaveError(null)
      if (current === "json") {
        setJsonText(JSON.stringify(config.project, null, 2))
      }
    }
    prevView = current
  })

  let savedTimer: number | undefined
  function showSaved() {
    setSaveError(null)
    setSaved(true)
    if (savedTimer !== undefined) clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => setSaved(false), 2000)
  }
  onCleanup(() => {
    if (savedTimer !== undefined) clearTimeout(savedTimer)
  })

  // ── Permission handlers ──

  // When permission is a global string (e.g. "ask"), normalize to object
  // preserving the default for all tools so per-tool edits don't drop it
  function getPermissionObject(): Record<string, unknown> {
    const perm = config.project.permission
    if (typeof perm === "string") {
      // Convert global string to per-tool object. Include all SDK-known tools
      // (not just those in our UI) so tools like external_directory, doom_loop
      // retain the global default when we patch a single tool.
      const allKeys = [
        ...PERMISSION_TOOLS.map((t) => t.key),
        "external_directory", "doom_loop",
      ]
      const obj: Record<string, unknown> = {}
      for (const k of allKeys) obj[k] = perm
      return obj
    }
    if (typeof perm === "object" && perm !== null) return perm as Record<string, unknown>
    return {}
  }

  const ACTION_ONLY_TOOLS: Set<string> = new Set(
    PERMISSION_TOOLS.filter((t) => !t.supportsPatterns).map((t) => t.key),
  )

  async function setPermissionDefault(tool: string, action: PermissionActionConfig) {
    setSaving(true)
    const permObj = getPermissionObject()

    // Action-only tools (PermissionActionConfig) must always be a plain string;
    // discard any pattern object that may exist from manual edits or older configs.
    if (ACTION_ONLY_TOOLS.has(tool)) {
      const patch: Config = {
        permission: { ...permObj, [tool]: action } as Config["permission"],
      }
      const result = await config.updateProject(patch)
      setSaving(false)
      if (result) showSaved()
      return
    }

    const currentRule = permObj[tool]
    const patterns = getPermissionPatterns(currentRule)

    // Build the new rule: if there are patterns, keep them. Otherwise just use the action string.
    const newRule = patterns.length > 0
      ? { "*": action, ...Object.fromEntries(patterns.map((p) => [p.pattern, p.action])) }
      : action

    const patch: Config = {
      permission: { ...permObj, [tool]: newRule } as Config["permission"],
    }
    const result = await config.updateProject(patch)
    setSaving(false)
    if (result) showSaved()
  }

  const RESERVED_PATTERN_KEYS = new Set(["*", "__originalKeys"])

  async function addPermissionPattern(tool: string, pattern: string, action: PermissionActionConfig) {
    const trimmed = pattern.trim()
    if (!trimmed || RESERVED_PATTERN_KEYS.has(trimmed)) return
    setSaving(true)
    const permObj = getPermissionObject()
    const currentRule = permObj[tool]
    const defaultAction = getPermissionAction(currentRule)
    const existingPatterns = getPermissionPatterns(currentRule)

    const newRule = {
      "*": defaultAction,
      ...Object.fromEntries(existingPatterns.map((p) => [p.pattern, p.action])),
      [trimmed]: action,
    }

    const patch: Config = {
      permission: { ...permObj, [tool]: newRule } as Config["permission"],
    }
    const result = await config.updateProject(patch)
    setSaving(false)
    if (result) {
      setNewPatternTool(null)
      setNewPatternValue("")
      setNewPatternAction("deny")
      showSaved()
    }
  }

  async function removePermissionPattern(tool: string, pattern: string) {
    setSaving(true)
    const permObj = getPermissionObject()
    const currentRule = permObj[tool]
    const defaultAction = getPermissionAction(currentRule)
    const existingPatterns = getPermissionPatterns(currentRule).filter((p) => p.pattern !== pattern)

    const newRule = existingPatterns.length > 0
      ? { "*": defaultAction, ...Object.fromEntries(existingPatterns.map((p) => [p.pattern, p.action])) }
      : defaultAction

    const patch: Config = {
      permission: { ...permObj, [tool]: newRule } as Config["permission"],
    }
    const result = await config.updateProject(patch)
    setSaving(false)
    if (result) showSaved()
  }

  function configFilePath() {
    if (!directory) return null
    return `${directory.replace(/\/$/, "")}/opencode.json`
  }

  // Write the full config to opencode.json directly (used when clearing keys
  // or full-file saves, since the PATCH API cannot delete keys via deep-merge)
  async function writeConfigFile(content: string): Promise<boolean> {
    if (!capabilities().canEditLocalInstructionFiles) {
      setSaving(false)
      setSaveError("Writing opencode.json directly is available only for the local OpenCode backend.")
      return false
    }
    const path = configFilePath()
    if (!path) {
      setSaving(false)
      return false
    }
    const ok = await writeFile(basePath.serverUrl, path, content)
    setSaving(false)
    if (ok) {
      await config.refresh()
      showSaved()
      return true
    }
    setSaveError("Failed to write opencode.json. Changes were not saved.")
    return false
  }

  // ── Tool toggle handlers ──

  async function toggleTool(tool: string, enabled: boolean) {
    setSaving(true)
    const currentTools = (config.project.tools as Record<string, boolean> | undefined) ?? {}
    const patch: Config = {
      tools: { ...currentTools, [tool]: enabled },
    }
    const result = await config.updateProject(patch)
    setSaving(false)
    if (result) showSaved()
  }

  function isToolEnabled(tool: string): boolean {
    const tools = config.project.tools as Record<string, boolean> | undefined
    if (!tools || tools[tool] === undefined) return true // enabled by default
    return tools[tool]
  }

  // ── JSON save handler ──

  async function saveJson() {
    const text = jsonText()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setSaveError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      setSaveError("Config must be a JSON object at the top level.")
      return
    }
    setSaveError(null)
    setSaving(true)
    // Write the full file directly so removed keys are actually deleted
    await writeConfigFile(text)
  }

  return (
    <div class="space-y-6">
      <header>
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
              Project Config
            </h1>
            <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
              Configure permissions, model defaults, and tool access for this project
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Show when={saving()}>
              <Spinner class="w-4 h-4" />
            </Show>
            <Show when={saved()}>
              <span class="text-xs flex items-center gap-1" style={{ color: "var(--icon-success-base)" }}>
                <Check class="w-3 h-3" /> Saved
              </span>
            </Show>
          </div>
        </div>
        {/* Scope indicator */}
        <div
          class="mt-3 flex items-center gap-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--surface-inset)",
            color: "var(--text-weak)",
            border: "1px solid var(--border-base)",
          }}
        >
          <Info class="w-3.5 h-3.5 shrink-0" />
          <span>
            Saved to <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>opencode.json</code> in your project
            {directory ? ` (${directory})` : ""}
          </span>
        </div>
      </header>

      {/* View toggle */}
      <div class="flex gap-1 p-1 rounded-md" style={{ background: "var(--surface-inset)" }}>
        <button
          onClick={() => setView("form")}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          style={{
            background: view() === "form" ? "var(--background-base)" : "transparent",
            color: view() === "form" ? "var(--text-strong)" : "var(--text-weak)",
            "box-shadow": view() === "form" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
          }}
        >
          <Settings2 class="w-3.5 h-3.5" />
          Form
        </button>
        <button
          onClick={() => setView("json")}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          style={{
            background: view() === "json" ? "var(--background-base)" : "transparent",
            color: view() === "json" ? "var(--text-strong)" : "var(--text-weak)",
            "box-shadow": view() === "json" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
          }}
        >
          <Code class="w-3.5 h-3.5" />
          JSON
        </button>
      </div>

      <Show when={config.error()}>
        <div
          class="p-3 rounded-md text-sm"
          style={{
            background: "var(--surface-inset)",
            border: "1px solid var(--border-base)",
            "border-left": "3px solid var(--interactive-critical)",
            color: "var(--interactive-critical)",
          }}
        >
          {config.error()}
        </div>
      </Show>

      <Show when={saveError()}>
        <div
          class="p-3 rounded-md text-sm"
          style={{
            background: "var(--surface-inset)",
            border: "1px solid var(--border-base)",
            "border-left": "3px solid var(--interactive-critical)",
            color: "var(--interactive-critical)",
          }}
        >
          {saveError()}
        </div>
      </Show>

      <Show when={config.initialLoading()}>
        <div class="flex items-center gap-2" style={{ color: "var(--text-weak)" }}>
          <Spinner class="w-4 h-4" />
          <span class="text-sm">Loading configuration...</span>
        </div>
      </Show>

      {/* Form View */}
      <Show when={!config.initialLoading() && view() === "form"}>
        <div class="space-y-6">

          {/* Permissions Section */}
          <section
            class="rounded-lg overflow-hidden"
            style={{
              background: "var(--background-base)",
              border: "1px solid var(--border-base)",
            }}
          >
            <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
              <Shield class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                Permissions
              </h2>
            </div>
            <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
              <For each={PERMISSION_TOOLS}>
                {(tool) => {
                  const permission = () => {
                    const p = config.project.permission
                    if (typeof p === "string") return p
                    if (typeof p === "object" && p !== null) return (p as Record<string, unknown>)[tool.key]
                    return undefined
                  }
                  const action = () => getPermissionAction(permission())
                  const patterns = () => getPermissionPatterns(permission())
                  const expanded = () => expandedPerms() === tool.key

                  return (
                    <div class="px-4 py-3">
                      <div class="flex items-center justify-between">
                        <Show when={tool.supportsPatterns} fallback={
                          <span class="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                            {tool.label}
                          </span>
                        }>
                          <button
                            class="flex items-center gap-2 text-sm font-medium"
                            style={{ color: "var(--text-strong)" }}
                            onClick={() => setExpandedPerms(expanded() ? null : tool.key)}
                          >
                            <Show when={expanded()} fallback={<ChevronRight class="w-3.5 h-3.5" style={{ color: "var(--text-weak)" }} />}>
                              <ChevronDown class="w-3.5 h-3.5" style={{ color: "var(--text-weak)" }} />
                            </Show>
                            {tool.label}
                            <Show when={patterns().length > 0}>
                              <span
                                class="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: "var(--surface-inset)", color: "var(--text-weak)" }}
                              >
                                {patterns().length} rule{patterns().length > 1 ? "s" : ""}
                              </span>
                            </Show>
                          </button>
                        </Show>
                        {/* Default action segmented control */}
                        <div class="flex gap-0.5 p-0.5 rounded" style={{ background: "var(--surface-inset)" }}>
                          <For each={ACTION_OPTIONS}>
                            {(opt) => (
                              <button
                                onClick={() => setPermissionDefault(tool.key, opt)}
                                disabled={saving()}
                                class="px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize disabled:opacity-50"
                                style={{
                                  background: action() === opt ? actionColor(opt) : "transparent",
                                  color: action() === opt ? "white" : "var(--text-weak)",
                                }}
                              >
                                {opt}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      {/* Expanded: show patterns (only for tools that support pattern rules) */}
                      <Show when={expanded() && tool.supportsPatterns}>
                        <div class="mt-3 ml-5 space-y-2">
                          <Show when={patterns().length > 0}>
                            <div class="space-y-1">
                              <For each={patterns()}>
                                {(p) => (
                                  <div
                                    class="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                                    style={{ background: "var(--surface-inset)" }}
                                  >
                                    <code class="font-mono" style={{ color: "var(--text-base)" }}>{p.pattern}</code>
                                    <div class="flex items-center gap-2">
                                      <span
                                        class="px-1.5 py-0.5 rounded capitalize font-medium"
                                        style={{
                                          background: actionColor(p.action),
                                          color: "white",
                                        }}
                                      >
                                        {p.action}
                                      </span>
                                      <button
                                        onClick={() => removePermissionPattern(tool.key, p.pattern)}
                                        disabled={saving()}
                                        class="p-0.5 rounded transition-colors opacity-50 hover:opacity-100 disabled:opacity-30"
                                        style={{ color: "var(--icon-critical-base)" }}
                                        title="Remove rule"
                                      >
                                        <X class="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>

                          {/* Add pattern form */}
                          <Show when={newPatternTool() === tool.key} fallback={
                            <button
                              onClick={() => setNewPatternTool(tool.key)}
                              class="text-xs hover:underline"
                              style={{ color: "var(--text-interactive-base)" }}
                            >
                              + Add pattern rule
                            </button>
                          }>
                            <div class="flex items-center gap-2">
                              <input
                                type="text"
                                value={newPatternValue()}
                                onInput={(e) => setNewPatternValue(e.currentTarget.value)}
                                placeholder="e.g. *.env or src/**"
                                class="flex-1 px-2 py-1 rounded text-xs font-mono"
                                style={{
                                  background: "var(--background-base)",
                                  border: "1px solid var(--border-base)",
                                  color: "var(--text-base)",
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !saving()) {
                                    addPermissionPattern(tool.key, newPatternValue(), newPatternAction())
                                  }
                                  if (e.key === "Escape") {
                                    setNewPatternTool(null)
                                    setNewPatternValue("")
                                  }
                                }}
                              />
                              <select
                                value={newPatternAction()}
                                onChange={(e) => setNewPatternAction(e.currentTarget.value as PermissionActionConfig)}
                                class="px-2 py-1 rounded text-xs"
                                style={{
                                  background: "var(--background-base)",
                                  border: "1px solid var(--border-base)",
                                  color: "var(--text-base)",
                                }}
                              >
                                <For each={ACTION_OPTIONS}>
                                  {(opt) => <option value={opt}>{opt}</option>}
                                </For>
                              </select>
                              <Button
                                onClick={() => addPermissionPattern(tool.key, newPatternValue(), newPatternAction())}
                                variant="primary"
                                size="sm"
                                disabled={!newPatternValue().trim() || saving()}
                              >
                                Add
                              </Button>
                              <button
                                onClick={() => { setNewPatternTool(null); setNewPatternValue("") }}
                                class="p-1 rounded"
                                style={{ color: "var(--text-weak)" }}
                              >
                                <X class="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </section>

          
          {/* Tool Access Section */}
          <section
            class="rounded-lg overflow-hidden"
            style={{
              background: "var(--background-base)",
              border: "1px solid var(--border-base)",
            }}
          >
            <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
              <Wrench class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                Tool Access
              </h2>
            </div>
            <div class="divide-y" style={{ "border-color": "var(--border-base)" }}>
              <For each={TOGGLEABLE_TOOLS}>
                {(tool) => {
                  const enabled = () => isToolEnabled(tool.key)

                  return (
                    <div class="px-4 py-3 flex items-center justify-between">
                      <span class="text-sm" style={{ color: "var(--text-base)" }}>{tool.label}</span>
                      <button
                        onClick={() => toggleTool(tool.key, !enabled())}
                        disabled={saving()}
                        class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50"
                        role="switch"
                        aria-checked={enabled()}
                        aria-label={`Toggle ${tool.label} access`}
                        style={{
                          background: enabled() ? "var(--interactive-base)" : "var(--surface-inset)",
                        }}
                      >
                        <div
                          class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                          style={{
                            background: "var(--background-base)",
                            left: enabled() ? "calc(100% - 18px)" : "2px",
                          }}
                        />
                      </button>
                    </div>
                  )
                }}
              </For>
            </div>
          </section>

        </div>
      </Show>

      {/* JSON View */}
      <Show when={!config.initialLoading() && view() === "json"}>
        <section
          class="rounded-lg overflow-hidden"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
          }}
        >
          <div
            class="px-4 py-3 flex items-center justify-between"
            style={{ "border-bottom": "1px solid var(--border-base)" }}
          >
            <div class="flex items-center gap-2">
              <Code class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                opencode.json
              </h2>
            </div>
            <Button
              onClick={saveJson}
              variant="primary"
              size="sm"
              disabled={saving()}
            >
              <Show when={saving()} fallback={
                <>
                  <Save class="w-3.5 h-3.5" />
                  Save
                </>
              }>
                <Spinner class="w-3.5 h-3.5" />
                Saving...
              </Show>
            </Button>
          </div>

          <div class="p-4">
            <textarea
              value={jsonText()}
              onInput={(e) => {
                setJsonText(e.currentTarget.value)
                setSaveError(null)
              }}
              rows={20}
              class="w-full px-3 py-2 rounded-md text-sm font-mono resize-y"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-base)",
                color: "var(--text-base)",
                "min-height": "300px",
                "tab-size": "2",
              }}
              spellcheck={false}
            />
            <p class="text-xs mt-2" style={{ color: "var(--text-weak)" }}>
              Schema: <code class="px-1 py-0.5 rounded" style={{ background: "var(--surface-inset)" }}>https://opencode.ai/config.json</code>
            </p>
          </div>
        </section>
      </Show>

    </div>
  )
}

type FallbackRow = { id: string; value: string }

type FallbackRowsSetter = (value: FallbackRow[] | ((prev: FallbackRow[]) => FallbackRow[])) => void

function fallbackRows(order?: Array<string>) {
  return (order ?? []).map((value) => ({ id: generateUUID(), value }))
}

function fallbackOrder(rows: FallbackRow[]) {
  return Array.from(new Set(rows.map((row) => row.value.trim()).filter(Boolean)))
}

function SortableFallbackRow(props: {
  row: FallbackRow
  onRemove: () => void
  onValueChange: (value: string) => void
}) {
  const sortable = createSortable(props.row.id)
  return (
    <div
      use:sortable={sortable}
      class="group/drag flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
      classList={{ "opacity-35": sortable.isActiveDraggable }}
      style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 cursor-grab active:cursor-grabbing opacity-70 group-hover/drag:opacity-100"
        style={{ color: "var(--text-weak)" }}
        {...sortable.dragActivators}
      >
              <DragHandle class="h-4 w-4" />
      </button>

      <input
        value={props.row.value}
        onInput={(e) => props.onValueChange(e.currentTarget.value)}
        placeholder="provider/model"
        spellcheck={false}
        class="min-w-0 flex-1 rounded-md px-3 py-2 text-sm font-mono"
        style={{
          background: "var(--surface-inset)",
          border: "1px solid var(--border-base)",
          color: "var(--text-base)",
        }}
      />

      <button
        type="button"
        onClick={props.onRemove}
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors"
        style={{ color: "var(--text-weak)" }}
        title="Remove"
      >
        <Trash2 class="h-4 w-4" />
      </button>
    </div>
  )
}

function FallbackPolicySection(props: {
  title: string
  description: string
  info: JSX.Element
  rows: Accessor<FallbackRow[]>
  setRows: FallbackRowsSetter
  enabled: boolean
  setEnabled: (value: boolean) => void
  crossProvider: boolean
  setCrossProvider: (value: boolean) => void
  saving: Accessor<boolean>
  saved: Accessor<boolean>
  saveError: Accessor<string | null>
  onReset: () => void
  onSave: () => void
  saveLabel: string
}) {
  const providers = useProviders()
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [modelSearch, setModelSearch] = createSignal("")
  const [modelSearchOpen, setModelSearchOpen] = createSignal(false)
  const [modelSearchIndex, setModelSearchIndex] = createSignal(0)
  let modelSearchRef: HTMLInputElement | undefined

  const order = createMemo(() => fallbackOrder(props.rows()))
  const eligibleModels = createMemo(() => providers.eligibleModels().map((item) => ({
    ...item,
    value: `${item.providerID}/${item.modelID}`,
    label: `${item.providerName} / ${item.modelName}`,
  })))
  const currentModels = createMemo(() => eligibleModels().map((item) => item.value))
  const searchableModels = createMemo(() => {
    const q = modelSearch().trim().toLowerCase()
    const pool = eligibleModels().filter((item) => !order().includes(item.value))
    const top = pool.slice(0, 6)
    if (!q) return top

    const score = (item: { value: string; label: string; providerID: string; providerName: string; modelID: string; modelName: string }) => {
      const values = [item.value, item.label, item.providerID, item.providerName, item.modelID, item.modelName].map((value) => value.toLowerCase())
      let total = 0
      for (const value of values) {
        if (value === q) total += 100
        else if (value.startsWith(q)) total += 50
        else if (value.includes(q)) total += 10
      }
      return total
    }

    return [...pool]
      .filter((item) => [item.value, item.label, item.providerID, item.providerName, item.modelID, item.modelName].some((value) => value.toLowerCase().includes(q)))
      .sort((a, b) => score(b) - score(a) || a.providerIndex - b.providerIndex || a.modelIndex - b.modelIndex)
      .slice(0, 12)
  })

  function addRow(value = "") {
    props.setRows((prev) => [...prev, { id: generateUUID(), value }])
  }

  function addModel(value: string) {
    if (!value || order().includes(value)) return
    addRow(value)
  }

  function pickModel(value: string) {
    addModel(value)
    setModelSearch("")
    setModelSearchOpen(true)
    setModelSearchIndex(0)
    requestAnimationFrame(() => modelSearchRef?.focus())
  }

  function removeRow(id: string) {
    props.setRows((prev) => prev.filter((row) => row.id !== id))
  }

  function updateRow(id: string, value: string) {
    props.setRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)))
  }

  function reorderRows(fromId: string, toId: string) {
    props.setRows((prev) => {
      const ids = prev.map((row) => row.id)
      const from = ids.indexOf(fromId)
      const to = ids.indexOf(toId)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  function handleDragStart(event: SolidDragEvent) {
    const id = typeof event.draggable?.id === "string" ? event.draggable.id : null
    setDraggingId(id)
  }

  function handleDragEnd(event: SolidDragEvent) {
    const from = typeof event.draggable?.id === "string" ? event.draggable.id : null
    const to = event.droppable && typeof event.droppable.id === "string" ? event.droppable.id : null
    setDraggingId(null)
    if (!from || !to || from === to) return
    reorderRows(from, to)
  }

  function handleSearchKeyDown(event: KeyboardEvent) {
    const list = searchableModels()
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setModelSearchOpen(true)
      setModelSearchIndex((index) => Math.min(index + 1, Math.max(0, list.length - 1)))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setModelSearchOpen(true)
      setModelSearchIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === "Enter") {
      const selected = list[modelSearchIndex()]
      if (!selected) return
      event.preventDefault()
      pickModel(selected.value)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (modelSearch()) {
        setModelSearch("")
        setModelSearchIndex(0)
        return
      }
      setModelSearchOpen(false)
    }
  }

  return (
    <section
      class="rounded-lg overflow-hidden"
      style={{
        background: "var(--background-base)",
        border: "1px solid var(--border-base)",
      }}
    >
      <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
        <Shuffle class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
        <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
          {props.title}
        </h2>
      </div>
      <div class="p-4 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm" style={{ color: "var(--text-weak)" }}>
            {props.description}
          </p>
          <div class="flex items-center gap-2">
            <Show when={props.saving()}>
              <Spinner class="w-4 h-4" />
            </Show>
            <Show when={props.saved()}>
              <span class="text-xs flex items-center gap-1" style={{ color: "var(--icon-success-base)" }}>
                <Check class="w-3 h-3" /> Saved
              </span>
            </Show>
          </div>
        </div>

        <div
          class="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--surface-inset)",
            color: "var(--text-weak)",
            border: "1px solid var(--border-base)",
          }}
        >
          <Info class="w-3.5 h-3.5 shrink-0" />
          {props.info}
        </div>

        <Show when={props.saveError()}>
          <div
            class="p-3 rounded-md text-sm"
            style={{
              background: "var(--surface-inset)",
              border: "1px solid var(--border-base)",
              "border-left": "3px solid var(--interactive-critical)",
              color: "var(--interactive-critical)",
            }}
          >
            {props.saveError()}
          </div>
        </Show>

        <label class="flex items-center gap-3 text-sm" style={{ color: "var(--text-base)" }}>
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.setEnabled(e.currentTarget.checked)} />
          Enable automatic fallback
        </label>

        <label class="flex items-center gap-3 text-sm" style={{ color: "var(--text-base)" }}>
          <input type="checkbox" checked={props.crossProvider} onChange={(e) => props.setCrossProvider(e.currentTarget.checked)} />
          Allow switching providers
        </label>

        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <label class="block text-sm font-medium" style={{ color: "var(--text-base)" }}>
              Preferred fallback order
            </label>
            <button
              type="button"
              onClick={props.onReset}
              class="text-xs px-2 py-1 rounded-md"
              style={{ background: "var(--surface-inset)", color: "var(--text-weak)", border: "1px solid var(--border-base)" }}
            >
              Reset
            </button>
          </div>

          <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd} collisionDetector={closestCenter}>
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div class="space-y-2">
              <SortableProvider ids={props.rows().map((row) => row.id)}>
                <For each={props.rows()}>
                  {(row) => (
                    <SortableFallbackRow
                      row={row}
                      onRemove={() => removeRow(row.id)}
                      onValueChange={(value) => updateRow(row.id, value)}
                    />
                  )}
                </For>
              </SortableProvider>

              <Show when={props.rows().length === 0}>
                <div class="rounded-lg border border-dashed px-4 py-6 text-center" style={{ "border-color": "var(--border-base)", color: "var(--text-weak)" }}>
                  No fallback order yet. Add models below, then drag them into priority.
                </div>
              </Show>
            </div>

            <DragOverlay>
              <Show when={draggingId()}>
                {(id) => {
                  const item = () => props.rows().find((row) => row.id === id())
                  return (
                    <div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface-inset)", color: "var(--text-interactive-base)", border: "1px solid var(--border-base)", "box-shadow": "0 10px 24px rgba(0,0,0,0.16)" }}>
                      <DragHandle class="w-4 h-4" />
                      <span class="truncate font-mono">{item()?.value || "provider/model"}</span>
                    </div>
                  )
                }}
              </Show>
            </DragOverlay>
          </DragDropProvider>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow()}>
              <Plus class="w-4 h-4" />
              Add custom model
            </Button>
          </div>

          <div class="mt-3">
            <label class="block text-xs font-medium mb-1.5" style={{ color: "var(--text-weak)" }}>
              Search eligible models
            </label>
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-weak)" }} />
              <input
                ref={(el) => (modelSearchRef = el)}
                value={modelSearch()}
                onFocus={() => setModelSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setModelSearchOpen(false), 120)}
                onInput={(e) => {
                  setModelSearch(e.currentTarget.value)
                  setModelSearchOpen(true)
                  setModelSearchIndex(0)
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search provider or model name"
                class="w-full rounded-md py-2 pl-9 pr-3 text-sm"
                style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }}
              />
            </div>

            <Show when={modelSearchOpen()}>
              <div class="mt-2 overflow-hidden rounded-md border" style={{ background: "var(--background-base)", "border-color": "var(--border-base)" }}>
                <Show when={searchableModels().length > 0} fallback={<div class="px-3 py-2 text-sm" style={{ color: "var(--text-weak)" }}>No matching models found.</div>}>
                  <div class="max-h-56 overflow-auto py-1" role="listbox" aria-label="Eligible models">
                    <For each={searchableModels()}>
                      {(item, index) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={index() === modelSearchIndex()}
                          class="w-full px-3 py-2 text-left transition-colors"
                          style={{ background: index() === modelSearchIndex() ? "var(--surface-inset)" : "transparent", color: "var(--text-base)" }}
                          onMouseEnter={() => setModelSearchIndex(index())}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickModel(item.value)}
                        >
                          <div class="flex items-center justify-between gap-3">
                            <span class="min-w-0 truncate text-sm">{item.label}</span>
                            <code class="shrink-0 text-xs" style={{ color: "var(--text-weak)" }}>{item.value}</code>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          <p class="text-xs mt-2" style={{ color: "var(--text-weak)" }}>
            Drag the handle to reorder. Exact strings are saved to config; unknown or disconnected models are skipped at runtime.
          </p>
        </div>

        <Show when={currentModels().length > 0}>
          <div class="rounded-md p-3" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)" }}>
            <div class="text-xs font-medium mb-2" style={{ color: "var(--text-weak)" }}>
              Currently eligible models
            </div>
            <div class="flex flex-wrap gap-2">
              <For each={currentModels().slice(0, 12)}>
                {(item) => (
                  <span class="text-xs px-2 py-1 rounded-full" style={{ background: "var(--background-base)", color: "var(--text-base)", border: "1px solid var(--border-base)" }}>
                    {item}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="flex items-center gap-2 pt-1">
          <Button type="button" onClick={props.onSave} disabled={props.saving()}>
            <Save class="w-4 h-4" />
            {props.saveLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}

function ProjectFallbackTab() {
  const config = useConfig()
  const { directory } = useSDK()
  const { serverUrl } = useBasePath()
  const [fallbackSettings, { refetch: refetchFallbackSettings }] = createResource(() => serverUrl, loadFallbackSettings)
  const fallbackState = createMemo(() => resolveFallbackPolicies(fallbackSettings() ?? {}, directory, config.global.fallback, config.project.fallback))
  const [globalSaving, setGlobalSaving] = createSignal(false)
  const [globalSaved, setGlobalSaved] = createSignal(false)
  const [globalSaveError, setGlobalSaveError] = createSignal<string | null>(null)
  const [globalEnabled, setGlobalEnabled] = createSignal(true)
  const [globalCrossProvider, setGlobalCrossProvider] = createSignal(true)
  const [globalRows, setGlobalRows] = createSignal<FallbackRow[]>([])

  const [projectSaving, setProjectSaving] = createSignal(false)
  const [projectSaved, setProjectSaved] = createSignal(false)
  const [projectSaveError, setProjectSaveError] = createSignal<string | null>(null)
  const [projectRows, setProjectRows] = createSignal<FallbackRow[]>([])
  const [projectEnabled, setProjectEnabled] = createSignal(true)
  const [projectCrossProvider, setProjectCrossProvider] = createSignal(true)

  const hasProjectOverride = createMemo(() => fallbackState().hasProjectOverride)

  let globalSavedTimer: number | undefined
  let projectSavedTimer: number | undefined

  function showGlobalSaved() {
    setGlobalSaveError(null)
    setGlobalSaved(true)
    if (globalSavedTimer !== undefined) clearTimeout(globalSavedTimer)
    globalSavedTimer = window.setTimeout(() => setGlobalSaved(false), 2000)
  }

  function showProjectSaved() {
    setProjectSaveError(null)
    setProjectSaved(true)
    if (projectSavedTimer !== undefined) clearTimeout(projectSavedTimer)
    projectSavedTimer = window.setTimeout(() => setProjectSaved(false), 2000)
  }

  onCleanup(() => {
    if (globalSavedTimer !== undefined) clearTimeout(globalSavedTimer)
    if (projectSavedTimer !== undefined) clearTimeout(projectSavedTimer)
  })

  function syncGlobalFromSettings() {
    const current = fallbackState().global ?? {}
    setGlobalEnabled(current.enabled ?? true)
    setGlobalCrossProvider(current.cross_provider ?? true)
    setGlobalRows(fallbackRows(current.order))
    setGlobalSaveError(null)
  }

  function syncProjectFromSettings() {
    const current = fallbackState().project ?? fallbackState().global ?? {}
    setProjectEnabled(current.enabled ?? true)
    setProjectCrossProvider(current.cross_provider ?? true)
    setProjectRows(fallbackRows(current.order))
    setProjectSaveError(null)
  }

  createEffect(() => {
    if (fallbackSettings.loading) return
    syncGlobalFromSettings()
  })

  createEffect(() => {
    if (fallbackSettings.loading) return
    syncProjectFromSettings()
  })

  async function saveGlobalFallbackPolicy() {
    setGlobalSaving(true)
    setGlobalSaveError(null)
    try {
      await saveFallbackGlobalPolicy(serverUrl, {
        enabled: globalEnabled(),
        cross_provider: globalCrossProvider(),
        order: fallbackOrder(globalRows()),
      })
      await refetchFallbackSettings()
      showGlobalSaved()
    } catch {
      setGlobalSaveError("Failed to save global fallback settings")
    }
    setGlobalSaving(false)
  }

  async function saveProjectFallbackPolicy() {
    setProjectSaving(true)
    setProjectSaveError(null)

    if (!directory) {
      setProjectSaving(false)
      setProjectSaveError("A project directory is required to save a project override.")
      return
    }

    try {
      await saveFallbackProjectPolicy(serverUrl, directory, {
        enabled: projectEnabled(),
        cross_provider: projectCrossProvider(),
        order: fallbackOrder(projectRows()),
      })
      await refetchFallbackSettings()
      showProjectSaved()
    } catch {
      setProjectSaveError("Failed to save project fallback override")
    }
    setProjectSaving(false)
  }

  async function clearProjectFallbackOverride() {
    if (!directory) {
      setProjectSaveError("A project directory is required to clear a project override.")
      return
    }

    setProjectSaving(true)
    setProjectSaveError(null)
    try {
      await saveFallbackProjectPolicy(serverUrl, directory, null)
      await refetchFallbackSettings()
      showProjectSaved()
    } catch {
      setProjectSaveError("Failed to clear project fallback override")
    }
    setProjectSaving(false)
  }

  return (
    <div class="space-y-6">
      <header>
        <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
          Model Fallback
        </h1>
        <p class="mt-1 text-sm" style={{ color: "var(--text-weak)" }}>
          Set a global fallback default for every project, then override it only where a specific project needs different retry behavior.
        </p>
      </header>

      <FallbackPolicySection
        title="Global default"
        description="These fallback rules apply to every project unless that project saves its own override."
        info={<span>Saved in the SQLite settings DB and used as the default fallback policy everywhere.</span>}
        rows={globalRows}
        setRows={setGlobalRows}
        enabled={globalEnabled()}
        setEnabled={setGlobalEnabled}
        crossProvider={globalCrossProvider()}
        setCrossProvider={setGlobalCrossProvider}
        saving={globalSaving}
        saved={globalSaved}
        saveError={globalSaveError}
        onReset={syncGlobalFromSettings}
        onSave={saveGlobalFallbackPolicy}
        saveLabel="Save global default"
      />

      <Show when={directory}>
        <div class="space-y-4">
          <div
            class="flex items-center gap-2 px-3 py-2 rounded-md text-xs"
            style={{
              background: "var(--surface-inset)",
              color: "var(--text-weak)",
              border: "1px solid var(--border-base)",
            }}
          >
            <Info class="w-3.5 h-3.5 shrink-0" />
            <span>
              <Show
                when={hasProjectOverride()}
                fallback={<>This project is currently inheriting the global fallback default. Saving below will create a project-specific override.</>}
              >
                <>This project currently overrides the global fallback default. Clear the override to inherit the global behavior again.</>
              </Show>
            </span>
          </div>

          <FallbackPolicySection
            title="Project override"
            description="Use this only when this project should fall back differently from the global default."
            info={<span>Saved in the SQLite settings DB and used only when this project overrides the global default.</span>}
            rows={projectRows}
            setRows={setProjectRows}
            enabled={projectEnabled()}
            setEnabled={setProjectEnabled}
            crossProvider={projectCrossProvider()}
            setCrossProvider={setProjectCrossProvider}
            saving={projectSaving}
            saved={projectSaved}
            saveError={projectSaveError}
            onReset={syncProjectFromSettings}
            onSave={saveProjectFallbackPolicy}
            saveLabel={hasProjectOverride() ? "Save project override" : "Create project override"}
          />

          <Show when={hasProjectOverride()}>
            <div class="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={clearProjectFallbackOverride} disabled={projectSaving()}>
                <Trash2 class="w-4 h-4" />
                Clear project override
              </Button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ProjectProvidersTab() {
  const config = useConfig()
  const providers = useProviders()
  const { directory, url: serverUrl, targetUrl } = useSDK()
  const OPENAI_COMPATIBLE_PROVIDER = "@ai-sdk/openai-compatible"
  const [testError, setTestError] = createSignal<string | null>(null)
  const [testSuccess, setTestSuccess] = createSignal<string | null>(null)
  const [newProviderId, setNewProviderId] = createSignal<string>("")
  const [newProviderName, setNewProviderName] = createSignal<string>("")
  const [newProviderBaseURL, setNewProviderBaseURL] = createSignal<string>("")
  const [newProviderApiKey, setNewProviderApiKey] = createSignal<string>("")
  const [newProviderApi, setNewProviderApi] = createSignal<string>("")
  const [newProviderNpm, setNewProviderNpm] = createSignal<string>(OPENAI_COMPATIBLE_PROVIDER)
  const [newProviderEnv, setNewProviderEnv] = createSignal<string>("")
  const [newProviderModels, setNewProviderModels] = createSignal<Array<{ id: string; name: string }>>([])
  const [showProviderAdvanced, setShowProviderAdvanced] = createSignal(false)
  const [editingProviderId, setEditingProviderId] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [testing, setTesting] = createSignal(false)
  const [providerToRemove, setProviderToRemove] = createSignal<string | null>(null)
  const [providerSearch, setProviderSearch] = createSignal("")
  const [expandedModelProviders, setExpandedModelProviders] = createSignal<Record<string, boolean>>({})
  const projectProviderConfigMap = createMemo<Record<string, ProviderConfig>>(() => config.project.provider ?? {})
  const globalProviderConfigMap = createMemo<Record<string, ProviderConfig>>(() => config.global.provider ?? {})

  const availableModels = createMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ id: string; provider: string; name: string }> = []

    for (const provider of providers.rawProviders) {
      for (const model of Object.keys(provider.models)) {
        if (!modelPolicyEnabled(provider.id, model, globalProviderConfigMap(), projectProviderConfigMap())) continue
        const id = `${provider.id}/${model}`
        if (seen.has(id)) continue
        seen.add(id)
        result.push({ id, provider: provider.name || provider.id, name: model })
      }
    }

    return result.sort((a, b) => a.id.localeCompare(b.id))
  })

  function defaultModelAllowed(model: string) {
    const slash = model.indexOf("/")
    if (slash <= 0 || slash === model.length - 1) return false
    const providerID = model.slice(0, slash)
    const modelID = model.slice(slash + 1)
    const provider = providers.rawProviders.find((item) => item.id === providerID)
    if (!provider?.models[modelID]) return false
    return modelPolicyEnabled(providerID, modelID, globalProviderConfigMap(), projectProviderConfigMap())
  }

  const selectedDefaultModel = createMemo(() => {
    const model = config.global.model
    if (!model) return ""
    return defaultModelAllowed(model) ? model : ""
  })

  const providerOptions = createMemo(() => {
    return providers.rawProviders
      .map((provider) => ({
        id: provider.id,
        name: provider.name || provider.id,
        connected: providers.rawConnected.some((connectedID) => providerBaseID(connectedID) === provider.id),
        modelIDs: Object.keys(provider.models),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const filteredProviderOptions = createMemo(() => {
    const q = providerSearch().toLowerCase().trim()
    const all = providerOptions().filter((p) => p.connected)
    if (!q) return all
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  })

  function addModelRow() {
    setNewProviderModels([...newProviderModels(), { id: "", name: "" }])
    clearProviderTestResult()
  }

  function clearProviderTestResult() {
    setTestError(null)
    setTestSuccess(null)
  }

  function removeModelRow(index: number) {
    setNewProviderModels(newProviderModels().filter((_, i) => i !== index))
    clearProviderTestResult()
  }

  function setModelId(index: number, value: string) {
    const next = [...newProviderModels()]
    next[index] = { ...next[index], id: value }
    setNewProviderModels(next)
  }

  function setModelName(index: number, value: string) {
    const next = [...newProviderModels()]
    next[index] = { ...next[index], name: value }
    setNewProviderModels(next)
  }

  function resetProviderEditor() {
    setEditingProviderId(null)
    setNewProviderId("")
    setNewProviderName("")
    setNewProviderBaseURL("")
    setNewProviderApiKey("")
    setNewProviderApi("")
    setNewProviderNpm(OPENAI_COMPATIBLE_PROVIDER)
    setNewProviderEnv("")
    setNewProviderModels([])
    setShowProviderAdvanced(false)
    setTestError(null)
    setTestSuccess(null)
  }

  function projectProviderEnabled(providerID: string) {
    const base = providerBaseID(providerID)
    if (config.project.enabled_providers) return config.project.enabled_providers.includes(base)
    if (config.project.disabled_providers) return !config.project.disabled_providers.includes(base)
    return true
  }

  function globalModelListExpanded(providerID: string) {
    return expandedModelProviders()[providerID] === true
  }

  function toggleGlobalModelList(providerID: string) {
    setExpandedModelProviders((current) => ({ ...current, [providerID]: !current[providerID] }))
  }

  async function setDefaultModel(model: string) {
    if (model && !defaultModelAllowed(model)) {
      setSaveError("Default model is disabled by the active global model policy")
      return
    }
    setSaving(true)
    const result = await config.updateGlobal({ model: model || undefined })
    setSaving(false)
    if (result) showSaved()
  }

  async function setDefaultAgent(agent: string) {
    setSaving(true)
    const result = await config.updateGlobal({ default_agent: agent || undefined })
    setSaving(false)
    if (result) showSaved()
  }

  async function toggleProjectProvider(providerID: string) {
    const base = providerBaseID(providerID)
    setSaving(true)
    if (config.project.enabled_providers) {
      const next = config.project.enabled_providers.includes(base)
        ? config.project.enabled_providers.filter((item) => item !== base)
        : [...config.project.enabled_providers, base]
      const result = await config.updateProject({ enabled_providers: next })
      setSaving(false)
      if (result) showSaved()
      return
    }

    const disabled = config.project.disabled_providers ?? []
    const next = disabled.includes(base)
      ? disabled.filter((item) => item !== base)
      : [...disabled, base]
    const result = await config.updateProject({ disabled_providers: next })
    setSaving(false)
    if (result) showSaved()
  }

  function globalProviderModelConfig(providerID: string) {
    return providerModelConfig(providerID, globalProviderConfigMap(), projectProviderConfigMap()) ?? {}
  }

  function globalModelEnabled(providerID: string, modelID: string) {
    return modelPolicyEnabled(providerID, modelID, globalProviderConfigMap(), projectProviderConfigMap())
  }

  async function toggleGlobalModel(providerID: string, modelID: string) {
    const policyProviderID = providerBaseID(providerID)
    setSaving(true)
    const current = globalProviderModelConfig(policyProviderID)
    const existing = globalProviderConfigMap()[policyProviderID]
    const nextProvider: ProviderConfig = {
      ...(current.whitelist ? { whitelist: [...current.whitelist] } : {}),
      ...(current.blacklist ? { blacklist: [...current.blacklist] } : {}),
    }

    if (nextProvider.whitelist) {
      nextProvider.whitelist = nextProvider.whitelist.includes(modelID)
        ? nextProvider.whitelist.filter((item) => item !== modelID)
        : [...nextProvider.whitelist, modelID]
    } else {
      const blacklist = nextProvider.blacklist ?? []
      nextProvider.blacklist = blacklist.includes(modelID)
        ? blacklist.filter((item) => item !== modelID)
        : [...blacklist, modelID]
    }

    const result = await config.updateGlobal({
      provider: {
        ...globalProviderConfigMap(),
        [policyProviderID]: {
          ...existing,
          ...nextProvider,
        },
      },
    })
    setSaving(false)
    if (result) showSaved()
  }

  function editGlobalProvider(providerID: string) {
    const provider = globalProviderConfigMap()[providerID]
    setEditingProviderId(providerID)
    setNewProviderId(providerID)
    setNewProviderName(provider?.name ?? providerID)
    setNewProviderBaseURL(provider?.options?.baseURL ?? "")
    setNewProviderApiKey(provider?.options?.apiKey ?? "")
    setNewProviderApi(provider?.api ?? "")
    setNewProviderNpm(provider?.npm ?? OPENAI_COMPATIBLE_PROVIDER)
    setNewProviderEnv((provider?.env ?? []).join("\n"))
    setShowProviderAdvanced(Boolean(provider?.api || provider?.env?.length || (provider?.npm && provider.npm !== OPENAI_COMPATIBLE_PROVIDER)))
    const models = Object.entries(provider?.models ?? {}).map(([id, m]) => ({ id, name: m.name ?? "" }))
    setNewProviderModels(models.length > 0 ? models : [{ id: "", name: "" }])
    setTestError(null)
    setTestSuccess(null)
  }

  async function saveGlobalProvider() {
    const id = newProviderId().trim()
    if (!id) {
      setSaveError("Provider ID is required")
      return
    }

    const baseURL = newProviderBaseURL().trim()
    if (!baseURL) {
      setSaveError("Base URL is required")
      return
    }

    const apiKey = newProviderApiKey().trim()
    
    const env = newProviderEnv()
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (!apiKey && env.length === 0) {
      setSaveError("API key or environment variable is required")
      return
    }

    const modelEntries = newProviderModels()
      .filter((m) => m.id.trim())
      .map((m) => [m.id.trim(), { name: m.name.trim() || m.id.trim() }])
    const models = Object.fromEntries(modelEntries)

    const existingID = editingProviderId()
    const existing = existingID ? globalProviderConfigMap()[existingID] : undefined
    if (!existingID && globalProviderConfigMap()[id]) {
      setSaveError(`Provider '${id}' already exists in global config`)
      return
    }
    if (existingID && existingID !== id && globalProviderConfigMap()[id]) {
      setSaveError(`Provider '${id}' already exists in global config`)
      return
    }

    const nextMap = { ...globalProviderConfigMap() }
    if (existingID && existingID !== id) delete nextMap[existingID]

    nextMap[id] = {
      ...existing,
      id,
      name: newProviderName().trim() || id,
      options: {
        ...(existing?.options ?? {}),
        baseURL,
        apiKey: apiKey || undefined,
      },
      npm: newProviderNpm().trim() || OPENAI_COMPATIBLE_PROVIDER,
      models: Object.keys(models).length > 0 ? models : undefined,
      ...(newProviderApi().trim() ? { api: newProviderApi().trim() } : {}),
      ...(env.length > 0 ? { env } : {}),
    }

    setSaving(true)
    const result = await config.updateGlobal({ provider: nextMap })
    setSaving(false)
    if (result) {
      resetProviderEditor()
      showSaved()
    }
  }

  async function testGlobalProviderConnection() {
    const baseURL = newProviderBaseURL().trim()
    if (!baseURL) {
      setTestError("Base URL is required")
      setTestSuccess(null)
      return
    }

    const apiKey = newProviderApiKey().trim()
    if (!apiKey) {
      setTestError("API key is required")
      setTestSuccess(null)
      return
    }

    const models = newProviderModels()
      .map((model) => ({ id: model.id.trim(), name: model.name.trim() }))
      .filter((model) => model.id)

    setTesting(true)
    setTestError(null)
    setTestSuccess(null)

    const result = await validateProviderConnection(serverUrl, {
      providerID: newProviderId().trim() || editingProviderId() || undefined,
      baseURL,
      apiKey,
      models,
      targetUrl,
    })

    setTesting(false)
    if (result.ok) {
      setTestSuccess(result.message || "Connection succeeded")
      setTestError(null)
      return
    }

    setTestError(result.error || `Connection test failed${result.status ? ` (${result.status})` : ""}`)
    setTestSuccess(null)
  }

  async function removeGlobalProvider() {
    const providerID = providerToRemove()
    if (!providerID) return

    setSaving(true)
    const ok = await deleteGlobalProvider(serverUrl, providerID)
    setSaving(false)
    if (!ok) {
      setSaveError(`Failed to remove provider '${providerID}' from global config`)
      return
    }

    await config.updateGlobal({})

    setProviderToRemove(null)
    if (editingProviderId() === providerID) resetProviderEditor()

    await config.refresh()
    providers.refetch()
    showSaved()
  }


  let savedTimer: number | undefined
  function showSaved() {
    setSaveError(null)
    setSaved(true)
    if (savedTimer !== undefined) clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => setSaved(false), 2000)
  }
  onCleanup(() => {
    if (savedTimer !== undefined) clearTimeout(savedTimer)
  })

  return (
    <div class="space-y-6">
      <header>
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-lg font-medium" style={{ color: "var(--text-strong)" }}>
              Provider Settings
            </h1>
            <p class="text-sm mt-1" style={{ color: "var(--text-weak)" }}>
              Manage global provider definitions and project access
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Show when={saving()}>
              <Spinner class="w-4 h-4" />
            </Show>
            <Show when={saved()}>
              <span class="text-xs flex items-center gap-1" style={{ color: "var(--icon-success-base)" }}>
                <Check class="w-3 h-3" /> Saved
              </span>
            </Show>
          </div>
        </div>
        <div
          class="mt-3 flex items-center gap-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--surface-inset)",
            color: "var(--text-weak)",
            border: "1px solid var(--border-base)",
          }}
        >
          <Info class="w-3.5 h-3.5 shrink-0" />
          <span>
            Model defaults and model access save to global <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>~/.config/opencode/opencode.json</code>.
            <Show when={directory}>
              <span> Project provider access still saves to this project&apos;s <code class="px-1 py-0.5 rounded" style={{ background: "var(--background-base)" }}>opencode.json</code> ({directory}).</span>
            </Show>
          </span>
        </div>
      </header>

      <Show when={saveError()}>
        <div
          class="p-3 rounded-md text-sm"
          style={{
            background: "var(--surface-inset)",
            border: "1px solid var(--border-base)",
            "border-left": "3px solid var(--interactive-critical)",
            color: "var(--interactive-critical)",
          }}
        >
          {saveError()}
        </div>
      </Show>

      <section
        class="rounded-lg overflow-hidden"
        style={{
          background: "var(--background-base)",
          border: "1px solid var(--border-base)",
        }}
      >
        <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
          <Settings2 class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
              Global Model Defaults
              </h2>
        </div>
        <div class="p-4 space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1.5" style={{ color: "var(--text-base)" }}>
              Default Model
            </label>
            <select
              value={selectedDefaultModel()}
              onChange={(e) => setDefaultModel(e.currentTarget.value)}
              disabled={saving()}
              class="w-full px-3 py-2 rounded-md text-sm disabled:opacity-50"
              style={{
                background: "var(--background-base)",
                border: "1px solid var(--border-base)",
                color: "var(--text-base)",
              }}
            >
              <option value="">Use system default</option>
              <For each={availableModels()}>
                {(m) => (
                  <option value={m.id}>
                    {m.provider} / {m.name}
                  </option>
                )}
              </For>
            </select>
            <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>
              Format: <code class="px-1 py-0.5 rounded" style={{ background: "var(--surface-inset)" }}>provider/model</code>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1.5" style={{ color: "var(--text-base)" }}>
              Default Agent
            </label>
            <select
              value={config.global.default_agent ?? ""}
              onChange={(e) => setDefaultAgent(e.currentTarget.value)}
              disabled={saving()}
              class="w-full px-3 py-2 rounded-md text-sm disabled:opacity-50"
              style={{
                background: "var(--background-base)",
                border: "1px solid var(--border-base)",
                color: "var(--text-base)",
              }}
            >
              <option value="">Use system default</option>
              <For each={providers.agents}>
                {(agent) => (
                  <option value={agent.name}>{agent.name}</option>
                )}
              </For>
            </select>
          </div>
        </div>
      </section>

      <Show when={directory}>
        <section
          class="rounded-lg overflow-hidden"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
          }}
        >
          <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
            <Cpu class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
              Project Provider Access
              </h2>
            </div>
          <div class="p-4 space-y-4">
          <div>
            <h3 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
              Enabled Providers
            </h3>
            <p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>
              Control which providers are available for this project.
            </p>
          </div>
          <div class="space-y-2 pr-1" style={{ "max-height": "min(40vh, 24rem)", overflow: "auto" }}>
            <div class="relative">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-weak)" }} />
              <input
                value={providerSearch()}
                onInput={(e) => setProviderSearch(e.currentTarget.value)}
                placeholder="Search providers..."
                class="w-full pl-9 pr-3 py-2 rounded-md text-sm"
                style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }}
              />
            </div>
            <For each={filteredProviderOptions()}>
              {(provider) => (
                <div class="rounded-md overflow-hidden" style={{ background: "var(--surface-inset)" }}>
                  <div
                    class="flex items-center justify-between gap-3 p-3 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGlobalModelList(provider.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        toggleGlobalModelList(provider.id)
                      }
                    }}
                    >
                    <div class="min-w-0">
                      <div class="text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>
                        {provider.name}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Show when={provider.modelIDs.length > 0}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-raised)", color: "var(--text-weak)" }}>
                          {provider.modelIDs.length} models
                        </span>
                      </Show>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleProjectProvider(provider.id)
                        }}
                        disabled={saving()}
                        class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 shrink-0"
                        role="switch"
                        aria-checked={projectProviderEnabled(provider.id)}
                        aria-label={`Toggle ${provider.name} provider access`}
                        style={{ background: projectProviderEnabled(provider.id) ? "var(--interactive-base)" : "var(--surface-inset)" }}
                      >
                        <div
                          class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                          style={{
                            background: "var(--background-base)",
                            left: projectProviderEnabled(provider.id) ? "calc(100% - 18px)" : "2px",
                          }}
                        />
                      </button>
                      <Show when={globalModelListExpanded(provider.id)} fallback={<ChevronRight class="w-4 h-4" style={{ color: "var(--text-weak)" }} />}>
                        <ChevronDown class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
                      </Show>
                    </div>
                  </div>

                  <Show when={globalModelListExpanded(provider.id) && provider.modelIDs.length > 0}>
                    <div class="px-3 pb-3 space-y-2">
                      <div class="text-xs" style={{ color: "var(--text-weak)" }}>
                        Model toggles save to global provider config. Legacy project whitelist or blacklist rules are still read when no global model policy exists yet.
                      </div>
                      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <For each={provider.modelIDs.sort((a, b) => a.localeCompare(b))}>
                          {(modelID) => (
                            <div class="flex items-center justify-between gap-3 rounded-md px-3 py-2" style={{ background: "var(--background-base)" }}>
                              <span class="text-sm truncate" style={{ color: "var(--text-base)" }}>{modelID}</span>
                              <button
                                onClick={() => toggleGlobalModel(provider.id, modelID)}
                                disabled={saving()}
                                class="relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 shrink-0"
                                role="switch"
                                aria-checked={globalModelEnabled(provider.id, modelID)}
                                aria-label={`Toggle ${modelID} for ${provider.name}`}
                                style={{ background: globalModelEnabled(provider.id, modelID) ? "var(--interactive-base)" : "var(--surface-inset)" }}
                              >
                                <div
                                  class="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                                  style={{
                                    background: "var(--background-base)",
                                    left: globalModelEnabled(provider.id, modelID) ? "calc(100% - 18px)" : "2px",
                                  }}
                                />
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
          </div>
        </section>
      </Show>

      <section
        class="rounded-lg overflow-hidden"
        style={{
          background: "var(--background-base)",
          border: "1px solid var(--border-base)",
        }}
      >
        <div class="px-4 py-3 flex items-center gap-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
          <Settings2 class="w-4 h-4" style={{ color: "var(--text-weak)" }} />
          <h2 class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
            Global Custom Providers
          </h2>
        </div>
        <div class="p-4">
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div class="rounded-md p-3" style={{ background: "var(--surface-inset)" }}>
              <div class="flex items-start justify-between gap-2 mb-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                    {editingProviderId() ? `Edit ${editingProviderId()}` : "Add custom provider"}
                  </div>
                  <div class="text-xs mt-0.5" style={{ color: "var(--text-weak)" }}>
                    OpenAI-compatible providers only.
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--background-base)", color: "var(--text-weak)" }}>
                    {OPENAI_COMPATIBLE_PROVIDER}
                  </span>
                  <button
                    onClick={() => setShowProviderAdvanced((current) => !current)}
                    class="text-xs px-2 py-1 rounded"
                    style={{ background: "var(--background-base)", color: "var(--text-base)" }}
                  >
                    {showProviderAdvanced() ? "Hide advanced" : "Advanced"}
                  </button>
                  <Show when={editingProviderId()}>
                    <button
                      onClick={resetProviderEditor}
                      class="text-xs hover:underline"
                      style={{ color: "var(--text-interactive-base)" }}
                    >
                      Clear
                    </button>
                  </Show>
                </div>
              </div>
              <Show when={testError() || testSuccess()}>
                <div
                  class="mb-3 rounded-md px-3 py-2 text-xs"
                  style={{
                    background: "var(--background-base)",
                    border: "1px solid var(--border-base)",
                    color: testError() ? "var(--interactive-critical)" : "var(--icon-success-base)",
                  }}
                >
                  {testError() || testSuccess()}
                </div>
              </Show>
              <div class="space-y-2">
                <input value={newProviderId()} onInput={(e) => setNewProviderId(e.currentTarget.value)} placeholder="Provider ID" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                <input value={newProviderName()} onInput={(e) => setNewProviderName(e.currentTarget.value)} placeholder="Display name" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                <input value={newProviderBaseURL()} onInput={(e) => { setNewProviderBaseURL(e.currentTarget.value); clearProviderTestResult() }} placeholder="Base URL, e.g. https://example.com/v1" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                <input type="password" value={newProviderApiKey()} onInput={(e) => { setNewProviderApiKey(e.currentTarget.value); clearProviderTestResult() }} placeholder="API key" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />

                <div class="rounded-md p-3" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium" style={{ color: "var(--text-strong)" }}>Models</span>
                    <button type="button" onClick={addModelRow} class="text-xs px-2 py-1 rounded flex items-center gap-1" style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}>
                      <Plus class="w-3 h-3" /> Add model
                    </button>
                  </div>
                  <Show when={newProviderModels().length > 0} fallback={
                    <p class="text-xs" style={{ color: "var(--text-weak)" }}>No models configured. Models will be fetched from the API if not specified.</p>
                  }>
                    <div class="space-y-2">
                      <Index each={newProviderModels()}>
                        {(m, i) => (
                          <div class="flex flex-col gap-2 md:flex-row md:items-start">
                            <input value={m().id} onInput={(e) => { setModelId(i, e.currentTarget.value); clearProviderTestResult() }} placeholder="Model ID, e.g. gpt-4o" class="w-full min-w-0 px-3 py-2 rounded-md text-sm md:flex-1" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                            <input value={m().name} onInput={(e) => { setModelName(i, e.currentTarget.value); clearProviderTestResult() }} placeholder="Display name, e.g. GPT-4o" class="w-full min-w-0 px-3 py-2 rounded-md text-sm md:flex-1" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                            <button type="button" onClick={() => removeModelRow(i)} class="self-end p-2 rounded shrink-0 md:self-auto" style={{ color: "var(--interactive-critical)" }} aria-label="Remove model">
                              <X class="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </Index>
                    </div>
                  </Show>
                </div>

                <p class="text-xs" style={{ color: "var(--text-weak)" }}>
                  Most providers only need a base URL and API key. The adapter package is prefilled for OpenAI-compatible providers.
                </p>
                <Show when={showProviderAdvanced()}>
                  <div class="space-y-2 rounded-md p-3" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}>
                    <input value={newProviderNpm()} onInput={(e) => setNewProviderNpm(e.currentTarget.value)} placeholder="Adapter package" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                    <input value={newProviderApi()} onInput={(e) => setNewProviderApi(e.currentTarget.value)} placeholder="Adapter API (optional)" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                    <textarea value={newProviderEnv()} onInput={(e) => setNewProviderEnv(e.currentTarget.value)} rows={4} placeholder="Environment variables, one per line (optional)" class="w-full px-3 py-2 rounded-md text-sm" style={{ background: "var(--background-base)", border: "1px solid var(--border-base)", color: "var(--text-base)" }} />
                  </div>
                </Show>
                <div class="flex items-center gap-2 flex-wrap pt-1">
                  <Button onClick={testGlobalProviderConnection} variant="secondary" size="sm" disabled={saving() || testing() || !newProviderBaseURL().trim() || !newProviderApiKey().trim()}>
                    {testing() ? "Testing..." : "Test Connection"}
                  </Button>
                  <Button onClick={saveGlobalProvider} variant="primary" size="sm" disabled={saving() || testing() || !newProviderId().trim()}>
                    <Save class="w-3.5 h-3.5" />
                    {editingProviderId() ? "Save Provider" : "Add Provider"}
                  </Button>
                  <Show when={editingProviderId()}>
                    <Button onClick={resetProviderEditor} variant="secondary" size="sm" disabled={saving()}>
                      Cancel
                    </Button>
                  </Show>
                </div>
              </div>
            </div>
            <div class="rounded-md p-3" style={{ background: "var(--surface-inset)" }}>
              <div class="text-sm font-medium mb-3" style={{ color: "var(--text-strong)" }}>
                Global custom providers ({Object.keys(globalProviderConfigMap()).length})
              </div>
              <Show when={Object.keys(globalProviderConfigMap()).length > 0} fallback={<p class="text-sm" style={{ color: "var(--text-weak)" }}>No global custom providers yet.</p>}>
                <div class="space-y-2">
                  <For each={Object.entries(globalProviderConfigMap()).sort((a, b) => a[0].localeCompare(b[0]))}>
                    {([providerID, provider]) => (
                      <div class="rounded-md px-3 py-2" style={{ background: "var(--background-base)" }}>
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>
                              {provider.name || providerID}
                            </div>
                            <div class="text-xs truncate" style={{ color: "var(--text-weak)" }}>{providerID}</div>
                             <div class="text-[11px] truncate mt-0.5" style={{ color: "var(--text-weak)" }}>
                                {provider.npm || OPENAI_COMPATIBLE_PROVIDER}
                                <Show when={provider.options?.baseURL}>
                                  {(baseURL) => <span> · {baseURL()}</span>}
                                </Show>
                              </div>
                              <Show when={provider.models && Object.keys(provider.models).length > 0}>
                                {(models) => (
                                  <div class="text-[11px] truncate mt-0.5" style={{ color: "var(--text-weak)" }}>
                                    {Object.keys(models()).length} model{Object.keys(models()).length !== 1 ? "s" : ""}
                                  </div>
                                )}
                              </Show>
                          </div>
                          <div class="flex items-center gap-2 shrink-0">
                            <button onClick={() => editGlobalProvider(providerID)} class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}>
                              Edit
                            </button>
                            <button onClick={() => setProviderToRemove(providerID)} class="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--interactive-critical)" }}>
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={!!providerToRemove()}
        title="Remove Global Custom Provider"
        message={`Remove provider '${providerToRemove() ?? ""}' from global opencode.json?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={removeGlobalProvider}
        onCancel={() => setProviderToRemove(null)}
      />

    </div>
  )
}

function actionColor(action: PermissionActionConfig): string {
  if (action === "allow") return "var(--icon-success-base)"
  if (action === "deny") return "var(--interactive-critical)"
  return "var(--icon-warning-base)"
}

function PromptDialog(props: {
  editing: string | null
  title: () => string
  setTitle: (v: string) => void
  text: () => string
  setText: (v: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const [container, setContainer] = createSignal<HTMLDivElement>()
  const [titleRef, setTitleRef] = createSignal<HTMLInputElement>()

  createEffect(() => {
    const el = container()
    if (!el) return

    // Focus title input on open
    titleRef()?.focus()

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        props.onClose()
        return
      }
      if (e.key !== "Tab") return

      const focusable = el!.querySelectorAll<HTMLElement>(
        'input, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener("keydown", handleKey)
    onCleanup(() => document.removeEventListener("keydown", handleKey))
  })

  return (
    <Portal>
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.5)" }}
        role="presentation"
      >
        <div
          ref={setContainer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-dialog-title"
          class="w-full max-w-md rounded-lg shadow-xl overflow-hidden"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
          }}
        >
          <div class="px-4 py-3" style={{ "border-bottom": "1px solid var(--border-base)" }}>
            <h2 id="prompt-dialog-title" class="text-base font-medium" style={{ color: "var(--text-strong)" }}>
              {props.editing ? "Edit Prompt" : "Add Prompt"}
            </h2>
          </div>
          <div class="p-4 space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                Title
              </label>
              <input
                ref={setTitleRef}
                type="text"
                value={props.title()}
                onInput={(e) => props.setTitle(e.currentTarget.value)}
                placeholder="e.g. Code Review"
                class="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                }}
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                Prompt Text
              </label>
              <textarea
                value={props.text()}
                onInput={(e) => props.setText(e.currentTarget.value)}
                placeholder="Enter the prompt text..."
                rows={6}
                class="w-full px-3 py-2 rounded-md text-sm resize-y"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                  "min-height": "120px",
                }}
              />
            </div>
          </div>
          <div
            class="px-4 py-3 flex justify-end gap-2"
            style={{ "border-top": "1px solid var(--border-base)" }}
          >
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
              style={{
                background: "var(--surface-inset)",
                color: "var(--text-base)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  props.onSave();
                } catch (err) {
                  console.error("Settings: save failed", err);
                }
              }}
              disabled={!props.title().trim() || !props.text().trim()}
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50"
              style={{
                background: "var(--interactive-base)",
                color: "white",
              }}
            >
              {props.editing ? "Save Changes" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
