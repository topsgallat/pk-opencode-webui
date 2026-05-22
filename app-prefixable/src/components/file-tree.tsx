import { createEffect, createMemo, For, Match, Show, Switch, untrack, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { ConfirmDialog } from "./confirm-dialog"
import type { FileNode } from "../sdk/client"
import { useFile } from "../context/file"
import { useServer } from "../context/server"
import { getServerCapabilities } from "../utils/server-capabilities"
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, FilePlus, FolderPlus, Trash2, Pencil, MessageSquarePlus, Upload, Download } from "lucide-solid"
import { NewFileDialog } from "./new-file-dialog"

type Kind = "add" | "del" | "mix"

function kindLabel(kind: Kind) {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

function kindColor(kind: Kind) {
  if (kind === "add") return "var(--icon-diff-add-base)"
  if (kind === "del") return "var(--icon-diff-delete-base)"
  return "var(--icon-warning-active)"
}

const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; node: FileNode | { type: "directory"; path: string; name: string } } | null>(null)
const [dialogState, setDialogState] = createSignal<{ open: boolean; mode: "file" | "folder"; parentPath: string }>({ open: false, mode: "file", parentPath: "" })
const [uploadState, setUploadState] = createSignal<{ parentPath: string; folder: boolean } | null>(null)
const [dragPath, setDragPath] = createSignal<string | null>(null)
const [dragSourcePath, setDragSourcePath] = createSignal<string | null>(null)
const [dragInvalid, setDragInvalid] = createSignal(false)
const [dragInternal, setDragInternal] = createSignal(false)
const [deleteTarget, setDeleteTarget] = createSignal<{ type: "directory" | "file"; path: string; name: string } | FileNode | null>(null)
const [confirmOpen, setConfirmOpen] = createSignal(false)
const scrollStore = new Map<string, number>()
let dragDepth = 0
const MOVE_DATA_TYPE = "application/x-opencode-file-path"
const AUTO_EXPAND_DELAY = 500
const LONG_PRESS_DELAY = 450
let autoExpandTimer: number | undefined
let autoExpandPath: string | null = null
let longPressTimer: number | undefined
let suppressClickPath: string | null = null

function clearAutoExpand(path?: string) {
  if (path && autoExpandPath !== path) return
  if (autoExpandTimer !== undefined) window.clearTimeout(autoExpandTimer)
  autoExpandTimer = undefined
  autoExpandPath = null
}

function clearLongPress() {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer)
  longPressTimer = undefined
}

function consumeLongPress(path: string) {
  if (suppressClickPath !== path) return false
  suppressClickPath = null
  return true
}

function handleDragStart(e: DragEvent, path: string) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData("text/plain", path)
  e.dataTransfer?.setData(MOVE_DATA_TYPE, path)
  e.dataTransfer.effectAllowed = "move"
  setDragSourcePath(path)
  setDragInternal(true)
  setDragInvalid(false)
}

function parentPath(path: string) {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? "" : path.slice(0, idx)
}

function isInvalidMove(sourcePath: string, targetPath: string) {
  if (sourcePath === targetPath) return true
  if (parentPath(sourcePath) === targetPath) return true
  return targetPath.startsWith(sourcePath + "/")
}

function readDragMeta(e: DragEvent, targetPath: string): {
  internal: boolean
  invalid: boolean
  sourcePath: string | null
  dropEffect: "none" | "move" | "copy"
} | null {
  const types = Array.from(e.dataTransfer?.types ?? [])
  const internal = types.includes(MOVE_DATA_TYPE)
  const files = types.includes("Files")
  if (!internal && !files) return null

  const sourcePath = internal ? e.dataTransfer?.getData(MOVE_DATA_TYPE) || dragSourcePath() : null
  const invalid = !!sourcePath && isInvalidMove(sourcePath, targetPath)

  return {
    internal,
    invalid,
    sourcePath,
    dropEffect: invalid ? "none" : internal ? "move" : "copy",
  }
}

function syncDragState(e: DragEvent, targetPath: string, entering: boolean) {
  const meta = readDragMeta(e, targetPath)
  if (!meta) return false
  if (entering) dragDepth += 1
  setDragPath(targetPath)
  setDragSourcePath(meta.sourcePath)
  setDragInvalid(meta.invalid)
  setDragInternal(meta.internal)
  if (e.dataTransfer) e.dataTransfer.dropEffect = meta.dropEffect
  return true
}

type UploadEntry = {
  file: File
  relativePath: string
}

type DropEntry = FileSystemFileEntry | FileSystemDirectoryEntry

type DropItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

function isFileDropEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

function isDirectoryDropEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

if (typeof window !== "undefined") {
  window.addEventListener("click", () => setContextMenu(null))
  window.addEventListener("contextmenu", () => setContextMenu(null))
}

interface FileTreeProps {
  path: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  active?: string
  viewKey?: string
  onFileClick?: (node: FileNode) => void
  onMentionFile?: (path: string) => void
  onMentionFileLine?: (path: string, selection: { startLine: number; endLine: number }) => void
}

export function FileTree(props: FileTreeProps) {
  const file = useFile()
  const server = useServer()
  const capabilities = () => getServerCapabilities(server.selectedServer())
  const level = () => props.level ?? 0
  const canCreateFile = () => capabilities().canUseLocalExtFileOps
  const canCreateDirectory = () => capabilities().canCreateDirectories
  const canDelete = () => capabilities().canUseLocalExtFileOps
  const canEdit = () => capabilities().canUseLocalExtFileOps
  const canUpload = () => capabilities().canUseLocalExtFileOps

  function toUploadEntries(files: File[], folder: boolean): UploadEntry[] {
    return files.map((file) => ({
      file,
      relativePath: folder ? file.webkitRelativePath || file.name : file.name,
    }))
  }

async function readDirectory(entry: DropEntry): Promise<UploadEntry[]> {
  if (isFileDropEntry(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    return [{ file, relativePath: entry.fullPath.replace(/^\/+/, "") || file.name }]
  }

    const reader = entry.createReader()
    const entries = await new Promise<DropEntry[]>((resolve, reject) => {
      const out: DropEntry[] = []

      const read = () => {
        reader.readEntries((batch) => {
          if (!batch.length) {
            resolve(out)
            return
          }

          const next = batch.filter((item): item is DropEntry => isFileDropEntry(item) || isDirectoryDropEntry(item))
          out.push(...next)
          read()
        }, reject)
      }

      read()
    })

    const nested = await Promise.all(entries.map((item: DropEntry) => readDirectory(item)))
    return nested.flat()
  }

  async function collectDropEntries(e: DragEvent): Promise<UploadEntry[]> {
    const items = Array.from(e.dataTransfer?.items ?? []) as DropItem[]
    if (items.length > 0) {
      const entries = await Promise.all(items.map(async (item) => {
        const entry = item.webkitGetAsEntry?.()
        if (!entry) {
          const file = item.getAsFile()
          return file ? [{ file, relativePath: file.webkitRelativePath || file.name }] : []
        }

        if (!isFileDropEntry(entry) && !isDirectoryDropEntry(entry)) {
          return []
        }

        const dropEntry: DropEntry = entry
        return readDirectory(dropEntry)
      }))
      return entries.flat()
    }

    return toUploadEntries(Array.from(e.dataTransfer?.files ?? []), false)
  }

  // Build filter set for "allowed" mode (changed files only)
  const filter = createMemo(() => {
    const allowed = props.allowed
    if (!allowed) return undefined

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"))
      }
    }

    return { files, dirs }
  })

  // Build modified set for highlighting
  const marks = createMemo(() => {
    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return undefined
    return out
  })

  const scrollKey = createMemo(() => {
    if (level() !== 0) return undefined
    if (props.viewKey) return `view:${props.viewKey}:${props.path}`
    if (props.allowed) return `allowed:${props.path}`
    if (props.modified) return `all:${props.path}`
    return `plain:${props.path}`
  })

  let rootRef: HTMLDivElement | undefined

  function saveScroll() {
    if (!rootRef || !scrollKey()) return
    scrollStore.set(scrollKey()!, rootRef.scrollTop)
  }

  function restoreScroll() {
    if (!rootRef || !scrollKey()) return
    const y = scrollStore.get(scrollKey()!)
    if (y == null) return
    rootRef.scrollTop = y
  }

  onMount(() => {
    requestAnimationFrame(restoreScroll)

    const prevent = (e: DragEvent) => {
      if (!canUpload()) return
      const types = Array.from(e.dataTransfer?.types ?? [])
      if (!types.includes("Files") && !types.includes(MOVE_DATA_TYPE)) return
      e.preventDefault()
    }

    window.addEventListener("dragover", prevent)
    window.addEventListener("drop", prevent)

    onCleanup(() => {
      window.removeEventListener("dragover", prevent)
      window.removeEventListener("drop", prevent)
    })
  })

  onCleanup(() => {
    saveScroll()
  })

  // Auto-expand directories when in filtered mode
  createEffect(() => {
    const current = filter()
    if (!current || level() !== 0) return

    for (const dir of current.dirs) {
      const state = untrack(() => file.tree.state(dir))
      if (!state?.expanded) {
        file.tree.expand(dir)
      }
    }
  })

  // List root directory on mount
  createEffect(() => {
    if (level() !== 0) return
    const state = file.tree.state(props.path)
    if (state?.loaded || state?.loading) return
    void file.tree.list(props.path)
  })

  // List expanded directories
  createEffect(() => {
    const state = file.tree.state(props.path)
    if (!state?.expanded) return
    if (state.loaded || state.loading) return
    void file.tree.list(props.path)
  })

  const nodes = createMemo(() => {
    const children = file.tree.children(props.path)
    const current = filter()
    if (!current) return children

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? "" : path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    // Filter to allowed items
    const out = children.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((n) => n.path))

    // Add virtual entries for items in filter not yet loaded
    for (const dir of current.dirs) {
      if (parent(dir) !== props.path || seen.has(dir)) continue
      out.push({ name: leaf(dir), path: dir, absolute: dir, type: "directory", ignored: false })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path || seen.has(item)) continue
      out.push({ name: leaf(item), path: item, absolute: item, type: "file", ignored: false })
      seen.add(item)
    }

    // Sort: directories first, then alphabetically
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return out
  })

  const nodeKind = (node: FileNode) => {
    const kind = props.kinds?.get(node.path)
    if (!kind) return undefined
    if (!marks()?.has(node.path)) return undefined
    return kind
  }

  const isActive = (node: FileNode) => {
    const kind = nodeKind(node)
    return !!kind && !node.ignored
  }

  const openContextMenu = (x: number, y: number, node: FileNode | { type: "directory"; path: string; name: string }) => {
    const canOpen = node.type === "directory"
      ? canCreateFile() || canCreateDirectory() || canUpload() || (node.path !== "" && canDelete())
      : true
    if (!canOpen) return false
    setContextMenu({
      x: Math.min(x, window.innerWidth - 150),
      y: Math.min(y, window.innerHeight - 150),
      node,
    })
    return true
  }

  const handleContextMenu = (e: MouseEvent, node: FileNode | { type: "directory"; path: string; name: string }) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY, node)
  }

  const handleTouchStart = (e: TouchEvent, node: FileNode | { type: "directory"; path: string; name: string }) => {
    if (e.touches.length !== 1) {
      clearLongPress()
      return
    }
    const touch = e.touches[0]
    clearLongPress()
    longPressTimer = window.setTimeout(() => {
      longPressTimer = undefined
      const opened = openContextMenu(touch.clientX, touch.clientY, node)
      if (!opened) return
      suppressClickPath = node.path
    }, LONG_PRESS_DELAY)
  }

  const handleTouchEnd = (path: string) => {
    clearLongPress()
    window.setTimeout(() => {
      if (suppressClickPath === path) suppressClickPath = null
    }, LONG_PRESS_DELAY)
  }

  const handleCreate = async (name: string) => {
    const { mode, parentPath } = dialogState()
    const fullPath = parentPath ? `${parentPath}/${name}` : name
    
    try {
      if (mode === "file") {
        await file.createFile(fullPath)
      }
      if (mode === "folder") {
        await file.createDir(fullPath)
      }
      setDialogState({ open: false, mode: "file", parentPath: "" })
    } catch (err) {
      try {
        const message = err instanceof Error ? err.message : String(err)
        alert(`Create failed: ${message}`)
      } catch {
        return
      }
    }
  }

  const handleDelete = async (node: FileNode | { type: "directory"; path: string; name: string }) => {
    if (node.type === "file") {
      await file.deleteFile(node.path)
    }
    if (node.type === "directory") {
      await file.deleteDir(node.path)
    }
    setContextMenu(null)
  }

  function scheduleAutoExpand(path: string) {
    if (autoExpandPath === path) return
    clearAutoExpand()
    autoExpandPath = path
    autoExpandTimer = window.setTimeout(() => {
      autoExpandTimer = undefined
      if (autoExpandPath !== path) return
      if (!file.tree.state(path)?.expanded) file.tree.expand(path)
      autoExpandPath = null
    }, AUTO_EXPAND_DELAY)
  }

  function openUpload(parentPath: string, folder: boolean) {
    if (!canUpload()) return
    setUploadState({ parentPath, folder })
    const input = folder ? folderInputRef : fileInputRef
    input?.click()
  }

  async function handleUploadChange(e: Event, folder: boolean) {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    const state = uploadState()
    input.value = ""
    setUploadState(null)
    if (!state || !files.length) return
    await file.uploadFiles(state.parentPath, toUploadEntries(files, folder))
  }

  async function handleDrop(e: DragEvent, parentPath: string) {
    if (!canUpload()) return
    e.preventDefault()
    e.stopPropagation()

    // Check for internal file-tree move first
    const movePath = e.dataTransfer?.getData(MOVE_DATA_TYPE)
    if (movePath) {
      if (movePath === parentPath) return
      if (parentPath.startsWith(movePath + "/")) return
      await file.moveItem(movePath, parentPath)
      return
    }

    const uploads = await collectDropEntries(e)
    if (!uploads.length) return
    await file.uploadFiles(parentPath, uploads)
  }

function handleDragEnter(e: DragEvent, path: string) {
  if (!canUpload()) return
  if (!syncDragState(e, path, true)) return
  e.preventDefault()
  e.stopPropagation()
}

function handleDragOverTarget(e: DragEvent, path: string) {
  if (!canUpload()) return
  if (!syncDragState(e, path, false)) return
  e.preventDefault()
  e.stopPropagation()
}

  function handleDirectoryDragHover(e: DragEvent, path: string, expanded: boolean) {
    if (!canUpload()) return
    if (!syncDragState(e, path, false)) return
    e.preventDefault()
    e.stopPropagation()
    if (dragInvalid() || expanded) {
      clearAutoExpand(path)
      return
    }
    scheduleAutoExpand(path)
  }

  function handleDragLeave(e: DragEvent) {
    if (!canUpload()) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) setDragPath(null)
  }

  function handleDropClear() {
    dragDepth = 0
    clearAutoExpand()
    setDragPath(null)
    setDragSourcePath(null)
    setDragInvalid(false)
    setDragInternal(false)
  }

  function handleDragEnd() {
    handleDropClear()
  }

  function downloadNode(node: FileNode) {
    void (async () => {
      const data = await file.downloadFile(node.path)
      if (!data) {
        alert("Download failed")
        return
      }

      const type = data.mimeType || (data.type === "binary" ? "application/octet-stream" : "text/plain;charset=utf-8")
      const blob = data.encoding === "base64"
        ? new Blob([Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0))], { type })
        : new Blob([data.content], { type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = data.name
      a.click()
      URL.revokeObjectURL(url)
    })()
  }

  let fileInputRef: HTMLInputElement | undefined
  let folderInputRef: HTMLInputElement | undefined

  onMount(() => {
    folderInputRef?.setAttribute("webkitdirectory", "")
  })

  const rootDropActive = () => dragPath() === ""
  const treeDragActive = () => dragPath() !== null
  const targetValid = (path: string) => dragPath() === path && !dragInvalid()
  const targetInvalid = (path: string) => dragPath() === path && dragInvalid()
  const sourceActive = (path: string) => dragSourcePath() === path

  return (
    <div
      ref={rootRef}
      class="flex flex-col gap-0.5 w-full h-full min-h-[100px] overflow-auto rounded-lg border border-transparent"
      onScroll={saveScroll}
      onDragEnter={(e) => handleDragEnter(e, "")}
      onDragLeave={handleDragLeave}
      onDragOver={(e) => handleDragOverTarget(e, "")}
      onDrop={(e) => { e.stopPropagation(); handleDropClear(); void handleDrop(e, "") }}
      onContextMenu={(e) => level() === 0 ? handleContextMenu(e, { type: "directory", path: "", name: "root" }) : undefined}
      style={{
        background: rootDropActive()
          ? dragInvalid()
            ? "var(--surface-critical-base)"
            : dragInternal()
              ? "var(--surface-brand-subtle)"
              : "var(--surface-inset)"
          : "transparent",
        "border-color": rootDropActive()
          ? dragInvalid()
            ? "var(--border-critical-base)"
            : dragInternal()
              ? "var(--border-brand-subtle)"
              : "var(--border-base)"
          : treeDragActive()
            ? "var(--border-base)"
            : "transparent",
      }}
    >
      <Show when={level() === 0}>
        <div class="flex items-center justify-between px-2 py-1 mb-1 border-b border-white/5 dark:border-black/5" style={{ "border-color": "var(--border-base)" }}>
          <span class="text-xs font-semibold" style={{ color: "var(--text-weak)" }}>FILES</span>
            <Show when={canCreateFile() || canCreateDirectory() || canUpload()}>
            <div class="flex gap-1">
              <Show when={canCreateFile()}>
                <button
                  type="button"
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={(e) => { e.stopPropagation(); setDialogState({ open: true, mode: "file", parentPath: "" }) }}
                  title="New File"
                  aria-label="New File"
                >
                  <FilePlus class="w-3.5 h-3.5" style={{ color: "var(--icon-weak)" }} />
                </button>
              </Show>
              <Show when={canCreateDirectory()}>
                <button
                  type="button"
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={(e) => { e.stopPropagation(); setDialogState({ open: true, mode: "folder", parentPath: "" }) }}
                  title="New Folder"
                  aria-label="New Folder"
                >
                  <FolderPlus class="w-3.5 h-3.5" style={{ color: "var(--icon-weak)" }} />
                  </button>
              </Show>
              <Show when={canUpload()}>
                <button
                  type="button"
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={(e) => { e.stopPropagation(); openUpload("", false) }}
                  title="Upload File"
                  aria-label="Upload File"
                >
                  <Upload class="w-3.5 h-3.5" style={{ color: "var(--icon-weak)" }} />
                </button>
              </Show>
              <Show when={canUpload()}>
                <button
                  type="button"
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={(e) => { e.stopPropagation(); openUpload("", true) }}
                  title="Upload Folder"
                  aria-label="Upload Folder"
                >
                  <FolderPlus class="w-3.5 h-3.5" style={{ color: "var(--icon-weak)" }} />
                </button>
              </Show>
            </div>
            </Show>
        </div>
      </Show>
      <input
        ref={(el) => { fileInputRef = el }}
        type="file"
        multiple
        class="hidden"
        onChange={(e) => void handleUploadChange(e, false)}
      />
      <input
        ref={(el) => { folderInputRef = el }}
        type="file"
        multiple
        class="hidden"
        onChange={(e) => void handleUploadChange(e, true)}
      />
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const kind = () => nodeKind(node)
          const active = () => isActive(node)

          return (
            <Switch>
                <Match when={node.type === "directory"}>
                  <div>
                    <button
                       type="button"
                       draggable={true}
                       onClick={(e) => {
                         if (consumeLongPress(node.path)) {
                           e.preventDefault()
                           e.stopPropagation()
                           return
                         }
                         if (expanded()) {
                           file.tree.collapse(node.path)
                           return
                         }
                         file.tree.expand(node.path)
                       }}
                       aria-expanded={expanded()}
                       classList={{ "cursor-not-allowed": targetInvalid(node.path) }}
                        onDragStart={(e) => { clearLongPress(); handleDragStart(e, node.path) }}
                        onDragEnd={handleDragEnd}
                        onDragEnter={(e) => handleDragEnter(e, node.path)}
                        onDragOver={(e) => handleDirectoryDragHover(e, node.path, expanded())}
                        onDragLeave={(e) => { clearAutoExpand(node.path); handleDragLeave(e) }}
                        onDrop={(e) => { e.stopPropagation(); handleDropClear(); void handleDrop(e, node.path) }}
                       onContextMenu={(e) => handleContextMenu(e, node)}
                       onTouchStart={(e) => handleTouchStart(e, node)}
                       onTouchEnd={() => handleTouchEnd(node.path)}
                       onTouchMove={clearLongPress}
                       onTouchCancel={clearLongPress}
                       class="w-full min-h-[44px] flex items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                       style={{
                        "padding-left": `${Math.max(0, 6 + level() * 12)}px`,
                        background: targetInvalid(node.path)
                          ? "var(--surface-critical-base)"
                          : targetValid(node.path)
                            ? dragInternal()
                              ? "var(--surface-brand-subtle)"
                              : "var(--surface-inset)"
                            : sourceActive(node.path)
                              ? "var(--surface-inset)"
                              : undefined,
                        "border-color": targetInvalid(node.path)
                          ? "var(--border-critical-base)"
                          : targetValid(node.path)
                            ? dragInternal()
                              ? "var(--border-brand-subtle)"
                              : "var(--border-base)"
                            : sourceActive(node.path)
                              ? "var(--border-strong)"
                              : "transparent",
                        opacity: sourceActive(node.path) ? "0.72" : "1",
                      }}
                   >
                    <span class="w-4 h-4 flex items-center justify-center" style={{ color: "var(--icon-weak)" }}>
                      {expanded() ? <ChevronDown class="w-3 h-3" /> : <ChevronRight class="w-3 h-3" />}
                    </span>
                    <span style={{ color: "var(--icon-weak)" }}>
                      {expanded() ? <FolderOpen class="w-4 h-4" /> : <Folder class="w-4 h-4" />}
                    </span>
                      <span
                        class="flex-1 min-w-0 text-xs truncate"
                        style={{
                          color: active() ? kindColor(kind()!) : node.ignored ? "var(--text-weak)" : "var(--text-base)",
                        }}
                      >
                        {node.name}
                      </span>
                    <Show when={kind()}>
                      {(k) => <div class="w-1.5 h-1.5 rounded-full mr-1" style={{ background: kindColor(k()) }} />}
                    </Show>
                  </button>
                  <Show when={expanded()}>
                    <div class="relative">
                      <div
                        class="absolute top-0 bottom-0 w-px pointer-events-none opacity-30"
                        style={{ left: `${Math.max(0, 6 + level() * 12) + 8}px`, background: "var(--border-base)" }}
                      />
                      <FileTree
                        path={node.path}
                        level={level() + 1}
                        allowed={props.allowed}
                        modified={props.modified}
                        kinds={props.kinds}
                        active={props.active}
                        viewKey={props.viewKey}
                        onFileClick={props.onFileClick}
                        onMentionFile={props.onMentionFile}
                        onMentionFileLine={props.onMentionFileLine}
                      />
                    </div>
                  </Show>
                </div>
              </Match>
              <Match when={node.type === "file"}>
                <button
                  type="button"
                  draggable={true}
                  onClick={(e) => {
                    if (consumeLongPress(node.path)) {
                      e.preventDefault()
                      e.stopPropagation()
                      return
                    }
                    props.onFileClick?.(node)
                  }}
                  onDragStart={(e) => { clearLongPress(); handleDragStart(e, node.path) }}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => handleContextMenu(e, node)}
                  onTouchStart={(e) => handleTouchStart(e, node)}
                  onTouchEnd={() => handleTouchEnd(node.path)}
                  onTouchMove={clearLongPress}
                  onTouchCancel={clearLongPress}
                  class="w-full min-h-[44px] flex items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    "padding-left": `${Math.max(0, 6 + level() * 12 + 16)}px`,
                    background: sourceActive(node.path)
                      ? "var(--surface-inset)"
                      : node.path === props.active
                        ? "var(--surface-interactive-hover)"
                        : undefined,
                    "border-color": sourceActive(node.path) ? "var(--border-strong)" : "transparent",
                    opacity: sourceActive(node.path) ? "0.72" : "1",
                  }}
                >
                  <File class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                  <span
                    class="flex-1 min-w-0 text-xs truncate"
                    style={{
                      color: active() ? kindColor(kind()!) : node.ignored ? "var(--text-weak)" : "var(--text-base)",
                    }}
                  >
                    {node.name}
                  </span>
                  <Show when={kind()}>
                    {(k) => (
                      <span class="shrink-0 w-4 text-center text-xs font-medium" style={{ color: kindColor(k()) }}>
                        {kindLabel(k())}
                      </span>
                    )}
                  </Show>
                </button>
              </Match>
            </Switch>
          )
        }}
      </For>
      <Show when={level() === 0}>
                <Show when={contextMenu()}>
                  {(menu) => (
                    <Portal>
              <div
                class="fixed z-[200] min-w-[160px] py-1 rounded shadow-lg flex flex-col"
                style={{
                  left: `${menu().x}px`,
                  top: `${menu().y}px`,
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <Show when={menu().node.type === "directory"}>
                  <Show when={canCreateFile()}>
                    <button
                      class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        const m = menu()
                        setContextMenu(null)
                        setDialogState({ open: true, mode: "file", parentPath: m.node.path })
                      }}
                      aria-label="New File"
                    >
                      <FilePlus class="w-3.5 h-3.5" />
                      New File
                    </button>
                  </Show>
                  <Show when={canCreateDirectory()}>
                    <button
                      class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        const m = menu()
                        setContextMenu(null)
                        setDialogState({ open: true, mode: "folder", parentPath: m.node.path })
                      }}
                      aria-label="New Folder"
                    >
                      <FolderPlus class="w-3.5 h-3.5" />
                      New Folder
                    </button>
                  </Show>
                  <Show when={menu().node.path !== "" && (canDelete() && (canCreateFile() || canCreateDirectory()))}>
                    <div class="h-px w-full my-1" style={{ background: "var(--border-base)" }} />
                  </Show>
                </Show>

                <Show when={menu().node.type === "file" && canEdit()}>
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const m = menu()
                      setContextMenu(null)
                      props.onFileClick?.(m.node as FileNode)
                    }}
                    >
                      <Pencil class="w-3.5 h-3.5" />
                      Edit File
                    </button>
                  <Show when={canDelete()}>
                    <div class="h-px w-full my-1" style={{ background: "var(--border-base)" }} />
                  </Show>
                  </Show>

                <Show when={menu().node.type === "file"}>
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const m = menu()
                      setContextMenu(null)
                      downloadNode(m.node as FileNode)
                    }}
                  >
                    <Download class="w-3.5 h-3.5" />
                    Download File
                  </button>
                </Show>

                <Show when={menu().node.type === "file" && props.onMentionFile}>
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const m = menu()
                      setContextMenu(null)
                      props.onMentionFile?.((m.node as FileNode).path)
                    }}
                  >
                    <MessageSquarePlus class="w-3.5 h-3.5" />
                    Mention in Prompt
                  </button>
                </Show>

                <Show when={menu().node.path !== "" && canDelete()}>
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-red-500/10 text-red-500 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(menu().node as any)
                      setConfirmOpen(true)
                      setContextMenu(null)
                    }}
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                    Delete {menu().node.type === "directory" ? "Folder" : "File"}
                  </button>
                </Show>

                <Show when={menu().node.type === "directory" && canUpload()}>
                  <div class="h-px w-full my-1" style={{ background: "var(--border-base)" }} />
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const m = menu()
                      setContextMenu(null)
                      openUpload(m.node.path, false)
                    }}
                    aria-label="Upload File"
                  >
                    <Upload class="w-3.5 h-3.5" />
                    Upload File
                  </button>
                  <button
                    class="w-full px-3 py-1.5 min-h-[44px] text-xs text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const m = menu()
                      setContextMenu(null)
                      openUpload(m.node.path, true)
                    }}
                    aria-label="Upload Folder"
                  >
                    <FolderPlus class="w-3.5 h-3.5" />
                    Upload Folder
                  </button>
                </Show>
              </div>
            </Portal>
          )}
        </Show>
        <NewFileDialog
          open={dialogState().open}
          mode={dialogState().mode}
          parentPath={dialogState().parentPath}
          onConfirm={handleCreate}
          onClose={() => setDialogState({ ...dialogState(), open: false })}
        />
        <ConfirmDialog
          open={confirmOpen()}
          title="Confirm Delete"
          message={(() => {
            const dt = deleteTarget()
            if (!dt) return "Are you sure you want to delete this item?"
            const t = (dt as any).type ?? (dt as FileNode).type
            return `Are you sure you want to delete this ${t === "directory" ? "folder" : "file"}?`
          })()}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            const target = deleteTarget()
            if (target) {
              void (async () => {
                await handleDelete(target as any)
                setDeleteTarget(null)
                setConfirmOpen(false)
              })()
            } else {
              setConfirmOpen(false)
            }
          }}
          onCancel={() => {
            setDeleteTarget(null)
            setConfirmOpen(false)
          }}
        />
      </Show>
    </div>
  )
}
