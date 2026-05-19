import { Show, createSignal } from "solid-js"
import { Folder, ShieldAlert, CircleHelp, Loader2, X } from "lucide-solid"
import type { AlertKind } from "../context/global-events"
import type { JSX } from "solid-js"

export interface Project {
  worktree: string
  name?: string
}

export function getFilename(path: string): string {
  return path.split("/").filter(Boolean).pop() || path
}

export function getInitials(name: string): string {
  // Only use ASCII letters for initials
  const clean = name.replace(/[^a-zA-Z0-9\s_-]/g, "")
  if (!clean) return ""
  const parts = clean
    .split(/[-_\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("")
  return parts
}

export function OpenCodeLogo(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 240 300" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: "var(--text-strong)" }}>
      <path d="M180 240H60V120H180V240Z" fill="var(--icon-weak)" />
      <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
    </svg>
  )
}

export function ProjectAvatar(props: {
  project: Project
  size?: "small" | "large"
  selected?: boolean
  badge?: { kind: AlertKind; count: number }
}) {
  const name = () => props.project.name || getFilename(props.project.worktree)
  const initials = () => getInitials(name())
  const size = () => (props.size === "large" ? "w-10 h-10" : "w-8 h-8")
  const iconSize = () => (props.size === "large" ? "w-5 h-5" : "w-4 h-4")

  // pkui button style: white bg, gray border, brand color when selected/hovered
  return (
    <div class="relative shrink-0">
      <div
        class={`${size()} rounded-xl flex items-center justify-center font-medium text-sm shrink-0 transition-all border-2`}
        style={{
          background: props.selected ? "var(--surface-inset)" : "var(--background-base)",
          color: props.selected ? "var(--interactive-base)" : "var(--text-base)",
          "border-color": props.selected ? "var(--interactive-base)" : "var(--border-base)",
          "box-shadow": props.selected ? "0 4px 6px -1px rgb(0 0 0 / 0.1)" : "none",
        }}
      >
        {initials() || <Folder class={iconSize()} />}
      </div>
      <Show when={props.badge}>
        {(b) => <AlertBadge kind={b().kind} count={b().count} />}
      </Show>
    </div>
  )
}

export function ProjectIconItem(props: {
  label: string
  onClick: () => void
  onRemove: () => void
  hintTarget?: boolean
  active?: boolean
  children: JSX.Element
}) {
  const [flyout, setFlyout] = createSignal<{
    left: number
    top: number
  } | null>(null)

  function show(el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    setFlyout({
      left: rect.right + 8,
      top: rect.top + rect.height / 2,
    })
  }

  function hide(el: HTMLElement, next?: EventTarget | null) {
    if (next instanceof Node && el.contains(next)) return
    if (el.matches(":hover") || el.matches(":focus-within")) return
    setFlyout(null)
  }

  return (
    <div
      class="group relative cursor-pointer"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={(e) => hide(e.currentTarget, e.relatedTarget)}
      onFocusIn={(e) => show(e.currentTarget)}
      onFocusOut={(e) => hide(e.currentTarget, e.relatedTarget)}
    >
      <button
        type="button"
        {...(props.hintTarget ? { "data-hint-target": "" } : {})}
        onClick={props.onClick}
        class="block rounded-xl"
        aria-label={props.label}
        aria-current={props.active ? "page" : undefined}
      >
        {props.children}
      </button>
      <Show when={flyout()}>
        {(f) => (
          <div
            class="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap"
            aria-hidden="true"
            style={{
              left: `${f().left}px`,
              top: `${f().top}px`,
              background: "var(--background-base)",
              color: "var(--text-strong)",
              border: "1px solid var(--border-base)",
              "box-shadow": "0 12px 32px rgba(0, 0, 0, 0.16)",
            }}
          >
            {props.label}
          </div>
        )}
      </Show>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
        class="absolute -top-1 -right-1 w-4 h-4 rounded-full hidden group-hover:flex items-center justify-center"
        style={{ background: "var(--surface-strong)", color: "var(--text-base)" }}
      >
        <X class="w-3 h-3" />
      </button>
    </div>
  )
}

function AlertBadge(props: { kind: AlertKind; count: number }) {
  const color = () => {
    if (props.kind === "permission") return "var(--interactive-base)"
    if (props.kind === "question") return "var(--icon-warning-base)"
    return "var(--text-weak)"
  }

  const Icon = () => {
    if (props.kind === "permission") return <ShieldAlert class="w-2.5 h-2.5" />
    if (props.kind === "question") return <CircleHelp class="w-2.5 h-2.5" />
    return <Loader2 class="w-2.5 h-2.5 animate-spin" />
  }

  const label = () => {
    const k = props.kind === "permission" ? "permission request" : props.kind === "question" ? "question" : "busy session"
    return props.count === 1 ? `1 ${k}` : `${props.count} ${k}s`
  }

  return (
    <div
      class="absolute -top-1.5 -right-1.5 flex items-center gap-px rounded-full px-0.5 min-w-[1rem] h-4 justify-center"
      title={label()}
      aria-label={label()}
      style={{
        background: "var(--background-base)",
        color: color(),
        border: `1.5px solid ${color()}`,
        "font-size": "9px",
        "font-weight": "600",
        "line-height": "1",
      }}
    >
      <Icon />
      <Show when={props.count > 1}>
        <span aria-hidden="true">{props.count}</span>
      </Show>
    </div>
  )
}
