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
 *   "follow the stream" feel instead of a one-shot scroll.
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

  const scrollToBottomNow = () => {
    const el = scroll
    if (!el) return
    if (!content) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      return
    }
    const target = el.scrollTop + (content.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom)
    el.scrollTo({ top: target, behavior: "smooth" })
  }

  const update = () => {
    const el = scroll
    if (!el) return
    if (options.pinned?.()) scrollToBottomNow()
    setShowFab(distanceFromBottom(el) > threshold)
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
    scrollToBottom: scrollToBottomNow,
    showScrollToBottom: () => showFab(),
  }
}
