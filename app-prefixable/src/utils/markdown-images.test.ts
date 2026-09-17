import { expect, test } from "bun:test"
import { resolveMarkdownLinkPath, resolveRepoRelativePath, rewriteMarkdownImages } from "./markdown-images"

test("resolves repo-relative paths against the base directory", () => {
  expect(resolveRepoRelativePath("docs/guide", "./setup.md")).toBe("docs/guide/setup.md")
  expect(resolveRepoRelativePath("docs/guide", "../img/logo.png")).toBe("docs/img/logo.png")
  expect(resolveRepoRelativePath("", "README.md")).toBe("README.md")
  expect(resolveRepoRelativePath("docs", "/src/index.ts")).toBe("src/index.ts")
})

test("resolves markdown link paths and skips external targets", () => {
  expect(resolveMarkdownLinkPath("docs", "setup.md#intro")).toBe("docs/setup.md")
  expect(resolveMarkdownLinkPath("docs", "my%20file.md")).toBe("docs/my file.md")
  expect(resolveMarkdownLinkPath("docs", "https://example.com/x.md")).toBeNull()
  expect(resolveMarkdownLinkPath("docs", "mailto:a@b.c")).toBeNull()
  expect(resolveMarkdownLinkPath("docs", "#section")).toBeNull()
})

test("rewrites image references but leaves links and code fences alone", () => {
  const rewrite = (target: string) => (target.endsWith(".png") ? `RAW:${target}` : null)
  const input = [
    "![logo](img/logo.png)",
    "[guide](setup.md)",
    "<img src='img/other.png' alt='x'>",
    "```",
    "![kept](img/fenced.png)",
    "```",
  ].join("\n")
  const output = rewriteMarkdownImages(input, rewrite)
  expect(output).toContain("![logo](RAW:img/logo.png)")
  expect(output).toContain("[guide](setup.md)")
  expect(output).toContain('<img src="RAW:img/other.png"')
  expect(output).toContain("![kept](img/fenced.png)")
})
