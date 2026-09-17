/**
 * Rewrites relative image references in markdown so previews can load them
 * from a backend URL (working tree or a git branch) instead of the page URL.
 */

/** Resolve a markdown image target against the file's directory in the repo. */
export function resolveRepoRelativePath(baseDir: string, target: string): string {
  const absolute = target.startsWith("/")
  const segments = (absolute ? target : `${baseDir ? `${baseDir}/` : ""}${target}`).split("/")
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/")
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Repo-relative path a markdown link points at, or null for external URLs,
 * anchors and empty targets.
 */
export function resolveMarkdownLinkPath(baseDir: string, href: string): string | null {
  const cleaned = safeDecode(href.replace(/^<|>$/g, "").trim()).split("#")[0]
  if (!cleaned || /^(https?:|data:|blob:|mailto:|tel:)/i.test(cleaned)) return null
  const resolved = resolveRepoRelativePath(baseDir, cleaned)
  return resolved || null
}

/** Apply a line transform outside fenced code blocks so examples stay intact. */
function mapOutsideFences(content: string, transform: (line: string) => string): string {
  let fenced = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : transform(line);
    })
    .join("\n");
}

/**
 * Rewrites `![alt](path)` and `<img src="path">` targets via toUrl.
 * Returning null from toUrl leaves the reference untouched.
 */
export function rewriteMarkdownImages(content: string, toUrl: (target: string) => string | null): string {
  return mapOutsideFences(content, (line) =>
    line
      .replace(/!\[([^\]]*)\]\(<?([^)\s]+?)>?(?:\s+"[^"]*")?\)/g, (full, alt: string, target: string) => {
        const url = toUrl(target);
        return url ? `![${alt}](${url})` : full;
      })
      .replace(/(<img\b[^>]*\bsrc=)("([^"]*)"|'([^']*)')/gi, (full, head: string, _quoted: string, dq: string, sq: string) => {
        const url = toUrl(dq ?? sq);
        return url ? `${head}"${url}"` : full;
      }),
  );
}
