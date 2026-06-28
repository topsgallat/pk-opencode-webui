import {
    type ParentProps,
    createSignal,
    createMemo,
    Show,
    For,
    createEffect,
    onMount,
    onCleanup,
} from "solid-js"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { useSDK } from "../context/sdk"
import { useEvents } from "../context/events"
import { useSync } from "../context/sync"
import { useProviders } from "../context/providers"
import { useLayout } from "../context/layout"
import { usePermission } from "../context/permission"
import { useBranding } from "../context/branding"
import { base64Encode } from "../utils/path"
import { getServerCapabilities } from "../utils/server-capabilities"
import {
    OpenCodeLogo,
    getFilename,
    type Project,
} from "../components/shared"
import { useRecentProjects } from "../context/recent-projects"
import type { Session } from "../sdk/client"
import { groupSessionsByDate } from "./layout"
import {
    Plus,
    MessageCircle,
    FileCode,
    Settings,
    Loader2,
    CircleHelp,
    ShieldAlert,
    Archive,
    ArchiveRestore,
    ChevronDown,
    Search,
    X,
    Trash2,
    Pencil,
    MoreHorizontal,
    FolderOpen,
    Server,
    Pin,
    PinOff,
    Sparkles,
    Check,
} from "lucide-solid"
import { sessionHasQuestion, buildChildMap } from "../utils/session-tree-request"
import { useServer } from "../context/server"
import { getServerKey, type ServerConfig } from "../utils/servers"
import { suggestSessionTitle } from "../utils/ai-rename"
import { MAX_PINNED, loadPinnedSessionIds, savePinnedSessionIds } from "../utils/session-pins"
import { getServerUrl } from "../utils/path"

export function MobileLayout(props: ParentProps & {
    onOpenProject?: () => void
    unseenSessionIds?: () => Set<string>
    unseenProjectCount?: () => number
}) {
    const { client, directory } = useSDK()
    const events = useEvents()
    const sync = useSync()
    const providers = useProviders()
    const layout = useLayout()
    const permission = usePermission()
    const location = useLocation()
    const navigate = useNavigate()
    const branding = useBranding()
    const server = useServer()
    const recent = useRecentProjects()
    const selectedServerLabel = createMemo(() => server.selectedServer()?.name || server.selectedServer()?.url || "Server")

    
    const [sessions, setSessions] = createSignal<Session[]>([])
    const [loading, setLoading] = createSignal(true)
    const [mobileTab, setMobileTab] = createSignal<"chat" | "sessions" | "review" | "settings">("chat")
    const [searchQuery, setSearchQuery] = createSignal("")
    const [showArchived, setShowArchived] = createSignal(false)
    const [menuSession, setMenuSession] = createSignal<Session | null>(null)
    const [showProjectHistory, setShowProjectHistory] = createSignal(false)
    const [historyProjects, setHistoryProjects] = createSignal<Project[]>([])
    const [showServerSheet, setShowServerSheet] = createSignal(false)

    const [renamingId, setRenamingId] = createSignal<string | null>(null)
    const [editTitle, setEditTitle] = createSignal("")
    const [aiRenamingId, setAiRenamingId] = createSignal<string | null>(null)
    const [renameError, setRenameError] = createSignal<{ id: string; msg: string } | null>(null)
    const renameErrorTimer = { id: undefined as ReturnType<typeof setTimeout> | undefined }

    const [pinnedIds, setPinnedIds] = createSignal<string[]>([])
    const pinnedLoadState = { id: 0 }
    const pinnedSaveState = { promise: Promise.resolve() }

    function refreshPinnedIds() {
        const loadId = ++pinnedLoadState.id
        const serverKey = server.serverKey()
        void loadPinnedSessionIds(getServerUrl(), serverKey, directory)
            .then((ids) => {
                if (loadId === pinnedLoadState.id) setPinnedIds(ids)
            })
            .catch((e: unknown) => {
                if (loadId === pinnedLoadState.id) setPinnedIds([])
                console.error("Failed to load pinned sessions state:", e)
            })
    }

    function savePinnedIds(ids: string[]) {
        setPinnedIds(ids)
        const serverKey = server.serverKey()
        pinnedSaveState.promise = pinnedSaveState.promise
            .catch(() => undefined)
            .then(() => savePinnedSessionIds(getServerUrl(), serverKey, directory, ids))
            .catch((e: unknown) => {
                console.error("Failed to save pinned session IDs:", e)
            })
    }

    function pinSession(id: string) {
        if (pinnedIds().includes(id) || pinnedIds().length >= MAX_PINNED) return
        savePinnedIds([...pinnedIds(), id])
    }

    function unpinSession(id: string) {
        if (!pinnedIds().includes(id)) return
        savePinnedIds(pinnedIds().filter((pid) => pid !== id))
    }

    function renameSession(session: Session, title: string) {
        const trimmed = title.trim()
        if (!trimmed || trimmed === session.title) return
        const prevTitle = session.title
        setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, title: trimmed } : s)),
        )
        client.session.update({ sessionID: session.id, title: trimmed })
            .catch((err: unknown) => {
                console.error("Failed to rename session:", err)
                setSessions((prev) =>
                    prev.map((s) =>
                        s.id === session.id ? { ...s, title: prevTitle } : s,
                    ),
                )
            })
    }

    function showRenameError(id: string, msg = "Rename failed") {
        if (renameErrorTimer.id !== undefined) clearTimeout(renameErrorTimer.id)
        setRenameError({ id, msg })
        renameErrorTimer.id = setTimeout(() => {
            setRenameError((prev) => prev?.id === id ? null : prev)
            renameErrorTimer.id = undefined
        }, 3000)
    }

    function startAiRename(session: Session) {
        if (aiRenamingId()) return
        setAiRenamingId(session.id)
        setMenuSession(null)
        setRenameError(null)

        const cached = sync.messages(session.id)
        const pending = cached.length > 0
            ? Promise.resolve(cached)
            : client.session.messages({ sessionID: session.id }).then((res) => res.data ?? [])

        pending
            .then((msgs) => {
                if (!msgs.length) {
                    showRenameError(session.id, "No messages to rename")
                    setAiRenamingId(null)
                    return
                }
                return suggestSessionTitle(client, session.id, msgs, providers.selectedModel, providers.selectedAgent)
            })
            .then((suggestion) => {
                if (!suggestion) return
                setEditTitle(suggestion)
                setRenamingId(session.id)
                setMenuSession(session)
            })
            .catch((err: unknown) => {
                console.error("AI rename failed:", err)
                showRenameError(session.id)
            })
            .finally(() => setAiRenamingId(null))
    }

    onCleanup(() => {
        if (renameErrorTimer.id !== undefined) clearTimeout(renameErrorTimer.id)
    })

    function openProjectHistory() {
        const items = recent.projects().map((p) => ({ worktree: p.path, name: p.name }))
        if (items.length > 0) {
            setHistoryProjects(items)
            setShowProjectHistory(true)
            return
        }
        props.onOpenProject?.()
    }

    const dirSlug = createMemo(() => directory ? base64Encode(directory) : "")
    const projectName = createMemo(() => getFilename(directory || ""))

    // Track active session from URL
    const isSessionView = createMemo(() => location.pathname.includes("/session/"))
    const isSettingsView = createMemo(() => location.pathname.endsWith("/settings"))

    // Auto-switch to correct tab based on URL
    createEffect(() => {
        if (isSettingsView()) {
            setMobileTab("settings")
        } else if (isSessionView()) {
            setMobileTab("chat")
        }
    })

    createEffect(() => {
        server.serverKey()
        directory
        setShowProjectHistory(false)
        setHistoryProjects([])
        setShowServerSheet(false)
        refreshPinnedIds()
    })

    onMount(() => {
        loadRootSessions()

        function handleFocus() {
            refreshPinnedIds()
        }

        function handleVisibilityChange() {
            if (document.visibilityState === "visible") refreshPinnedIds()
        }

        window.addEventListener("focus", handleFocus)
        document.addEventListener("visibilitychange", handleVisibilityChange)
        
        const dir = directory
        if (dir) {
            const lastSessionKey = `opencode.lastSession.${server.serverKey()}.${dir}`
            const lastSession = localStorage.getItem(lastSessionKey)
            if (lastSession) {
                const currentPath = location.pathname
                if (!currentPath.includes("/session/") || currentPath.endsWith("/session")) {
                    navigate(`/${dirSlug()}/session/${lastSession}`, { replace: true })
                }
            }
        }

        onCleanup(() => {
            window.removeEventListener("focus", handleFocus)
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        })
    })

    createEffect(() => {
        const unsub = events.subscribe((event) => {
            if (
                event.type === "session.created" ||
                event.type === "session.updated" ||
                event.type === "session.deleted"
            ) {
                loadRootSessions()
            }
        })
        onCleanup(unsub)
    })

    async function loadRootSessions() {
        try {
            setLoading(true)
            const res = await client.session.list({ roots: true })
            if (res.data) {
                const all = Object.values(res.data) as Session[]
                setSessions(all)
                return
            }
            setSessions([])
        } catch {
            setSessions([])
        } finally {
            setLoading(false)
        }
    }

    

    async function createNewSession() {
        try {
            const res = await client.session.create({})
            if (res.data) {
                setSessions((prev) => [res.data as Session, ...prev])
                navigate(`/${dirSlug()}/session/${res.data.id}`)
                setMobileTab("chat")
            }
        } catch (e) {
            console.error("Failed to create session:", e)
        }
    }

    function navigateToSession(id: string) {
        navigate(`/${dirSlug()}/session/${id}`)
        setMobileTab("chat")
        setMenuSession(null)
    }

    async function deleteSession(session: Session) {
        try {
            await client.session.delete({ sessionID: session.id })
            unpinSession(session.id)
            setSessions((prev) => prev.filter((s) => s.id !== session.id))
            setMenuSession(null)
            // If deleting the currently active session, go to session list
            if (location.pathname.includes(session.id)) {
                navigate(`/${dirSlug()}/session`)
                setMobileTab("sessions")
            }
        } catch (e) {
            console.error("Failed to delete session:", e)
        }
    }

    async function archiveSession(session: Session) {
        try {
            await client.session.update({
                sessionID: session.id,
                time: { archived: Date.now() },
            })
            unpinSession(session.id)
            setMenuSession(null)
            loadRootSessions()
        } catch (e) {
            console.error("Failed to archive session:", e)
        }
    }

    // Filtered sessions
    const activeSessions = createMemo(() =>
        sessions()
            .filter((s) => s.directory === directory && !s.time?.archived)
            .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    )

    const archivedSessions = createMemo(() =>
        sessions()
            .filter((s) => s.directory === directory && !!s.time?.archived)
            .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    )

    const filteredSessions = createMemo(() => {
        const q = searchQuery().toLowerCase().trim()
        const list = showArchived() ? archivedSessions() : activeSessions()
        if (!q) return list
        return list.filter((s) => (s.title || "").toLowerCase().includes(q))
    })

    const pinnedSessions = createMemo(() => {
        if (showArchived()) return []
        const ids = pinnedIds()
        if (!ids.length) return []
        const list = filteredSessions()
        return ids
            .map((id) => list.find((s) => s.id === id))
            .filter((s): s is Session => !!s)
    })

    const unpinnedSessions = createMemo(() => {
        if (showArchived()) return filteredSessions()
        const pins = new Set(pinnedIds())
        return filteredSessions().filter((s) => !pins.has(s.id))
    })

    const groupedSessions = createMemo(() =>
        groupSessionsByDate(unpinnedSessions(), new Date())
    )

    const childMap = createMemo(() => buildChildMap(sync.sessions()))

    function isActive(id: string) {
        return location.pathname.includes(id)
    }

    function hasUnseen(id: string) {
        return props.unseenSessionIds?.().has(id) ?? false
    }

    // Session status icon
    function SessionIcon(props: { session: Session }) {
        const s = props.session
        if (permission.pendingForSession(s.id).length > 0) {
            return <ShieldAlert class="w-5 h-5" style={{ color: "var(--interactive-base)" }} />
        }
        if (sessionHasQuestion(sync.sessions(), events.pendingQuestions, s.id, childMap())) {
            return <CircleHelp class="w-5 h-5" style={{ color: "var(--icon-warning-base)" }} />
        }
        if (events.status[s.id]?.type === "busy" || events.status[s.id]?.type === "retry") {
            return <Loader2 class="w-5 h-5 animate-spin" />
        }
        return <MessageCircle class="w-5 h-5" />
    }

    // ──── Sessions Tab Content ────
    function SessionsTab() {
        return (
            <div class="flex flex-col h-full" style={{ background: "var(--background-base)" }}>
                {/* Header */}
                <div
                    class="flex items-center justify-between px-4 py-3 shrink-0"
                    style={{ "border-bottom": "1px solid var(--border-base)", background: "var(--background-stronger)" }}
                >
                    <button
                        onClick={openProjectHistory}
                        class="flex items-center gap-2 max-w-[70%] rounded-md px-2 py-1.5 -ml-2 active:opacity-70 transition-opacity text-left min-w-0"
                        style={{ background: "var(--surface-inset)" }}
                        aria-label="Switch Project"
                    >
                        <OpenCodeLogo class="w-5 h-5 shrink-0 rounded" />
                        <span class="flex items-center gap-1 min-w-0">
                            <span class="font-semibold text-sm truncate" style={{ color: "var(--text-strong)" }}>
                                {projectName() || "Select Project..."}
                            </span>
                            <Show when={(props.unseenProjectCount?.() ?? 0) > 0}>
                                <span class="shrink-0 px-1.5 rounded-full text-[10px] font-semibold leading-4" style={{ background: "var(--status-success-text)", color: "white" }}>
                                    {props.unseenProjectCount!()}
                                </span>
                            </Show>
                        </span>
                        <ChevronDown class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                    </button>
                    <button
                        onClick={createNewSession}
                        class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        style={{
                            background: "var(--interactive-base)",
                            color: "white",
                        }}
                    >
                        <Plus class="w-4 h-4" />
                        <span>New</span>
                    </button>
                </div>

                {/* Search */}
                <div class="px-4 py-2 shrink-0" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                    <div
                        class="flex items-center gap-2 px-3 py-2 rounded-lg"
                        style={{ background: "var(--surface-inset)" }}
                    >
                        <Search class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                        <input
                            type="text"
                            placeholder="Search sessions..."
                            value={searchQuery()}
                            onInput={(e) => setSearchQuery(e.currentTarget.value)}
                            class="flex-1 bg-transparent border-none outline-none text-sm"
                            style={{ color: "var(--text-base)" }}
                        />
                        <Show when={searchQuery()}>
                            <button onClick={() => setSearchQuery("")} class="p-0.5">
                                <X class="w-3.5 h-3.5" style={{ color: "var(--icon-weak)" }} />
                            </button>
                        </Show>
                    </div>
                </div>

                {/* Toggle Archived / Active */}
                <div class="px-4 py-2 shrink-0 flex gap-2">
                    <button
                        onClick={() => setShowArchived(false)}
                        class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors text-center"
                        style={{
                            background: !showArchived() ? "var(--interactive-base)" : "var(--surface-inset)",
                            color: !showArchived() ? "white" : "var(--text-weak)",
                        }}
                    >
                        Active ({activeSessions().length})
                    </button>
                    <button
                        onClick={() => setShowArchived(true)}
                        class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors text-center"
                        style={{
                            background: showArchived() ? "var(--interactive-base)" : "var(--surface-inset)",
                            color: showArchived() ? "white" : "var(--text-weak)",
                        }}
                    >
                        Archived ({archivedSessions().length})
                    </button>
                </div>

                {/* Session List */}
                <div class="flex-1 overflow-auto min-h-0">
                    <Show when={!loading()} fallback={
                        <div class="flex items-center justify-center py-12">
                            <div class="w-5 h-5">
                                <svg viewBox="0 0 24 24" class="w-5 h-5 animate-spin" style={{ color: "var(--text-interactive-base)" }}>
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25" />
                                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="4" fill="none" />
                                </svg>
                            </div>
                        </div>
                    }>
                        <Show when={filteredSessions().length > 0} fallback={
                            <div class="flex flex-col items-center justify-center py-12 text-center">
                                <MessageCircle class="w-8 h-8 mb-2" style={{ color: "var(--icon-weak)", opacity: 0.3 }} />
                                <span class="text-sm" style={{ color: "var(--text-weak)" }}>
                                    {searchQuery() ? "No matching sessions" : showArchived() ? "No archived sessions" : "No sessions yet"}
                                </span>
                            </div>
                        }>
                            <Show when={!showArchived() && pinnedSessions().length > 0}>
                                <div>
                                    <div
                                        class="px-4 py-2 text-[11px] font-medium uppercase tracking-wider sticky top-0 z-10"
                                        style={{ color: "var(--text-weak)", background: "var(--background-stronger)" }}
                                    >
                                        Pinned
                                    </div>
                                    <For each={pinnedSessions()}>
                                        {(session) => (
                                            <div
                                                class="mobile-session-item"
                                                style={{
                                                    background: isActive(session.id) ? "var(--surface-inset)" : "transparent",
                                                }}
                                                onClick={() => navigateToSession(session.id)}
                                            >
                                                <span class="shrink-0" style={{ color: "var(--icon-weak)" }}>
                                                    <SessionIcon session={session} />
                                                </span>
                                                <div class="flex-1 min-w-0">
                                                    <div class="flex items-center gap-1 min-w-0">
                                                        <div
                                                            class="text-sm truncate min-w-0"
                                                            style={{ color: isActive(session.id) ? "var(--text-interactive-base)" : "var(--text-base)" }}
                                                        >
                                                            {session.title || "Untitled"}
                                                        </div>
                                                        <Show when={hasUnseen(session.id)}>
                                                            <span class="shrink-0 w-2 h-2 rounded-full" style={{ background: "var(--status-success-text)" }} />
                                                        </Show>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setMenuSession(menuSession()?.id === session.id ? null : session)
                                                    }}
                                                    class="p-2 -mr-2 shrink-0"
                                                    style={{ color: "var(--icon-weak)" }}
                                                >
                                                    <MoreHorizontal class="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </Show>
                            <For each={groupedSessions()}>
                                {(group) => (
                                    <div>
                                        <div
                                            class="px-4 py-2 text-[11px] font-medium uppercase tracking-wider sticky top-0 z-10"
                                            style={{ color: "var(--text-weak)", background: "var(--background-stronger)" }}
                                        >
                                            {group.label}
                                        </div>
                                        <For each={group.sessions}>
                                            {(session) => (
                                                <div
                                                    class="mobile-session-item"
                                                    style={{
                                                        background: isActive(session.id) ? "var(--surface-inset)" : "transparent",
                                                    }}
                                                    onClick={() => navigateToSession(session.id)}
                                                >
                                                    <span class="shrink-0" style={{ color: "var(--icon-weak)" }}>
                                                        <SessionIcon session={session} />
                                                    </span>
                                                    <div class="flex-1 min-w-0">
                                                        <div class="flex items-center gap-1 min-w-0">
                                                            <div
                                                                class="text-sm truncate min-w-0"
                                                                style={{ color: isActive(session.id) ? "var(--text-interactive-base)" : "var(--text-base)" }}
                                                            >
                                                                {session.title || "Untitled"}
                                                            </div>
                                                            <Show when={hasUnseen(session.id)}>
                                                                <span class="shrink-0 w-2 h-2 rounded-full" style={{ background: "var(--status-success-text)" }} />
                                                            </Show>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setMenuSession(menuSession()?.id === session.id ? null : session)
                                                        }}
                                                        class="p-2 -mr-2 shrink-0"
                                                        style={{ color: "var(--icon-weak)" }}
                                                    >
                                                        <MoreHorizontal class="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </For>
                                    </div>
                                )}
                            </For>
                        </Show>
                    </Show>
                </div>

                {/* Context Menu Bottom Sheet */}
                <Show when={menuSession()}>
                    {(session) => (
                        <div class="fixed inset-0 z-50" onClick={() => setMenuSession(null)}>
                            <div class="absolute inset-0 bg-black/40" />
                            <div
                                class="absolute bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden"
                                style={{ background: "var(--background-base)", "padding-bottom": "env(safe-area-inset-bottom, 16px)" }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Sheet handle */}
                                <div class="flex justify-center py-3">
                                    <div class="w-10 h-1 rounded-full" style={{ background: "var(--border-strong)" }} />
                                </div>
                                <Show when={renamingId() === session().id} fallback={
                                    <div class="px-4 pb-3 text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>
                                        {session().title || "Untitled"}
                                    </div>
                                }>
                                    <div class="px-4 pb-3">
                                        <div class="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={editTitle()}
                                                onInput={(e) => setEditTitle(e.currentTarget.value)}
                                                class="flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                                                style={{
                                                    background: "var(--surface-inset)",
                                                    color: "var(--text-base)",
                                                    border: "1px solid var(--interactive-base)",
                                                }}
                                                placeholder="Session title"
                                                ref={(el) => queueMicrotask(() => { el?.focus(); el?.select() })}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault()
                                                        renameSession(session(), editTitle())
                                                        setRenamingId(null)
                                                    }
                                                    if (e.key === "Escape") {
                                                        e.preventDefault()
                                                        setRenamingId(null)
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    renameSession(session(), editTitle())
                                                    setRenamingId(null)
                                                }}
                                                class="p-2 rounded-lg shrink-0"
                                                style={{ background: "var(--interactive-base)", color: "white" }}
                                                aria-label="Save title"
                                            >
                                                <Check class="w-4 h-4" />
                                            </button>
                                        </div>
                                        <Show when={renameError()?.id === session().id}>
                                            <div class="text-xs mt-1" style={{ color: "var(--text-critical-base)" }}>
                                                {renameError()?.msg}
                                            </div>
                                        </Show>
                                    </div>
                                </Show>
                                <div style={{ "border-top": "1px solid var(--border-base)" }}>
                                    <Show when={!showArchived() && (pinnedIds().includes(session().id) || pinnedIds().length < MAX_PINNED)}>
                                        <button
                                            class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                            style={{ color: "var(--text-base)" }}
                                            onClick={() => {
                                                if (pinnedIds().includes(session().id)) {
                                                    unpinSession(session().id)
                                                } else {
                                                    pinSession(session().id)
                                                }
                                                setMenuSession(null)
                                            }}
                                        >
                                            <Show when={pinnedIds().includes(session().id)} fallback={
                                                <Pin class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            }>
                                                <PinOff class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            </Show>
                                            {pinnedIds().includes(session().id) ? "Unpin" : "Pin to top"}
                                        </button>
                                        <button
                                            class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                            style={{ color: "var(--text-base)" }}
                                            onClick={() => {
                                                setEditTitle(session().title || "")
                                                setRenamingId(session().id)
                                            }}
                                        >
                                            <Pencil class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            Rename
                                        </button>
                                        <button
                                            class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                            style={{
                                                color: "var(--text-base)",
                                                opacity: aiRenamingId() ? 0.6 : 1,
                                            }}
                                            disabled={!!aiRenamingId()}
                                            onClick={() => startAiRename(session())}
                                        >
                                            <Show when={aiRenamingId() === session().id} fallback={
                                                <Sparkles class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            }>
                                                <Loader2 class="w-5 h-5 animate-spin" style={{ color: "var(--icon-weak)" }} />
                                            </Show>
                                            {aiRenamingId() === session().id ? "Suggesting title..." : "Rename with AI"}
                                        </button>
                                        <button
                                            class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                            style={{ color: "var(--text-base)" }}
                                            onClick={() => archiveSession(session())}
                                        >
                                            <Archive class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            Archive
                                        </button>
                                        <div class="my-1" role="separator" style={{ "border-top": "1px solid var(--border-base)" }} />
                                    </Show>
                                    <Show when={showArchived()}>
                                        <button
                                            class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                            style={{ color: "var(--text-base)" }}
                                            onClick={() => {
                                                client.session.update({
                                                    sessionID: session().id,
                                                    time: { archived: 0 },
                                                }).then(() => { setMenuSession(null); loadRootSessions() })
                                            }}
                                        >
                                            <ArchiveRestore class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                            Restore from Archive
                                        </button>
                                    </Show>
                                    <button
                                        class="w-full flex items-center gap-3 px-4 py-3.5 text-sm"
                                        style={{ color: "var(--interactive-critical)" }}
                                        onClick={() => deleteSession(session())}
                                    >
                                        <Trash2 class="w-5 h-5" />
                                        Delete
                                    </button>
                                </div>
                                {/* Cancel */}
                                <div
                                    class="mx-4 mt-2 mb-2"
                                    style={{ "border-top": "1px solid var(--border-base)" }}
                                >
                                    <button
                                        class="w-full py-3.5 text-sm font-medium text-center"
                                        style={{ color: "var(--text-base)" }}
                                        onClick={() => setMenuSession(null)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </Show>

            </div>
        )
    }

    // ──── Review Tab Content ────
    function ReviewTab() {
        return (
            <div class="flex flex-col h-full" style={{ background: "var(--background-base)" }}>
                <div
                    class="flex items-center justify-between px-4 py-3 shrink-0"
                    style={{ "border-bottom": "1px solid var(--border-base)", background: "var(--background-stronger)" }}
                >
                    <span class="font-semibold text-sm" style={{ color: "var(--text-strong)" }}>
                        Review
                    </span>
                </div>
                <div class="flex-1 overflow-auto min-h-0">
                    {/* ReviewPanel is rendered inside Session component,
                on mobile we just indicate to open the review panel */}
                    <div class="flex flex-col items-center justify-center h-full text-center px-4">
                        <FileCode class="w-10 h-10 mb-3" style={{ color: "var(--icon-weak)", opacity: 0.3 }} />
                        <span class="text-sm mb-1" style={{ color: "var(--text-weak)" }}>
                            Review Panel
                        </span>
                        <span class="text-xs" style={{ color: "var(--text-weak)", opacity: 0.7 }}>
                            Changes will appear here when the AI modifies files
                        </span>
                        <Show when={!layout.review.opened()}>
                            <button
                                onClick={() => layout.review.open()}
                                class="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
                                style={{
                                    background: "var(--interactive-base)",
                                    color: "white",
                                }}
                            >
                                Open Review Panel
                            </button>
                        </Show>
                    </div>
                </div>
            </div>
        )
    }

    // ──── Main Return ────
    return (
        <div class="flex flex-col mobile-viewport" style={{ background: "var(--background-stronger)" }}>


            {/* Content Area */}
            <div class="flex-1 overflow-hidden min-h-0 relative">
                <div
                    class="absolute inset-0 flex flex-col"
                    style={{ "z-index": (mobileTab() === "chat" || mobileTab() === "settings") ? 10 : 0, visibility: (mobileTab() === "chat" || mobileTab() === "settings") ? "visible" : "hidden" }}
                >
                    {props.children}
                </div>
                <div
                    class="absolute inset-0 flex flex-col bg-[var(--background-stronger)]"
                    style={{ "z-index": mobileTab() === "sessions" ? 10 : 0, visibility: mobileTab() === "sessions" ? "visible" : "hidden" }}
                >
                    <SessionsTab />
                </div>
                <div
                    class="absolute inset-0 flex flex-col bg-[var(--background-stronger)]"
                    style={{ "z-index": mobileTab() === "review" ? 10 : 0, visibility: mobileTab() === "review" ? "visible" : "hidden" }}
                >
                    <ReviewTab />
                </div>
            </div>

            {/* Bottom Tab Bar */}
            <nav class="mobile-tab-bar shrink-0">
                <button
                    class={mobileTab() === "chat" ? "active" : ""}
                    onClick={() => {
                        setMobileTab("chat")
                        if (isSettingsView()) {
                            navigate(`/${dirSlug()}/session`)
                        }
                    }}
                >
                    <MessageCircle class="w-5 h-5" />
                    <span>Chat</span>
                </button>
                <button
                    class={mobileTab() === "sessions" ? "active" : ""}
                    onClick={() => {
                        setMobileTab("sessions")
                        void loadRootSessions()
                    }}
                >
                    <span class="relative inline-flex items-center justify-center">
                        <ChevronDown class="w-5 h-5" />
                        <Show when={(props.unseenProjectCount?.() ?? 0) > 0}>
                            <span class="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center" style={{ background: "var(--status-success-text)", color: "white" }}>
                                {props.unseenProjectCount!()}
                            </span>
                        </Show>
                    </span>
                    <span>Sessions</span>
                </button>
                <button
                    class={mobileTab() === "review" ? "active" : ""}
                    onClick={() => {
                        setMobileTab("review")
                        layout.review.open()
                    }}
                >
                    <FileCode class="w-5 h-5" />
                    <span>Review</span>
                </button>
                <button
                    class={mobileTab() === "settings" ? "active" : ""}
                    onClick={() => {
                        setMobileTab("settings")
                        navigate(`/${dirSlug()}/settings`)
                    }}
                >
                    <Settings class="w-5 h-5" />
                    <span>Settings</span>
                </button>
                <button
                    onClick={() => setShowServerSheet(true)}
                    style={{ color: getServerCapabilities(server.selectedServer()).isRemoteBackend ? "var(--text-interactive-base)" : "var(--text-weak)" }}
                >
                    <Server class="w-5 h-5" />
                    <span class="max-w-16 truncate">{selectedServerLabel()}</span>
                </button>
            </nav>
            <Show when={showProjectHistory()}>
                <div class="fixed inset-0 z-50" onClick={() => setShowProjectHistory(false)}>
                    <div class="absolute inset-0 bg-black/40" />
                    <div
                        class="absolute bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden flex flex-col max-h-[80vh]"
                        style={{ background: "var(--background-base)", "padding-bottom": "env(safe-area-inset-bottom, 16px)" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div class="flex justify-center py-3 shrink-0">
                            <div class="w-10 h-1 rounded-full" style={{ background: "var(--border-strong)" }} />
                        </div>
                        <div class="px-4 pb-3 text-sm font-medium shrink-0" style={{ color: "var(--text-strong)" }}>
                            Recent Projects
                        </div>
                        <div class="overflow-y-auto min-h-0" style={{ "border-top": "1px solid var(--border-base)" }}>
                            <For each={historyProjects()}>
                                {(project) => (
                                    <button
                                        class="w-full flex flex-col px-4 py-3 text-left active:opacity-70 transition-opacity"
                                        style={{ "border-bottom": "1px solid var(--border-base)" }}
                                        onClick={() => {
                                            setShowProjectHistory(false)
                                            navigate(`/${base64Encode(project.worktree)}/session`)
                                            setMobileTab("chat")
                                        }}
                                    >
                                        <span
                                            class="text-sm font-medium truncate w-full"
                                            style={{ color: directory === project.worktree ? "var(--text-interactive-base)" : "var(--text-strong)" }}
                                        >
                                            {project.name || getFilename(project.worktree)}
                                        </span>
                                        <span class="text-xs truncate w-full mt-0.5" style={{ color: "var(--text-weak)" }}>
                                            {project.worktree}
                                        </span>
                                    </button>
                                )}
                            </For>
                        </div>
                        <div class="shrink-0" style={{ "border-top": "1px solid var(--border-base)" }}>
                            <button
                                class="w-full flex items-center gap-3 px-4 py-4 text-sm active:opacity-70 transition-opacity"
                                style={{ color: "var(--text-base)" }}
                                onClick={() => {
                                    setShowProjectHistory(false)
                                    props.onOpenProject?.()
                                }}
                            >
                                <FolderOpen class="w-5 h-5" style={{ color: "var(--icon-weak)" }} />
                                <span>Browse / Open new project...</span>
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
            <Show when={showServerSheet()}>
                <div class="fixed inset-0 z-50" onClick={() => setShowServerSheet(false)}>
                    <div class="absolute inset-0 bg-black/40" />
                    <div
                        class="absolute bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden flex flex-col"
                        style={{ background: "var(--background-base)", "padding-bottom": "env(safe-area-inset-bottom, 16px)" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div class="flex justify-center py-3 shrink-0">
                            <div class="w-10 h-1 rounded-full" style={{ background: "var(--border-strong)" }} />
                        </div>
                        <div class="px-4 pb-3 text-sm font-medium shrink-0" style={{ color: "var(--text-strong)" }}>
                            Switch Server
                        </div>
                        <div style={{ "border-top": "1px solid var(--border-base)" }}>
                            <For each={server.servers()}>
                                {(s) => (
                                    <button
                                        class="w-full flex items-center gap-3 px-4 py-3.5 text-sm active:opacity-70 transition-opacity"
                                        onClick={() => {
                                            setSessions([])
                                            setSearchQuery("")
                                            setShowArchived(false)
                                            setMenuSession(null)
                                            if (location.pathname.includes("/session/")) {
                                                sessionStorage.setItem("opencode.serverSwitchHome", "1")
                                            }
                                            server.setSelectedServer(s.id)
                                            setShowServerSheet(false)
                                            navigate("/", { replace: true })
                                        }}
                                    >
                                        <Server class="w-5 h-5 shrink-0" style={{ color: "var(--icon-weak)" }} />
                                        <div class="flex-1 text-left min-w-0">
                                            <div class="font-medium truncate" style={{ color: server.selectedServer()?.id === s.id ? "var(--text-interactive-base)" : "var(--text-strong)" }}>
                                                {s.name}
                                            </div>
                                            <div class="text-xs truncate mt-0.5" style={{ color: "var(--text-weak)" }}>{s.url}</div>
                                        </div>
                                        <Show when={server.selectedServer()?.id === s.id}>
                                            <div class="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--text-interactive-base)" }} />
                                        </Show>
                                    </button>
                                )}
                            </For>
                        </div>
                        <div class="mx-4 mt-2 mb-2" style={{ "border-top": "1px solid var(--border-base)" }}>
                            <button
                                class="w-full py-3.5 text-sm font-medium text-center"
                                style={{ color: "var(--text-base)" }}
                                onClick={() => setShowServerSheet(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    )
}
