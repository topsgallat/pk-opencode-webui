import { createEffect, createMemo, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { marked } from "marked"
import DOMPurify from "dompurify"

marked.setOptions({
  gfm: true,
  breaks: true,
})

const config = {
  USE_PROFILES: { html: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style", "script"],
  FORBID_CONTENTS: ["style"],
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) {
    console.error("DOMPurify is not supported in this environment")
    return ""
  }
  return DOMPurify.sanitize(html, config)
}

function wrapTables(html: string) {
  if (!html.includes("<table") || typeof document === "undefined") return html

  const template = document.createElement("template")
  template.innerHTML = html

  for (const table of template.content.querySelectorAll("table")) {
    if (table.parentElement?.classList.contains("markdown-table-scroll")) continue
    const wrapper = document.createElement("div")
    wrapper.className = "markdown-table-scroll"
    wrapper.dataset.scrollable = "true"
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  }

  return template.innerHTML
}

interface MarkdownProps {
  content: string
  class?: string
  style?: JSX.CSSProperties
  onFileClick?: (path: string) => void
  linkifyFiles?: boolean
  copyCodeBlocks?: boolean
}

const FILE_LINK_RE = /(?<![\w./-])((?:\.\.?\/|\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:md|markdown|html|htm|tsx|ts|jsx|js|json|ya?ml|txt|py|go|rs|sh|bash|c|cc|cpp|h|hpp|toml|xml|css)(?::\d+(?::\d+)?)?)(?![\w./-])/g

function shouldSkipNode(node: Node) {
  const parent = node.parentElement
  return !!parent?.closest("a, code, pre, script, style")
}

function enhanceFileLinks(root: HTMLElement, onFileClick: (path: string) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.nodeValue && FILE_LINK_RE.test(node.nodeValue) && !shouldSkipNode(node)) {
      nodes.push(node)
    }
    FILE_LINK_RE.lastIndex = 0
  }

  for (const node of nodes) {
    const text = node.nodeValue ?? ""
    const fragment = document.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null

    FILE_LINK_RE.lastIndex = 0
    while ((match = FILE_LINK_RE.exec(text))) {
      const [full, file] = match
      const start = match.index
      if (start > last) fragment.append(document.createTextNode(text.slice(last, start)))

      const link = document.createElement("a")
      link.href = file
      link.textContent = full
      link.dataset.fileLink = "true"
      fragment.append(link)
      last = start + full.length
    }

    if (last < text.length) fragment.append(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(fragment, node)
  }
}

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
  }

  if (typeof document === "undefined") return Promise.resolve(false)

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "true")
  area.style.position = "fixed"
  area.style.opacity = "0"
  area.style.pointerEvents = "none"
  document.body.appendChild(area)
  area.select()

  let ok = false
  try {
    ok = document.execCommand("copy")
  } finally {
    document.body.removeChild(area)
  }

  return Promise.resolve(ok)
}

function enhanceCodeBlocks(root: HTMLElement) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.parentElement?.dataset.codeBlock === "true") continue

    const wrapper = document.createElement("div")
    wrapper.dataset.codeBlock = "true"
    wrapper.className = "relative mb-4 overflow-hidden rounded-lg border"
    wrapper.style.background = "var(--background-strongest)"
    wrapper.style.borderColor = "var(--border-base)"

    const toolbar = document.createElement("div")
    toolbar.className = "absolute right-2 top-2 z-10"

    const button = document.createElement("button")
    button.type = "button"
    button.dataset.copyCode = "true"
    button.className = "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors"
    button.style.background = "var(--background-base)"
    button.style.borderColor = "var(--border-base)"
    button.style.color = "var(--text-weak)"
    button.title = "Copy code"
    button.setAttribute("aria-label", "Copy code block")
    button.innerHTML = `
      <span data-copy-icon aria-hidden="true" class="inline-flex">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
          <rect x="9" y="9" width="13" height="13" rx="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </span>
      <span data-copy-check aria-hidden="true" class="hidden inline-flex">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
          <path d="M20 6 9 17l-5-5"></path>
        </svg>
      </span>
    `

    toolbar.append(button)

    const body = document.createElement("div")
    body.className = "overflow-x-auto"

    pre.style.margin = "0"
    pre.style.padding = "2.25rem 1rem 1rem"
    pre.style.background = "transparent"
    pre.style.border = "0"

    body.append(pre)
    wrapper.append(toolbar, body)
    pre.parentNode?.replaceChild(wrapper, pre)
  }
}

export function Markdown(props: MarkdownProps) {
  const [root, setRoot] = createSignal<HTMLDivElement | undefined>(undefined)
  const html = createMemo(() => {
    if (!props.content) return ""
    const raw = marked.parse(props.content, { async: false }) as string
    return wrapTables(sanitize(raw))
  })

  createEffect(() => {
    html()
    const el = root()
    if (!el) return
    queueMicrotask(() => {
      if (root() !== el) return
      if (props.copyCodeBlocks) enhanceCodeBlocks(el)
      if (props.onFileClick && props.linkifyFiles) enhanceFileLinks(el, props.onFileClick)
    })
  })

  return (
    <div
      ref={setRoot}
      class={`markdown-content ${props.class || ""}`}
      style={props.style}
      innerHTML={html()}
      onClick={async (e) => {
        const target = e.target instanceof Element ? e.target.closest("button[data-copy-code], a[data-file-link], a[href]") : null
        if (!target) return
        if (target instanceof HTMLButtonElement && target.dataset.copyCode === "true") {
          e.preventDefault()
          e.stopPropagation()
          const block = target.closest("[data-code-block='true']")
          const code = block?.querySelector("pre code")?.textContent ?? block?.querySelector("pre")?.textContent ?? ""
          if (!code) return

          const ok = await copyText(code)
          if (!ok) return

          const icon = target.querySelector("[data-copy-icon]") as HTMLElement | null
          const check = target.querySelector("[data-copy-check]") as HTMLElement | null
          const title = target.title
          const label = target.getAttribute("aria-label")
          icon?.classList.add("hidden")
          check?.classList.remove("hidden")
          target.style.color = "var(--status-success-text)"
          target.title = "Copied!"
          target.setAttribute("aria-label", "Copied code block")
          window.setTimeout(() => {
            if (!target.isConnected) return
            icon?.classList.remove("hidden")
            check?.classList.add("hidden")
            target.style.color = "var(--text-weak)"
            target.title = title
            if (label) target.setAttribute("aria-label", label)
          }, 1500)
          return
        }
        if (!props.onFileClick) return
        const href = target.getAttribute("href") ?? ""
        if (/^(https?:|mailto:|tel:|#)/i.test(href)) return
        e.preventDefault()
        e.stopPropagation()
        props.onFileClick(href)
      }}
    />
  )
}
