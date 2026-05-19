import type { Part } from "../sdk/client"

export interface SystemBlock {
  label: string
  content: string
}

export function parseUserText(parts: Part[]): { text: string; systemBlocks: SystemBlock[] } {
  const initialText = parts
    .filter((p): p is Part & { type: "text" } => p.type === "text" && !p.synthetic)
    .map((p) => p.text)
    .join("")

  const systemBlocks: SystemBlock[] = []

  const step1 = initialText.replace(/<system-reminder>([\s\S]*?)<\/system-reminder>/g, (_, inner) => {
    systemBlocks.push({ label: "system-reminder", content: inner.trim() })
    return ""
  })

  const step2 = step1.replace(/<!-- OMO_INTERNAL_INITIATOR -->/g, (match) => {
    systemBlocks.push({ label: "OMO context", content: match })
    return ""
  })

  const finalText = step2.replace(/<!--[\s\S]*?-->/g, (match) => {
    systemBlocks.push({ label: "injected comment", content: match })
    return ""
  })

  return { text: finalText.trim(), systemBlocks }
}

// Strip injected OpenCode system blocks (e.g. <system-reminder>...</system-reminder>)
// that appear in user message text parts but should not be visible in the chat UI
function stripSystemBlocks(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()
}

export function extractTextContent(parts: Part[]): string {
  return parts
    .filter((p): p is Part & { type: "text" } => p.type === "text" && !p.synthetic)
    .map((p) => stripSystemBlocks(p.text))
    .join("")
}
