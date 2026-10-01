import { createSignal, onCleanup } from "solid-js"

/**
 * Shared scroll-to-bottom + pin/lock helper for chat message lists.
 * Must be called within a component (uses createSignal/onCleanup).
 *
 * - Tracks distance from the bottom via a ResizeObserver on `content`,
 *   measured against `content`'s own bounding rect rather than the scroll
 *   container's raw `scrollHeight` -- a container with an extra trailing
 *   spacer (e.g. for a separate top-alignment scroll effect) would otherwise
 *   always look "not at the bottom" once that spacer exists.
 * - When `pinned()` is true, every observed content resize (i.e. every
 *   streamed chunk) re-snaps to the true bottom, reproducing a continuous
 *   "follow the stream" feel instead of a one-shot scroll. That re-snap is
 *   instant (`behavior: "auto"`), not smooth: a `smooth` scroll animates for
 *   ~300-500ms, and fast streaming re-triggers this before the previous
 *   animation finishes, so the view perpetually chases the target and the
 *   line currently being typed stays just offscreen until streaming pauses.
 *   `scrollToBottom()` (the FAB's one-shot jump) is unaffected and still
 *   animates smoothly, since it only fires once per click.
 */
export function createAutoScroll(options: { bottomThreshold?: number; pinned?: () => boolean } = {}) {
  let scroll: HTMLElement | undefined
  let content: HTMLElement | undefined
  let scrollResizeObserver: ResizeObserver | undefined
  let resizeObserver: ResizeObserver | undefined
  const threshold = options.bottomThreshold ?? 24

  const distanceFromBottom = (el: HTMLElement) => {
    if (!content) return el.scrollHeight - el.clientHeight - el.scrollTop
    return content.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
  }
  const [showFab, setShowFab] = createSignal(false)

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scroll
    if (!el) return
    if (!content) {
      el.scrollTo({ top: el.scrollHeight, behavior })
      return
    }
    const target = el.scrollTop + (content.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom)
    el.scrollTo({ top: target, behavior })
  }

  const update = () => {
    const el = scroll
    if (!el) return
    if (options.pinned?.()) scrollToBottomNow("auto")
    setShowFab(distanceFromBottom(el) > threshold)
  }

  /**
   * One-shot "land at the latest content" used when a chat first opens: jump
   * instantly to the bottom and keep re-snapping for a short settle window
   * while late-measuring content (images, tool output, markdown) grows the
   * list. Bails the moment the user scrolls (wheel/touch on the container).
   */
  const settleToBottom = () => {
    const el = scroll
    if (!el) return
    let aborted = false
    const onUserScroll = () => { aborted = true }
    el.addEventListener("wheel", onUserScroll, { passive: true })
    el.addEventListener("touchmove", onUserScroll, { passive: true })
    let frames = 0
    let onTarget = 0
    const tick = () => {
      if (!scroll) return
      const current = scroll
      if (aborted) {
        current.removeEventListener("wheel", onUserScroll)
        current.removeEventListener("touchmove", onUserScroll)
        return
      }
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight
      if (distance <= 1) {
        onTarget++
      } else {
        onTarget = 0
        scrollToBottomNow("auto")
      }
      frames++
      if (onTarget < 8 && frames < 240) {
        requestAnimationFrame(tick)
        return
      }
      current.removeEventListener("wheel", onUserScroll)
      current.removeEventListener("touchmove", onUserScroll)
    }
    requestAnimationFrame(tick)
  }

  const observe = () => {
    if (!content || typeof ResizeObserver === "undefined") return
    if (resizeObserver) resizeObserver.disconnect()
    resizeObserver = new ResizeObserver(() => update())
    resizeObserver.observe(content)
  }

  const observeScroll = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return
    if (scrollResizeObserver) scrollResizeObserver.disconnect()
    scrollResizeObserver = new ResizeObserver(() => update())
    scrollResizeObserver.observe(el)
  }

  onCleanup(() => {
    if (scrollResizeObserver) scrollResizeObserver.disconnect()
    if (resizeObserver) resizeObserver.disconnect()
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      scroll = el
      if (!el) return
      observeScroll(el)
      update()
    },
    contentRef: (el: HTMLElement | undefined) => {
      content = el
      if (!el) return
      observe()
      update()
    },
    handleScroll: update,
    scrollToBottom: () => scrollToBottomNow("smooth"),
    settleToBottom,
    showScrollToBottom: () => showFab(),
  }
}
