import { createMemo } from "solid-js"
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
}

export function Markdown(props: MarkdownProps) {
  const html = createMemo(() => {
    if (!props.content) return ""
    const raw = marked.parse(props.content, { async: false }) as string
    return wrapTables(sanitize(raw))
  })

  return <div class={`markdown-content ${props.class || ""}`} style={props.style} innerHTML={html()} />
}
