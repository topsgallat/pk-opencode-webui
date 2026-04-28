import { createContext, useContext, batch, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { FileNode } from "../sdk/client"
import { useSDK } from "./sdk"
import { useServer } from "./server"
import { readFile, mkdir, createFile as apiCreateFile, deleteFile as apiDeleteFile, deleteDir as apiDeleteDir } from "../utils/extended-api"
import { getServerCapabilities } from "../utils/server-capabilities"

type DirState = {
  expanded: boolean
  loaded: boolean
  loading: boolean
}

type FileContent = {
  content: string
  encoding?: string
  mimeType?: string
  type?: string
}

type FileState = {
  path: string
  name: string
  loading?: boolean
  loaded?: boolean
  error?: string
  content?: FileContent
}

type FileStore = {
  dirs: Record<string, DirState>
  children: Record<string, FileNode[]>
  files: Record<string, FileState>
}

interface FileContextValue {
  tree: {
    list: (dir: string, options?: { force?: boolean }) => Promise<void>
    state: (dir: string) => DirState | undefined
    children: (dir: string) => FileNode[]
    expand: (dir: string) => void
    collapse: (dir: string) => void
    isLoaded: (dir: string) => boolean
  }
  load: (path: string, options?: { force?: boolean }) => Promise<void>
  get: (path: string) => FileState | undefined
  setContent: (path: string, content: string) => void
  createFile: (path: string) => Promise<boolean>
  createDir: (path: string) => Promise<boolean>
  deleteFile: (path: string) => Promise<boolean>
  deleteDir: (path: string) => Promise<boolean>
}

const FileContext = createContext<FileContextValue>()

function basename(path: string) {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? path : path.slice(idx + 1)
}

export function FileProvider(props: ParentProps) {
  const { client, directory, url: serverUrl, targetUrl } = useSDK()
  const server = useServer()
  const capabilities = () => getServerCapabilities(server.selectedServer())

  const [store, setStore] = createStore<FileStore>({
    dirs: {},
    children: {},
    files: {},
  })

  const inflight = new Map<string, Promise<void>>()

  async function listDir(dir: string, options?: { force?: boolean }) {
    const state = store.dirs[dir]
    if (!options?.force && state?.loaded) return
    if (state?.loading) {
      const pending = inflight.get(dir)
      if (pending) return pending
      return
    }

    // Initialize dir state
    setStore("dirs", dir, { expanded: state?.expanded ?? false, loaded: false, loading: true })

    const promise = client.file
      .list({ path: dir || "." })
      .then((res) => {
        const nodes = res.data ?? []
        batch(() => {
          setStore("children", dir, nodes)
          setStore(
            "dirs",
            dir,
            produce((d) => {
              d.loaded = true
              d.loading = false
            }),
          )
        })
      })
      .catch((e) => {
        console.error("[File] Failed to list dir:", dir, e)
        setStore(
          "dirs",
          dir,
          produce((d) => {
            d.loading = false
          }),
        )
      })
      .finally(() => {
        inflight.delete(dir)
      })

    inflight.set(dir, promise)
    return promise
  }

  function expand(dir: string) {
    const state = store.dirs[dir]
    if (!state) {
      setStore("dirs", dir, { expanded: true, loaded: false, loading: false })
      void listDir(dir)
      return
    }
    setStore("dirs", dir, "expanded", true)
    if (!state.loaded && !state.loading) {
      void listDir(dir)
    }
  }

  function collapse(dir: string) {
    setStore("dirs", dir, "expanded", false)
  }

  // Auto-load root directory
  void listDir("")

  const fileInflight = new Map<string, Promise<void>>()

  async function loadFile(path: string, options?: { force?: boolean }) {
    // Check inflight map first to avoid race conditions
    const pending = fileInflight.get(path)
    if (pending) return pending

    const state = store.files[path]
    if (!options?.force && state?.loaded) return

    // Initialize file state
    setStore("files", path, { path, name: basename(path), loading: true, loaded: false })

    
    const fullPath = directory && !path.startsWith("/") ? `${directory}/${path}` : path
    const existingContent = store.files[path]?.content?.content

    const promise = client.file
      .read({ path })
      .then((res) => {
        const data = res.data
        batch(() => {
          setStore(
            "files",
            path,
            produce((f) => {
              f.loaded = true
              f.loading = false
              f.error = undefined
              f.content = data
                ? {
                    content: data.content,
                    encoding: data.encoding,
                    mimeType: data.mimeType,
                    type: data.type,
                  }
                : undefined
            }),
          )
        })
      })
      .catch(async (e) => {
        console.error("[File] Upstream API failed for:", path, e)
        
        // Fallback 1: try local extended API only for local backend mode
        const extContent = capabilities().canUseLocalExtFileOps
          ? await readFile(serverUrl, fullPath, targetUrl)
          : null
        if (extContent !== null) {
          batch(() => {
            setStore("files", path, produce((f) => {
              f.loaded = true
              f.loading = false
              f.error = undefined
              f.content = {
                content: extContent,
                encoding: "utf-8",
              }
            }))
          })
          return
        }

        // Fallback 2: restore previously set content
        if (existingContent !== undefined) {
          batch(() => {
            setStore("files", path, produce((f) => {
              f.loaded = true
              f.loading = false
              f.error = undefined
              f.content = {
                content: existingContent,
                encoding: "utf-8",
              }
            }))
          })
          return
        }

        // Final: show error
        setStore(
          "files",
          path,
          produce((f) => {
            f.loading = false
            f.error = e instanceof Error ? e.message : "Failed to load file"
          }),
        )
      })
      .finally(() => {
        fileInflight.delete(path)
      })


    fileInflight.set(path, promise)
    return promise
  }

  async function createFile(path: string): Promise<boolean> {
    if (!capabilities().canUseLocalExtFileOps) return false
    const fullPath = directory && !path.startsWith("/") ? `${directory}/${path}` : path
    const success = await apiCreateFile(serverUrl, fullPath, targetUrl)
    if (success) {
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      await listDir(parentDir, { force: true })
    }
    return success
  }

  async function createDir(path: string): Promise<boolean> {
    if (!capabilities().canCreateDirectories) return false
    const fullPath = directory && !path.startsWith("/") ? `${directory}/${path}` : path
    const success = await mkdir(serverUrl, fullPath, targetUrl)
    if (success) {
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      await listDir(parentDir, { force: true })
    }
    return success
  }

  async function deleteFile(path: string): Promise<boolean> {
    if (!capabilities().canUseLocalExtFileOps) return false
    const fullPath = directory && !path.startsWith("/") ? `${directory}/${path}` : path
    const success = await apiDeleteFile(serverUrl, fullPath, targetUrl)
    if (success) {
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      batch(() => {
        if (store.children[parentDir]) {
          setStore("children", parentDir, store.children[parentDir].filter(c => c.path !== path))
        }
        setStore("files", path, undefined!)
      })
      await listDir(parentDir, { force: true })
    }
    return success
  }

  async function deleteDir(path: string): Promise<boolean> {
    if (!capabilities().canUseLocalExtFileOps) return false
    const fullPath = directory && !path.startsWith("/") ? `${directory}/${path}` : path
    const success = await apiDeleteDir(serverUrl, fullPath, targetUrl)
    if (success) {
      const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      batch(() => {
        if (store.children[parentDir]) {
          setStore("children", parentDir, store.children[parentDir].filter(c => c.path !== path))
        }
        const prefix = path + "/"
        for (const d of Object.keys(store.dirs)) {
          if (d === path || d.startsWith(prefix)) setStore("dirs", d, undefined!)
        }
        for (const d of Object.keys(store.children)) {
          if (d === path || d.startsWith(prefix)) setStore("children", d, undefined!)
        }
      })
      await listDir(parentDir, { force: true })
    }
    return success
  }

  const value: FileContextValue = {
    tree: {
      list: listDir,
      state: (dir: string) => store.dirs[dir],
      children: (dir: string) => store.children[dir] ?? [],
      expand,
      collapse,
      isLoaded: (dir: string) => store.dirs[dir]?.loaded ?? false,
    },
    load: loadFile,
    get: (path: string) => store.files[path],
    setContent: (path: string, content: string) => {
      setStore("files", path, produce(f => {
        f.loaded = true
        f.loading = false
        f.error = undefined
        if (!f.content) {
          f.content = { content, encoding: "utf-8" }
          return
        }
        f.content.content = content
      }))
    },
    createFile,
    createDir,
    deleteFile,
    deleteDir,
  }

  return <FileContext.Provider value={value}>{props.children}</FileContext.Provider>
}

export function useFile() {
  const ctx = useContext(FileContext)
  if (!ctx) throw new Error("useFile must be used within FileProvider")
  return ctx
}
