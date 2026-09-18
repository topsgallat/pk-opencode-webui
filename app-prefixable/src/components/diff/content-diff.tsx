import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useHighlightedLines, type HighlightedLines } from "./highlight-cache"
import { useInView } from "../../utils/in-view"
import { parseDiffRows } from "./content-diff-rows"
import "./content-diff.css"

type MobileCell = {
  source: "left" | "right"
  index: number
  text: string
}

type MobileBlock = {
  type: "removed" | "added" | "unchanged"
  cells: MobileCell[]
}

interface Props {
  diff: string
  lang?: string
}

function DiffSlotCode(props: { source: HighlightedLines | undefined; index: number; text: string }) {
  const html = createMemo(() => {
    const source = props.source
    if (!source || props.index < 0 || props.index >= source.lines.length) return undefined
    return `<pre class="${source.preClass}" style="${source.preStyle}" tabindex="0"><code>${source.lines[props.index]}</code></pre>`
  })

  return (
    <Show when={html()} fallback={<pre class="content-code" data-flush="true">{props.text}</pre>}>
      {(h) => <div class="content-code" data-flush="true" innerHTML={h()} />}
    </Show>
  )
}

export function ContentDiff(props: Props) {
  const parsed = createMemo(() => parseDiffRows(props.diff))
  // Defer the (expensive) whole-side highlighting until the diff approaches
  // the viewport; rows render as plain text until then.
  const { ref, inView } = useInView({ rootMargin: "400px 0px" })
  const leftSource = useHighlightedLines(() => parsed().leftLines.join("\n"), () => props.lang, inView)
  const rightSource = useHighlightedLines(() => parsed().rightLines.join("\n"), () => props.lang, inView)

  // Mirror the CSS breakpoint in content-diff.css so only one of the two
  // layouts is ever in the DOM -- rendering both doubled the highlight and
  // DOM work for every diff.
  const [compact, setCompact] = createSignal(false)
  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(max-width: 40rem)")
    const onChange = () => setCompact(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    onCleanup(() => mql.removeEventListener("change", onChange))
  })

  const mobileBlocks = createMemo(() => {
    const blocks: MobileBlock[] = []
    const rows = parsed().rows

    let i = 0
    while (i < rows.length) {
      const removed: MobileCell[] = []
      const added: MobileCell[] = []

      // Collect consecutive modified/removed/added rows
      while (
        i < rows.length &&
        (rows[i].type === "modified" || rows[i].type === "removed" || rows[i].type === "added")
      ) {
        const row = rows[i]
        if (row.leftText && (row.type === "removed" || row.type === "modified")) {
          removed.push({ source: "left", index: row.leftIndex, text: row.leftText })
        }
        if (row.rightText && (row.type === "added" || row.type === "modified")) {
          added.push({ source: "right", index: row.rightIndex, text: row.rightText })
        }
        i++
      }

      if (removed.length > 0) blocks.push({ type: "removed", cells: removed })
      if (added.length > 0) blocks.push({ type: "added", cells: added })

      // Add unchanged rows as-is
      if (i < rows.length && rows[i].type === "unchanged") {
        blocks.push({
          type: "unchanged",
          cells: [{ source: "left", index: rows[i].leftIndex, text: rows[i].leftText }],
        })
        i++
      }
    }

    return blocks
  })

  return (
    <div ref={ref} class="content-diff">
      <Show
        when={!compact()}
        fallback={
          <div class="diff-mobile">
            <For each={mobileBlocks()}>
              {(block) => (
                <div class="diff-block" data-type={block.type}>
                  <For each={block.cells}>
                    {(cell) => (
                      <div data-diff-type={block.type === "removed" ? "removed" : block.type === "added" ? "added" : ""}>
                        <DiffSlotCode
                          source={cell.source === "left" ? leftSource() : rightSource()}
                          index={cell.index}
                          text={cell.text}
                        />
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        }
      >
        <div class="diff-desktop">
          <For each={parsed().rows}>
            {(r) => (
              <div class="diff-row" data-type={r.type}>
                <div
                  class="diff-slot diff-before"
                  data-diff-type={r.type === "removed" || r.type === "modified" ? "removed" : ""}
                >
                  <DiffSlotCode source={leftSource()} index={r.leftIndex} text={r.leftText} />
                </div>
                <div
                  class="diff-slot diff-after"
                  data-diff-type={r.type === "added" || r.type === "modified" ? "added" : ""}
                >
                  <DiffSlotCode source={rightSource()} index={r.rightIndex} text={r.rightText} />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
