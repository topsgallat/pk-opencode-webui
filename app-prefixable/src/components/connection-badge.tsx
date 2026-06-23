import { createEffect, createSignal, onCleanup } from "solid-js"
import { checkOpencodeHealth } from "../utils/extended-api"

const HEALTH_CHECK_INTERVAL_MS = 15_000

type ServerHealthState = "checking" | "online" | "offline"

interface ServerHealthBadgeProps {
  serverUrl: string
  targetUrl?: string
}

export function ServerHealthBadge(props: ServerHealthBadgeProps) {
  const [health, setHealth] = createSignal<ServerHealthState>("checking")

  createEffect(() => {
    const serverUrl = props.serverUrl
    const targetUrl = props.targetUrl
    let timeout: number | undefined
    let active = true

    const check = async () => {
      const result = await checkOpencodeHealth(serverUrl, targetUrl)
      if (!active) return
      setHealth(result.ok && result.healthy !== false ? "online" : "offline")
      timeout = window.setTimeout(check, HEALTH_CHECK_INTERVAL_MS)
    }

    setHealth("checking")
    void check()

    onCleanup(() => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    })
  })

  return (
    <span
      class="inline-block h-2 w-2 rounded-full"
      style={{
        background: health() === "checking"
          ? "var(--text-weak)"
          : health() === "online"
            ? "var(--icon-success-base)"
            : "var(--icon-critical-base)",
        opacity: health() === "checking" ? 0.7 : 1,
      }}
      title={health() === "checking"
        ? "Checking backend status"
        : health() === "online"
          ? "Backend server is online"
          : "Backend server is offline"}
      role="status"
    />
  )
}
