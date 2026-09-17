import { parsePatch } from "diff";

export type DiffRowType = "added" | "removed" | "unchanged" | "modified";

export type DiffRow = {
  leftText: string;
  rightText: string;
  // Index into the side's full line list (-1 when the side has no content),
  // letting the renderer reuse a single whole-side highlight per column.
  leftIndex: number;
  rightIndex: number;
  type: DiffRowType;
};

export type ParsedDiff = {
  rows: DiffRow[];
  leftLines: string[];
  rightLines: string[];
};

// Parse a unified diff patch into display rows plus the complete before/after
// line lists. Highlighting each side once over the joined lines (instead of
// per row) keeps syntax state correct across lines and turns N shiki calls
// into 2.
export function parseDiffRows(diff: string): ParsedDiff {
  const rows: DiffRow[] = [];
  const leftLines: string[] = [];
  const rightLines: string[] = [];

  const pushLeft = (text: string) => {
    leftLines.push(text);
    return leftLines.length - 1;
  };
  const pushRight = (text: string) => {
    rightLines.push(text);
    return rightLines.length - 1;
  };

  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(diff);
  } catch (error) {
    console.error("[ContentDiff] Failed to parse patch:", error);
    return { rows, leftLines, rightLines };
  }

  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      const lines = hunk.lines;
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        const content = line.slice(1);
        const prefix = line[0];

        if (prefix === "-") {
          // Look ahead for consecutive additions to pair with removals
          const removals: string[] = [content];
          let j = i + 1;

          while (j < lines.length && lines[j][0] === "-") {
            removals.push(lines[j].slice(1));
            j++;
          }

          const additions: string[] = [];
          while (j < lines.length && lines[j][0] === "+") {
            additions.push(lines[j].slice(1));
            j++;
          }

          // Pair removals with additions
          const maxLength = Math.max(removals.length, additions.length);
          for (let k = 0; k < maxLength; k++) {
            const hasLeft = k < removals.length;
            const hasRight = k < additions.length;

            rows.push({
              leftText: hasLeft ? removals[k] : "",
              rightText: hasRight ? additions[k] : "",
              leftIndex: hasLeft ? pushLeft(removals[k]) : -1,
              rightIndex: hasRight ? pushRight(additions[k]) : -1,
              type: hasLeft && hasRight ? "modified" : hasLeft ? "removed" : "added",
            });
          }

          i = j;
        } else if (prefix === "+") {
          // Standalone addition (not paired with removal)
          rows.push({
            leftText: "",
            rightText: content,
            leftIndex: -1,
            rightIndex: pushRight(content),
            type: "added",
          });
          i++;
        } else if (prefix === " ") {
          const normalized = content === "" ? " " : content;
          rows.push({
            leftText: normalized,
            rightText: normalized,
            leftIndex: pushLeft(normalized),
            rightIndex: pushRight(normalized),
            type: "unchanged",
          });
          i++;
        } else {
          i++;
        }
      }
    }
  }

  return { rows, leftLines, rightLines };
}
