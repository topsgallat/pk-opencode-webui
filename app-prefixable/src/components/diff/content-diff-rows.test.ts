import { describe, expect, test } from "bun:test"
import { parseDiffRows } from "./content-diff-rows"

const patch = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,5 +1,6 @@",
  " const one = 1",
  "-const two = 2",
  "+const two = 22",
  " const three = 3",
  "-const four = 4",
  "+const five = 5",
  "+const six = 6",
  " const seven = 7",
].join("\n")

describe("parseDiffRows", () => {
  test("pairs removals with additions into modified rows", () => {
    const { rows } = parseDiffRows(patch)
    expect(rows.map((r) => r.type)).toEqual([
      "unchanged",
      "modified",
      "unchanged",
      "modified",
      "added",
      "unchanged",
    ])
  })

  test("indexes line up with the side line lists", () => {
    const { rows, leftLines, rightLines } = parseDiffRows(patch)

    for (const row of rows) {
      if (row.leftIndex >= 0) expect(leftLines[row.leftIndex]).toBe(row.leftText)
      if (row.rightIndex >= 0) expect(rightLines[row.rightIndex]).toBe(row.rightText)
    }

    expect(leftLines).toEqual(["const one = 1", "const two = 2", "const three = 3", "const four = 4", "const seven = 7"])
    expect(rightLines).toEqual(["const one = 1", "const two = 22", "const three = 3", "const five = 5", "const six = 6", "const seven = 7"])
  })

  test("marks unpaired sides with index -1 and empty text", () => {
    const { rows } = parseDiffRows(patch)
    const added = rows.filter((r) => r.type === "added")
    expect(added.length).toBe(1)
    for (const row of added) {
      expect(row.leftIndex).toBe(-1)
      expect(row.leftText).toBe("")
      expect(row.rightIndex).toBeGreaterThanOrEqual(0)
    }
  })

  test("returns empty result on malformed patch without throwing", () => {
    const result = parseDiffRows("not a patch at all")
    expect(result.rows).toEqual([])
    expect(result.leftLines).toEqual([])
    expect(result.rightLines).toEqual([])
  })
})
