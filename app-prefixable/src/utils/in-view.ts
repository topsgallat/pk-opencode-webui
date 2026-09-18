import { createSignal, onCleanup, type Accessor } from "solid-js"

// Sticky in-view detection: flips to true the first time the ref'd element
// enters the viewport (optionally pre-triggered by rootMargin) and stays true.
// Used to defer expensive rendering (e.g. syntax highlighting) until content
// is actually about to be seen. Falls back to always-visible when
// IntersectionObserver is unavailable.
export function useInView(options?: { rootMargin?: string }): { ref: (el: Element) => void; inView: Accessor<boolean> } {
  const [inView, setInView] = createSignal(false)
  let observer: IntersectionObserver | undefined

  const ref = (el: Element) => {
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) setInView(true)
        },
        { rootMargin: options?.rootMargin ?? "200px 0px" },
      )
    }
    observer.observe(el)
  }

  onCleanup(() => observer?.disconnect())
  return { ref, inView }
}
