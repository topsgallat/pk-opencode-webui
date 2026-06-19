type ArrowLeftAction =
  | { type: "collapse" }
  | { type: "focus-parent"; path: string }
  | { type: "exit" }

function parentPath(path: string) {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? "" : path.slice(0, idx)
}

export function resolveFileTreeArrowLeftAction(path: string, expanded: boolean): ArrowLeftAction {
  if (expanded) return { type: "collapse" }
  const parent = parentPath(path)
  if (!parent) return { type: "exit" }
  return { type: "focus-parent", path: parent }
}
