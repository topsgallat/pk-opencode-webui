import { createMemo, createEffect, createResource, createSignal, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useBasePath } from "../context/base-path"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useProviders } from "../context/providers"
import { getCopilotMultiplier } from "../utils/path"
import { shouldLoadQuotaOnOpen } from "../utils/quota-refresh"
import { isAnthropicProviderID } from "../../../shared/anthropic-models"
import { getContextTokens } from "../utils/tokens"
import { getQuota } from "../utils/extended-api"
import { CornerDownLeft, Square, Zap } from "lucide-solid"
import { ConnectionBadge } from "./connection-badge"
import { findQuotaProviderBySelectedModel } from "./session-info-helpers"

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
  queueActive?: () => boolean
  queueCount?: () => number
  pausedReason?: () => "paused_question" | "paused_permission" | null
  onAbort: () => void
  onAction: () => void
  onAgentClick: () => void
  onModelClick: () => void
  onVariantClick?: () => void
  selectedAgent?: () => string | null
  selectedModel?: () => { providerID: string; modelID: string } | null
  selectedVariant?: () => string | null
  hasAttachments?: () => boolean
}

export function SessionInfo(props: SessionInfoProps) {
  const params = useParams<{ dir: string; id?: string }>()
  const { serverUrl } = useBasePath()
  const { targetUrl } = useSDK()
  const sync = useSync()
  const providers = useProviders()
  const selectedAgent = () => props.selectedAgent?.() ?? providers.selectedAgent
  const selectedModel = () => props.selectedModel?.() ?? providers.selectedModel
  const [quotaRequested, setQuotaRequested] = createSignal(false)
  const [quotaTick, setQuotaTick] = createSignal(0)

  const [quota] = createResource(
    () => quotaRequested() ? ({ serverUrl, targetUrl, tick: quotaTick() }) : null,
    async ({ serverUrl, targetUrl }) => await getQuota(serverUrl, { refresh: true, targetUrl }),
  )

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
    const provider = providers.rawProviders.find((p: { id: string }) => p.id === lastAssistant!.providerID)
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
    const provider = providers.rawProviders.find((p: { id: string }) => p.id === selected.providerID)
    const model = provider?.models[selected.modelID]
    return model?.name || selected.modelID
  })

  const variantLabel = createMemo(() => {
    const selected = selectedModel()
    if (!selected) return null
    const provider = providers.rawProviders.find((p: { id: string }) => p.id === selected.providerID)
    const model = provider?.models[selected.modelID]
    const variants = Object.entries(model?.variants ?? {}).filter(([, config]) => !config.disabled)
    if (variants.length === 0) return null
    return props.selectedVariant?.() ?? "default"
  })

  const quotaProvider = createMemo(() => {
    const data = quota()
    if (!data) return null

    const selected = selectedModel()
    return findQuotaProviderBySelectedModel(data.providers, selected?.providerID)
  })

  const quotaStatus = (status?: string) => {
    switch (status) {
      case "ok":
        return {
          label: "Available",
          background: "var(--surface-inset)",
          color: "var(--icon-success-base)",
          border: "1px solid var(--border-base)",
        }
      case "unavailable":
        return {
          label: "Unavailable",
          background: "var(--status-warning-dim)",
          color: "var(--status-warning-text)",
          border: "1px solid var(--status-warning-border)",
        }
      default:
        return {
          label: "Error",
          background: "var(--surface-critical-subtle)",
          color: "var(--text-critical-base)",
          border: "1px solid var(--border-critical-base)",
        }
    }
  }

  const quotaPercent = (entry: { used?: number; total?: number; percentUsed?: number; unlimited?: boolean }) => {
    if (entry.unlimited) return null
    if (entry.percentUsed !== undefined) return Math.max(0, Math.min(100, entry.percentUsed))
    if (entry.used !== undefined && entry.total !== undefined && entry.total > 0) {
      return Math.max(0, Math.min(100, (entry.used / entry.total) * 100))
    }
    return null
  }

  const quotaBarColor = (percent: number | null) => {
    if (percent === null) return "var(--text-weak)"
    if (percent >= 90) return "var(--text-critical-base)"
    if (percent >= 75) return "var(--status-warning-text)"
    return "var(--icon-success-base)"
  }

  const quotaResetLabel = (entry: { resetTimeIso?: string }) => {
    if (!entry.resetTimeIso) return null

    const date = new Date(entry.resetTimeIso)
    const diffMs = date.getTime() - Date.now()

    if (diffMs <= 0) return "Resets now"

    const totalMinutes = Math.floor(diffMs / (1000 * 60))
    const weeks = Math.floor(totalMinutes / (60 * 24 * 7))
    const days = Math.floor((totalMinutes % (60 * 24 * 7)) / (60 * 24))
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
    const minutes = totalMinutes % 60

    const parts = [
      weeks > 0 ? `${weeks}w` : "",
      days > 0 ? `${days}d` : "",
      hours > 0 ? `${hours}h` : "",
      minutes > 0 ? `${minutes}m` : "",
    ].filter(Boolean)

    return `Resets in ${parts.join(" ") || "0m"}`
  }

  const modelBadge = createMemo(() => {
    const selected = selectedModel()
    if (!selected) return null
    const provider = providers.rawProviders.find((p: { id: string }) => p.id === selected.providerID)
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

  const [showTokenPopover, setShowTokenPopover] = createSignal(false)
  const [popoverPos, setPopoverPos] = createSignal({ top: 0, left: 0 })
  let triggerRef: HTMLButtonElement | undefined
  let popoverRef: HTMLDivElement | undefined

  createEffect(() => {
    params.id
    setShowTokenPopover(false)
  })

  createEffect(() => {
    if (!showTokenPopover()) return

    function handleClick(e: MouseEvent) {
      if (popoverRef && !popoverRef.contains(e.target as Node) && triggerRef && !triggerRef.contains(e.target as Node)) {
        setShowTokenPopover(false)
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      setShowTokenPopover(false)
    }

    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    })
  })

  function toggleTokenPopover() {
    if (showTokenPopover()) {
      setShowTokenPopover(false)
      return
    }

    const shouldLoad = shouldLoadQuotaOnOpen({
      requested: quotaRequested(),
      loading: quota.loading,
      quota: quota(),
      hasError: Boolean(quota.error),
    })

    if (!quotaRequested()) {
      setQuotaRequested(true)
    } else if (shouldLoad) {
      setQuotaTick((value) => value + 1)
    }

    if (triggerRef) {
      const rect = triggerRef.getBoundingClientRect()
      const width = 288
      const maxLeft = window.innerWidth - width - 16
      setPopoverPos({ top: rect.top - 8, left: Math.max(0, Math.min(rect.left, maxLeft)) })
    }

    setShowTokenPopover(true)
  }

  const dirSlug = createMemo(() => params.dir)

  const fmt = (n: number) => n.toLocaleString()
  const composerReady = createMemo(() => !!(props.input().trim() || props.hasAttachments?.()))
  const queueCount = createMemo(() => props.queueCount?.() ?? 0)
  const actionMode = createMemo(() => {
    if (composerReady() && props.queueActive?.()) return "queue"
    if (props.processing()) return "stop"
    if (composerReady()) return "send"
    return null
  })
  const pausedLabel = createMemo(() => {
    const reason = props.pausedReason?.()
    if (reason === "paused_question") return "Paused: question"
    if (reason === "paused_permission") return "Paused: permission"
    return null
  })

  return (
    <div class="relative flex items-center gap-2 px-2 py-1.5 text-xs sm:gap-3 sm:px-4" style={{ color: "var(--text-weak)" }}>
      <div class="flex min-w-0 flex-1 flex-col gap-1 [&_button:focus-visible]:outline-offset-[-2px] [&_a:focus-visible]:outline-offset-[-2px] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
        <Show when={selectedAgent()}>
          <button
            type="button"
            class="flex items-center gap-1 shrink-0 hover:opacity-80 cursor-pointer"
            onClick={() => props.onAgentClick()}
          >
            <span class="opacity-60">Agent:</span>
            <span class="capitalize" style={{ color: "var(--text-base)" }}>{selectedAgent()}</span>
          </button>
        </Show>

        <div class="flex min-w-0 flex-wrap items-center gap-2">
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

          <Show when={variantLabel()}>
            <button
              type="button"
              class="flex items-center gap-1 min-w-0 hover:opacity-80 cursor-pointer"
              onClick={() => props.onVariantClick?.()}
            >
              <span class="opacity-60 shrink-0">Variant:</span>
              <span class="truncate" style={{ color: "var(--text-base)" }}>{variantLabel()}</span>
            </button>
          </Show>
        </div>

        <Show when={stats()}>
          {(s) => (
            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <div class="relative">
                <button
                  ref={triggerRef}
                  type="button"
                  class="flex items-center gap-2 transition-opacity hover:opacity-80"
                  style={{ color: "var(--text-base)" }}
                  onClick={toggleTokenPopover}
                  aria-haspopup="true"
                  aria-expanded={showTokenPopover()}
                  title="Show token breakdown"
                  aria-label="Show token breakdown"
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
                </button>

                <Show when={showTokenPopover()}>
                  <Portal>
                    <div
                      ref={popoverRef}
                      class="w-72 rounded-lg shadow-lg text-xs"
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

                        <div class="flex justify-between">
                          <span>Cost:</span>
                          <span>{s().cost} <span class="opacity-60" style={{ "font-family": "inherit" }}>(session)</span></span>
                        </div>

                        <Show when={quota.loading}>
                          <div class="pt-1.5 mt-1 text-[11px]" style={{ "border-top": "1px solid var(--border-base)", color: "var(--text-weak)" }}>
                            Loading quota...
                          </div>
                        </Show>

                        <Show when={quota.error && !quota.loading}>
                          <div class="pt-1.5 mt-1 text-[11px]" style={{ "border-top": "1px solid var(--border-base)", color: "var(--text-critical-base)" }}>
                            Quota unavailable
                          </div>
                        </Show>

                        <Show when={quota() && !quota.loading && !quota.error}>
                          <div class="pt-1.5 mt-1 space-y-2" style={{ "border-top": "1px solid var(--border-base)" }}>
                            <div class="flex items-center justify-between gap-2 font-sans">
                              <span class="font-medium" style={{ color: "var(--text-strong)" }}>Quota</span>
                              <span class="text-[10px]" style={{ color: "var(--text-weak)" }}>
                                {quota()!.summary.availableProviders.length} available / {quota()!.summary.unavailableProviders.length} unavailable
                              </span>
                            </div>

                            <Show when={quotaProvider()} fallback={
                              <div class="text-[11px] font-sans" style={{ color: "var(--text-weak)" }}>
                                No quota provider matched this composer.
                              </div>
                            }>
                              <div
                                class="rounded-md px-2.5 py-2 space-y-2 font-sans"
                                style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)" }}
                              >
                                <div class="flex items-center justify-between gap-2">
                                  <span class="min-w-0 truncate font-medium" style={{ color: "var(--text-strong)" }}>
                                    {quotaProvider()!.name}
                                  </span>
                                  <span
                                    class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                                    style={{
                                      background: quotaStatus(quotaProvider()!.status).background,
                                      color: quotaStatus(quotaProvider()!.status).color,
                                      border: quotaStatus(quotaProvider()!.status).border,
                                    }}
                                  >
                                    {quotaStatus(quotaProvider()!.status).label}
                                  </span>
                                </div>

                                <Show when={quotaProvider()!.warning}>
                                  {(message) => (
                                    <div class="text-[10px] leading-snug" style={{ color: "var(--status-warning-text)" }}>
                                      {message()}
                                    </div>
                                  )}
                                </Show>

                                <Show when={quotaProvider()!.entries.length > 0} fallback={
                                  <div class="text-[11px]" style={{ color: "var(--text-weak)" }}>
                                    No quota limits reported.
                                  </div>
                                }>
                                  <div class="space-y-1.5">
                                    <For each={quotaProvider()!.entries.slice(0, 3)}>
                                      {(entry) => {
                                        const percent = quotaPercent(entry)
                                        return (
                                          <div class="space-y-1">
                                            <div class="flex items-center justify-between gap-2 text-[11px]">
                                              <span class="min-w-0 truncate" style={{ color: "var(--text-base)" }}>
                                                {entry.label}
                                              </span>
                                              <span class="shrink-0" style={{ color: "var(--text-weak)" }}>
                                                {entry.unlimited ? "Unlimited" : entry.used !== undefined && entry.total !== undefined
                                                  ? `${entry.used.toLocaleString()} / ${entry.total.toLocaleString()}`
                                                  : entry.percentUsed !== undefined
                                                    ? `${Math.round(entry.percentUsed)}% used`
                                                    : entry.remaining !== undefined
                                                      ? `${entry.remaining.toLocaleString()} remaining`
                                                      : "-"}
                                              </span>
                                            </div>
                                            <Show when={quotaResetLabel(entry)}>
                                              {(label) => (
                                                <div class="text-[10px]" style={{ color: "var(--text-weak)" }}>
                                                  {label()}
                                                </div>
                                              )}
                                            </Show>
                                            <Show when={percent !== null}>
                                              <div class="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--background-base)" }}>
                                                <div
                                                  class="h-full rounded-full transition-all duration-300"
                                                  style={{ width: `${percent}%`, background: quotaBarColor(percent) }}
                                                />
                                              </div>
                                            </Show>
                                          </div>
                                        )
                                      }}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </Portal>
                </Show>
              </div>

              <span class="flex items-center gap-1 shrink-0 text-[10px]">
                <span class="opacity-60">Cost</span>
                <span style={{ color: "var(--text-base)" }}>{s().cost}</span>
              </span>

              <ConnectionBadge />
            </div>
          )}
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

      <Show when={!props.loading()}>
        <Show when={actionMode()}>
          <div class="flex h-full items-center justify-end">
            <button
              type="button"
              class="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-[11px] font-medium transition-opacity hover:opacity-100 touch-manipulation"
              style={actionMode() === "stop"
                ? {
                  background: "var(--status-danger-dim)",
                  color: "var(--status-danger-text)",
                  border: "1px solid var(--status-danger-border)",
                }
                : {
                  background: "var(--interactive-base)",
                  color: "var(--text-on-interactive)",
                }}
              title={actionMode() === "queue" ? "Add to queue" : actionMode() === "stop" ? "Stop generation (Esc Esc)" : "Click or press Enter to send"}
              aria-label={actionMode() === "queue" ? "Add to queue" : actionMode() === "stop" ? "Stop generation" : "Send message"}
              onClick={() => (actionMode() === "stop" ? props.onAbort() : props.onAction())}
            >
              <div class="uppercase tracking-wide">
                {actionMode() === "queue" ? "ADD TO QUEUE" : actionMode() === "stop" ? "STOP" : "SEND"}
              </div>
              <Show when={actionMode() === "stop"} fallback={<CornerDownLeft class="w-4 h-4" />}>
                <Square class="w-4 h-4" />
              </Show>
            </button>
          </div>
        </Show>
      </Show>
    </div>
  )
}
