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
}

const FILE_LINK_RE = /(?<![\w./-])((?:\.\.?\/|\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:md|markdown|html|htm|tsx|ts|jsx|js|json|ya?ml|txt|py|go|rs|sh|bash|c|cc|cpp|h|hpp|toml|xml|css))(?![\w./-])/g

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
    if (!el || !props.onFileClick || !props.linkifyFiles) return
    queueMicrotask(() => {
      if (root() === el) enhanceFileLinks(el, props.onFileClick!)
    })
  })

  return (
    <div
      ref={setRoot}
      class={`markdown-content ${props.class || ""}`}
      style={props.style}
      innerHTML={html()}
      onClick={(e) => {
        const target = e.target instanceof Element ? e.target.closest("a[data-file-link], a[href]") : null
        if (!target || !props.onFileClick) return
        const href = target.getAttribute("href") ?? ""
        if (/^(https?:|mailto:|tel:|#)/i.test(href)) return
        e.preventDefault()
        e.stopPropagation()
        props.onFileClick(href)
      }}
    />
  )
}
