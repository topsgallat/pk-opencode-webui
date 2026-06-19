import { describe, expect, it } from "bun:test"
import { resolveFileTreeArrowLeftAction } from "./file-tree-keyboard"

describe("resolveFileTreeArrowLeftAction", () => {
  it("collapses expanded directories first", () => {
    expect(resolveFileTreeArrowLeftAction("docs", true)).toEqual({ type: "collapse" })
  })

  it("focuses the parent for nested files and directories", () => {
    expect(resolveFileTreeArrowLeftAction("docs/readme.md", false)).toEqual({
      type: "focus-parent",
      path: "docs",
    })

    expect(resolveFileTreeArrowLeftAction("docs/guides/api", false)).toEqual({
      type: "focus-parent",
      path: "docs/guides",
    })
  })

  it("exits when the item is already at the project boundary", () => {
    expect(resolveFileTreeArrowLeftAction("docs", false)).toEqual({ type: "exit" })
  })
})
