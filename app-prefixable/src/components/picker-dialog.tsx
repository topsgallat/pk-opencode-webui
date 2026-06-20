import { createSignal, createEffect, createMemo, Show, onMount, onCleanup, For } from "solid-js"
import { Portal } from "solid-js/web"
import { X, Search } from "lucide-solid"
import { createBackdropDismiss } from "../utils/backdrop"
import { Spinner } from "./ui/spinner"

interface PickerItem {
  id: string
  title: string
  description?: string
  group?: string
}

interface PickerSection {
  group: string
  items: Array<{ item: PickerItem; idx: number }>
}

interface Props {
  title: string
  items: PickerItem[]
  onSelect: (item: PickerItem) => void
  onClose: () => void
  emptyMessage?: string
  placeholder?: string
  initialFilter?: string
  headerActionLabel?: string
  headerActionPendingLabel?: string
  headerActionDisabled?: boolean
  onHeaderAction?: () => void
  statusMessage?: string | null
  statusTone?: "default" | "error"
  loading?: boolean
  loadingMessage?: string
}

export function PickerDialog(props: Props) {
  const [filter, setFilter] = createSignal(props.initialFilter ?? "")
  const [activeIndex, setActiveIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  let headerActionRef: HTMLButtonElement | undefined
  let closeButtonRef: HTMLButtonElement | undefined

  const filtered = createMemo(() => {
    const q = filter().toLowerCase()
    if (!q) return props.items
    return props.items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.group?.toLowerCase().includes(q),
    )
  })

  const grouped = createMemo<PickerSection[]>(() => {
    const sections = new Map<string, PickerSection>()
    const order: string[] = []

    filtered().forEach((item, idx) => {
      const group = item.group?.trim() || ""
      if (!sections.has(group)) {
        sections.set(group, { group, items: [] })
        order.push(group)
      }
      sections.get(group)?.items.push({ item, idx })
    })

    return order.map((group) => sections.get(group)!).filter((section) => section.items.length > 0)
  })

  createEffect(() => {
    filter()
    setActiveIndex(0)
  })

  createEffect(() => {
    const idx = activeIndex()
    if (!listRef) return
    const el = listRef.querySelector(`[data-index="${idx}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  })

  onMount(() => {
    inputRef?.focus()

    const handler = (e: KeyboardEvent) => {
      const items = filtered()
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        props.onClose()
      } else if (e.key === "ArrowDown" && items.length > 0) {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % items.length)
      } else if (e.key === "ArrowUp" && items.length > 0) {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === "Enter" && items.length > 0) {
        if (document.activeElement === headerActionRef || document.activeElement === closeButtonRef) return
        e.preventDefault()
        const item = items[activeIndex()]
        if (item) {
          props.onSelect(item)
          props.onClose()
        }
      } else if (e.key === "Tab") {
        e.preventDefault()
        const focusable = [inputRef, headerActionRef, closeButtonRef].filter((el): el is HTMLButtonElement | HTMLInputElement => !!el)
        if (focusable.length === 0) return
        const current = focusable.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement)
        const next = current === -1
          ? 0
          : (current + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length
        focusable[next]?.focus()
      }
    }
    window.addEventListener("keydown", handler, true)
    onCleanup(() => window.removeEventListener("keydown", handler, true))
  })

  const backdrop = createBackdropDismiss(() => props.onClose())

  return (
    <Portal>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onMouseDown={backdrop.onMouseDown}
        onClick={backdrop.onClick}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="picker-title"
          class="w-full max-w-md rounded-lg shadow-xl overflow-hidden flex flex-col"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
            height: "min(500px, 80vh)",
          }}
        >
          {/* Header */}
          <div
            class="px-4 py-3 flex items-center justify-between shrink-0"
            style={{ "border-bottom": "1px solid var(--border-base)" }}
          >
            <h2 id="picker-title" class="text-base font-medium" style={{ color: "var(--text-strong)" }}>
              {props.title}
            </h2>
            <div class="flex items-center gap-2">
              <Show when={props.onHeaderAction && props.headerActionLabel}>
                <button
                  ref={headerActionRef}
                  type="button"
                  onClick={() => props.onHeaderAction?.()}
                  disabled={props.headerActionDisabled}
                  class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                  style={{
                    background: "var(--surface-inset)",
                    color: "var(--text-base)",
                    border: "1px solid var(--border-base)",
                    ...(props.headerActionDisabled ? { opacity: "0.6", cursor: "not-allowed" } : {}),
                  }}
                  onMouseEnter={(e) => {
                    if (props.headerActionDisabled) return
                    e.currentTarget.style.background = "color-mix(in srgb, var(--surface-inset) 75%, var(--interactive-base) 25%)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--surface-inset)"
                  }}
                >
                  {props.headerActionDisabled && props.headerActionPendingLabel
                    ? props.headerActionPendingLabel
                    : props.headerActionLabel}
                </button>
              </Show>
              <button
                ref={closeButtonRef}
                onClick={props.onClose}
                class="p-1 rounded transition-colors"
                style={{ color: "var(--icon-weak)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-inset)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                aria-label="Close"
              >
                <X class="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div class="px-4 py-2 shrink-0" style={{ "border-bottom": "1px solid var(--border-base)" }}>
            <div
              class="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-base)",
              }}
            >
              <Search class="w-4 h-4" style={{ color: "var(--icon-weak)" }} />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-controls="picker-listbox"
                aria-expanded="true"
                aria-activedescendant={`picker-option-${activeIndex()}`}
                placeholder={props.placeholder || "Filter..."}
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
                class="flex-1 bg-transparent border-none outline-none text-sm"
                style={{ color: "var(--text-base)" }}
                spellcheck={false}
                autocomplete="off"
              />
            </div>
            <div class="mt-1.5 text-[10px]" style={{ color: "var(--text-weak)" }}>
              <span class="opacity-70">Arrow keys to navigate</span>
              <span class="mx-1.5">-</span>
              <span class="opacity-70">Enter to select</span>
              <span class="mx-1.5">-</span>
              <span class="opacity-70">Esc to close</span>
            </div>
            <Show when={props.statusMessage}>
              <div
                class="mt-2 text-xs"
                style={{ color: props.statusTone === "error" ? "var(--text-critical-base)" : "var(--text-weak)" }}
              >
                {props.statusMessage}
              </div>
            </Show>
          </div>

          {/* List */}
          <div
            ref={listRef}
            id="picker-listbox"
            role="listbox"
            aria-label={props.title}
            class="flex-1 overflow-y-auto min-h-0"
          >
            <Show when={props.loading && filtered().length === 0} fallback={
              <Show when={filtered().length === 0}>
                <div class="px-4 py-8 text-center" style={{ color: "var(--text-weak)" }}>
                  {props.emptyMessage || "No items found"}
                </div>
              </Show>
            }>
              <div class="flex items-center justify-center gap-2 px-4 py-10 text-sm" style={{ color: "var(--text-weak)" }}>
                <Spinner class="w-4 h-4" />
                <span>{props.loadingMessage || "Loading models…"}</span>
              </div>
            </Show>

            <For each={grouped()}>
              {(section) => (
                <div>
                  <Show when={section.group}>
                    <div
                      class="px-4 py-2 text-[11px] font-medium uppercase tracking-wider sticky top-0 z-10"
                      style={{
                        color: "var(--text-weak)",
                        background: "var(--background-base)",
                        "border-bottom": "1px solid var(--border-base)",
                      }}
                    >
                      {section.group}
                    </div>
                  </Show>
                  <For each={section.items}>
                    {(row) => {
                      const isActive = () => row.idx === activeIndex()
                      return (
                        <button
                          type="button"
                          id={`picker-option-${row.idx}`}
                          role="option"
                          aria-selected={isActive()}
                          data-index={row.idx}
                          onClick={() => {
                            props.onSelect(row.item)
                            props.onClose()
                          }}
                          onMouseEnter={() => setActiveIndex(row.idx)}
                          class="w-full px-4 py-2.5 text-left flex flex-col gap-0.5 transition-colors"
                          style={{
                            background: isActive()
                              ? "color-mix(in srgb, var(--interactive-base) 15%, transparent)"
                              : "transparent",
                            "border-left": isActive() ? "3px solid var(--interactive-base)" : "3px solid transparent",
                          }}
                        >
                          <span class="font-medium text-sm" style={{ color: "var(--text-strong)" }}>
                            {row.item.title}
                          </span>
                          <Show when={row.item.description}>
                            <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                              {row.item.description}
                            </span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Portal>
  )
}
