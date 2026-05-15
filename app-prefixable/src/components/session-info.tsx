import { createMemo, createSignal, createEffect, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useSync } from "../context/sync"
import { useProviders } from "../context/providers"
import { getCopilotMultiplier } from "../utils/path"
import { isAnthropicProviderID } from "../../../shared/anthropic-models"
import { getContextTokens } from "../utils/tokens"
import { CornerDownLeft, Square, Zap } from "lucide-solid"
import { ConnectionBadge } from "./connection-badge"

type TokenPricing = {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  context_over_200k?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

function estimateTokenCost(tokens: {
  contextTokens: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
}, pricing?: TokenPricing): number | null {
  if (!pricing) return null
  const tier = tokens.contextTokens > 200_000 && pricing.context_over_200k ? pricing.context_over_200k : pricing
  const cacheReadRate = tier.cache_read ?? tier.input
  const cacheWriteRate = tier.cache_write ?? tier.input
  return (
    tokens.input * tier.input +
    tokens.cacheRead * cacheReadRate +
    tokens.cacheWrite * cacheWriteRate +
    (tokens.output + tokens.reasoning) * tier.output
  ) / 1_000_000
}

function estimateAssistantMessageCost(info: {
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  modelID?: string
  providerID?: string
}, provider: { models: Record<string, { cost?: TokenPricing }> } | undefined): number | null {
  const model = provider?.models[info.modelID ?? ""]
  if (!model?.cost) return null
  return estimateTokenCost({
    contextTokens: getContextTokens(info.tokens),
    input: info.tokens?.input || 0,
    cacheRead: info.tokens?.cache?.read || 0,
    cacheWrite: info.tokens?.cache?.write || 0,
    output: info.tokens?.output || 0,
    reasoning: info.tokens?.reasoning || 0,
  }, model.cost)
}

interface SessionInfoProps {
  input: () => string
  loading: () => boolean
  processing: () => boolean
  queueCount?: () => number
  pausedReason?: () => "paused_question" | "paused_permission" | null
  onAbort: () => void
  onAgentClick: () => void
  onModelClick: () => void
  selectedAgent?: () => string | null
  selectedModel?: () => { providerID: string; modelID: string } | null
  hasAttachments?: () => boolean
}

export function SessionInfo(props: SessionInfoProps) {
  const params = useParams<{ dir: string; id?: string }>()
  const sync = useSync()
  const providers = useProviders()
  const selectedAgent = () => props.selectedAgent?.() ?? providers.selectedAgent
  const selectedModel = () => props.selectedModel?.() ?? providers.selectedModel

  // Sync session data when session ID changes
  createEffect(() => {
    const id = params.id
    if (id) {
      sync.session.sync(id)
    }
  })

  // Get messages from sync context - reactive, no polling needed
  const messages = createMemo(() => {
    const id = params.id
    if (!id) return []
    return sync.messages(id)
  })

  // Calculate token usage from last assistant message and cumulative cost
  const stats = createMemo(() => {
    const msgs = messages()
    if (!msgs.length) return null

    // Calculate cumulative cost across all assistant messages
    let totalCost = 0
    for (const msg of msgs) {
      if (msg.info?.role === "assistant") {
        const info = msg.info as {
          cost?: number
          tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
          modelID?: string
          providerID?: string
        }
        const cost = info.cost || 0
        if (cost > 0) {
          totalCost += cost
          continue
        }
        const provider = providers.providers.find((p: { id: string }) => p.id === info.providerID)
        const estimate = estimateAssistantMessageCost(info, provider)
        if (estimate !== null) totalCost += estimate
      }
    }

    // Type for assistant message info
    type AssistantInfo = {
      tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
      modelID?: string
      providerID?: string
    }

    // Find last assistant message with context tokens (current context state)
    // Context tokens represent context usage - how much of the window is filled
    let lastAssistant: {
      contextTokens: number
      modelID?: string
      providerID?: string
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
    } | null = null
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.info?.role !== "assistant") continue
      const info = msg.info as AssistantInfo
      const contextTokens = getContextTokens(info.tokens)
      if (contextTokens > 0) {
        lastAssistant = {
          contextTokens,
          modelID: info.modelID,
          providerID: info.providerID,
          input: info.tokens?.input || 0,
          output: info.tokens?.output || 0,
          reasoning: info.tokens?.reasoning || 0,
          cacheRead: info.tokens?.cache?.read || 0,
          cacheWrite: info.tokens?.cache?.write || 0,
        }
        break
      }
    }

    if (!lastAssistant) return null

    // Get model context limit for usage percentage (use lastAssistant's model, not selectedModel)
    const provider = providers.providers.find((p: { id: string }) => p.id === lastAssistant!.providerID)
    if (!provider && providers.providers.length > 0 && import.meta.env.DEV) {
      console.warn("[session-info] provider not found:", lastAssistant!.providerID,
        "available:", providers.providers.map(p => p.id))
    }
    const model = provider?.models[lastAssistant.modelID ?? ""]
    if (provider && !model && import.meta.env.DEV) {
      console.warn("[session-info] model not found:", lastAssistant.modelID,
        "available:", Object.keys(provider.models))
    }
    const limit = model?.limit?.context ?? 0
    const usage = limit && Number.isFinite(limit) && limit > 0
      ? Math.min(100, Math.max(0, Math.round((lastAssistant.contextTokens / limit) * 100)))
      : null
    const estimatedCost = estimateTokenCost(lastAssistant, model?.cost)

    return {
      tokens: lastAssistant.contextTokens.toLocaleString(),
      usage,
      cost: usd.format(totalCost),
      // Breakdown fields for the popover
      contextTokens: lastAssistant.contextTokens,
      contextLimit: limit,
      input: lastAssistant.input,
      cacheRead: lastAssistant.cacheRead,
      cacheWrite: lastAssistant.cacheWrite,
      cacheTotal: lastAssistant.cacheRead + lastAssistant.cacheWrite,
      output: lastAssistant.output,
      reasoning: lastAssistant.reasoning,
      estimatedCost,
      totalCost,
    }
  })

  // Resolve friendly model name from providers
  const modelLabel = createMemo(() => {
    const selected = selectedModel()
    if (!selected) return null
    const provider = providers.providers.find((p: { id: string }) => p.id === selected.providerID)
    const model = provider?.models[selected.modelID]
    return model?.name || selected.modelID
  })

  const modelBadge = createMemo(() => {
    const selected = selectedModel()
    if (!selected) return null
    const provider = providers.providers.find((p: { id: string }) => p.id === selected.providerID)
    const model = provider?.models[selected.modelID]
    if (!model) return null
    const fmt = (n: number) => Number(n.toFixed(2)).toString()
    const multiplier = getCopilotMultiplier(provider?.id || "", model.id, model.name) ?? model.copilotMultiplier
    if (multiplier !== undefined) {
      return (
        <span
          class="text-[10px] px-1 py-0.5 rounded shrink-0 leading-none"
          style={{ color: "var(--text-weak)", background: "var(--surface-inset)" }}
        >
          x{fmt(multiplier)}
        </span>
      )
    }
    const cost = model.cost
    const isOpenAI = provider?.id === "openai" || provider?.id?.startsWith("openai:")
    const isAnthropic = provider?.id ? isAnthropicProviderID(provider.id) : false
    if (!cost) {
      return (isOpenAI || isAnthropic) ? (
        <span
          class="text-[10px] px-1 py-0.5 rounded shrink-0 leading-none"
          style={{ color: "var(--text-weak)", background: "var(--surface-inset)" }}
        >
          n/a
        </span>
      ) : null
    }
    if ((isOpenAI || isAnthropic) && cost.input === 0 && cost.output === 0) {
      return (
        <span
          class="text-[10px] px-1 py-0.5 rounded shrink-0 leading-none"
          style={{ color: "var(--text-weak)", background: "var(--surface-inset)" }}
        >
          n/a
        </span>
      )
    }
    return (
      <span
        class="text-[10px] px-1 py-0.5 rounded shrink-0 leading-none"
        style={{ color: "var(--text-weak)", background: "var(--surface-inset)" }}
      >
        ${fmt(cost.input)}/${fmt(cost.output)}/M
      </span>
    )
  })

  // Token popover state — reset when session changes
  const [showTokenPopover, setShowTokenPopover] = createSignal(false)
  createEffect(() => {
    params.id // track session ID
    setShowTokenPopover(false)
  })
  const [popoverPos, setPopoverPos] = createSignal({ top: 0, left: 0 })
  let triggerRef: HTMLButtonElement | undefined
  let popoverRef: HTMLDivElement | undefined

  // Dismiss token popover on click outside or Escape
  createEffect(() => {
    if (!showTokenPopover()) return

    function handleClick(e: MouseEvent) {
      if (popoverRef && !popoverRef.contains(e.target as Node) &&
        triggerRef && !triggerRef.contains(e.target as Node)) {
        setShowTokenPopover(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setShowTokenPopover(false)
      }
    }

    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    })
  })

  function togglePopover() {
    if (showTokenPopover()) {
      setShowTokenPopover(false)
      return
    }
    if (triggerRef) {
      const rect = triggerRef.getBoundingClientRect()
      const POPOVER_WIDTH = 256
      const maxLeft = window.innerWidth - POPOVER_WIDTH - 16
      setPopoverPos({ top: rect.top - 8, left: Math.max(0, Math.min(rect.left, maxLeft)) })
    }
    setShowTokenPopover(true)
  }

  const dirSlug = createMemo(() => params.dir)

  const fmt = (n: number) => n.toLocaleString()
  const composerReady = createMemo(() => !!(props.input().trim() || props.hasAttachments?.()))
  const queueCount = createMemo(() => props.queueCount?.() ?? 0)
  const pausedLabel = createMemo(() => {
    const reason = props.pausedReason?.()
    if (reason === "paused_question") return "Paused: question"
    if (reason === "paused_permission") return "Paused: permission"
    return null
  })

  return (
    <div class="flex flex-wrap items-center px-2 sm:px-4 py-1.5 text-xs gap-y-2" style={{ color: "var(--text-weak)" }}>
      {/* Left group - info text, wraps on mobile */}
      <div class="flex flex-1 flex-wrap items-center gap-3 min-w-0 [&_button:focus-visible]:outline-offset-[-2px] [&_a:focus-visible]:outline-offset-[-2px] pr-2">
        {/* Agent */}
        <Show when={selectedAgent()}>
          <button
            type="button"
            class="flex items-center gap-1 shrink-0 hover:opacity-80 cursor-pointer"
            onClick={() => props.onAgentClick()}
          >
            <span class="opacity-60">Agent:</span>
            <span class="capitalize" style={{ color: "var(--text-base)" }}>
              {selectedAgent()}
            </span>
          </button>
        </Show>

        {/* Model */}
        <Show when={selectedModel()}>
          <button
            type="button"
            class="flex items-center gap-1 min-w-0 hover:opacity-80 cursor-pointer"
            onClick={() => props.onModelClick()}
          >
            <span class="opacity-60 shrink-0">Model:</span>
            <span class="truncate" style={{ color: "var(--text-base)" }}>{modelLabel()}</span>
            {modelBadge()}
          </button>
        </Show>

        {/* No provider warning */}
        <Show when={!selectedModel() && providers.connected.length === 0}>
          <a href={`/${dirSlug()}/settings`} style={{ color: "var(--text-interactive-base)" }} class="hover:underline">
            Connect a provider to start
          </a>
        </Show>

        <Show when={!selectedModel() && providers.connected.length > 0}>
          <span style={{ color: "var(--status-warning-text)" }}>No model selected</span>
        </Show>

        <Show when={queueCount() > 0}>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              background: "var(--surface-inset)",
              color: "var(--text-weak)",
              border: "1px solid var(--border-base)",
            }}
          >
            Queue {queueCount()}
          </span>
        </Show>

        <Show when={pausedLabel()}>
          {(label) => (
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--status-warning-dim)",
                color: "var(--status-warning-text)",
                border: "1px solid var(--status-warning-border)",
              }}
            >
              {label()}
            </span>
          )}
        </Show>
      </div>

      {/* Right group - action controls, always visible */}
      <div class="ml-3 flex items-center shrink-0 gap-2">
        <Show when={stats()}>
          {(s) => (
            <div class="relative">
              <button
                ref={triggerRef}
                type="button"
                class="flex items-center gap-2 rounded-lg px-2 py-1 transition-opacity hover:opacity-80"
                style={{
                  background: "var(--surface-inset)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                }}
                onClick={togglePopover}
                aria-haspopup="true"
                aria-expanded={showTokenPopover()}
                title="View token breakdown"
                aria-label="View token breakdown"
              >
                <Zap class="w-3 h-3" />
                <span class="flex items-center gap-1 shrink-0 text-[10px] font-medium uppercase tracking-wide">
                  <span>{s().tokens}</span>
                  <span class="opacity-60 normal-case tracking-normal">tokens</span>
                </span>
                <Show when={s().usage !== null}>
                  <span
                    class="px-1 py-0.5 rounded text-[10px] font-medium"
                    style={{
                      background: s().usage! > 80 ? "var(--surface-critical-subtle)" : "var(--surface-inset)",
                      color: s().usage! > 80 ? "var(--text-critical-base)" : "var(--text-weak)",
                    }}
                  >
                    {s().usage}%
                  </span>
                </Show>
                <span class="flex items-center gap-1 shrink-0 text-[10px]">
                  <span class="opacity-60">Cost</span>
                  <span style={{ color: "var(--text-base)" }}>{s().cost}</span>
                </span>
                <ConnectionBadge />
              </button>

              {/* Token breakdown popover - portalled to escape overflow-hidden */}
              <Show when={showTokenPopover()}>
                <Portal>
                  <div
                    ref={popoverRef}
                    class="w-64 rounded-lg shadow-lg text-xs"
                    style={{
                      position: "fixed",
                      top: `${popoverPos().top}px`,
                      left: `${popoverPos().left}px`,
                      transform: "translateY(-100%)",
                      "z-index": "9999",
                      background: "var(--background-base)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    <div
                      class="px-3 py-2 font-medium"
                      style={{
                        color: "var(--text-strong)",
                        "border-bottom": "1px solid var(--border-base)",
                        background: "var(--surface-inset)",
                        "border-radius": "0.5rem 0.5rem 0 0",
                      }}
                    >
                      Token Breakdown
                    </div>
                    <div class="px-3 py-2 space-y-1.5 font-mono" style={{ color: "var(--text-base)" }}>
                      <div class="flex justify-between">
                        <span>Context:</span>
                        <span>
                          {fmt(s().contextTokens)}
                          <Show when={s().contextLimit > 0}>
                            <span class="opacity-60"> / {fmt(s().contextLimit)}</span>
                          </Show>
                          <Show when={s().usage !== null}>
                            <span class="opacity-60"> ({s().usage}%)</span>
                          </Show>
                        </span>
                      </div>

                      <div class="flex justify-between pl-3" style={{ color: "var(--text-weak)" }}>
                        <span>Input:</span>
                        <span>{fmt(s().input)}</span>
                      </div>

                      <div class="flex justify-between pl-3" style={{ color: "var(--text-weak)" }}>
                        <span>Cache:</span>
                        <span>{fmt(s().cacheTotal)}</span>
                      </div>
                      <Show when={s().cacheRead > 0 || s().cacheWrite > 0}>
                        <div class="flex justify-between pl-6" style={{ color: "var(--text-weak)", opacity: 0.8 }}>
                          <span>read / write:</span>
                          <span>{fmt(s().cacheRead)} / {fmt(s().cacheWrite)}</span>
                        </div>
                      </Show>

                      <div class="flex justify-between">
                        <span>Output:</span>
                        <span>{fmt(s().output)}</span>
                      </div>

                      <Show when={s().reasoning > 0}>
                        <div class="flex justify-between">
                          <span>Reasoning:</span>
                          <span>{fmt(s().reasoning)}</span>
                        </div>
                      </Show>

                      <Show when={s().estimatedCost !== null}>
                        <div class="flex justify-between pt-1.5 mt-1" style={{ "border-top": "1px solid var(--border-base)" }}>
                          <span>Estimate:</span>
                          <span>{usd.format(s().estimatedCost || 0)}</span>
                        </div>
                      </Show>

                      <div
                        class="flex justify-between pt-1.5 mt-1"
                        style={{ "border-top": "1px solid var(--border-base)" }}
                      >
                        <span>Cost:</span>
                        <span>{s().cost} <span class="opacity-60" style={{ "font-family": "inherit" }}>(session)</span></span>
                      </div>
                    </div>
                  </div>
                </Portal>
              </Show>
            </div>
          )}
        </Show>

        <Show when={composerReady() && !props.loading() && !props.processing()}>
          <button
            type="submit"
            class="flex items-center gap-1 opacity-80 cursor-pointer transition-opacity hover:opacity-100 p-1.5 rounded-lg"
             style={{
               background: "var(--interactive-base)",
               color: "var(--text-on-interactive)"
             }}
            title="Click or press Enter to send"
            aria-label="Send message"
          >
            <div class="hidden sm:inline-block font-mono text-[10px] px-1 py-0.5 opacity-80 uppercase tracking-widest bg-black/20 rounded">
              SEND
            </div>
            <CornerDownLeft class="w-4 h-4" />
          </button>
        </Show>

        <Show when={composerReady() && !props.loading() && props.processing()}>
          <button
            type="submit"
            class="flex items-center gap-1.5 px-2 py-1 rounded transition-colors"
            style={{
              color: "var(--text-strong)",
              border: "1px solid var(--border-base)",
              background: "var(--surface-inset)",
            }}
            title="Add this prompt to the queue"
            aria-label="Add prompt to queue"
          >
            <CornerDownLeft class="w-3.5 h-3.5" />
            <span>Add to queue</span>
          </button>
        </Show>

        <Show when={props.processing()}>
          <button
            type="button"
            onClick={props.onAbort}
            class="flex items-center gap-1.5 px-2 py-1 rounded transition-colors"
            style={{
              color: "var(--text-critical-base)",
              border: "1px solid var(--border-critical-base)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-critical-subtle)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Stop generation (Esc Esc)"
          >
            <Square class="w-3 h-3" />
            <span>Stop</span>
          </button>
        </Show>
      </div>
    </div>
  )
}
