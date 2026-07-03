import { describe, expect, it } from "bun:test"
import { extractOpenCodeGoAuthCookie, extractOpenCodeGoWorkspaceId } from "./opencode-go-config-paste"

describe("extractOpenCodeGoWorkspaceId", () => {
  it("returns raw workspace id", () => {
    expect(extractOpenCodeGoWorkspaceId("wk_abc123")).toBe("wk_abc123")
  })

  it("extracts id from workspace url", () => {
    expect(extractOpenCodeGoWorkspaceId("https://opencode.ai/workspace/wk_abc123/go")).toBe("wk_abc123")
    expect(extractOpenCodeGoWorkspaceId("https://opencode.ai/workspace/wk_xyz789/usage")).toBe("wk_xyz789")
  })

  it("trims whitespace", () => {
    expect(extractOpenCodeGoWorkspaceId("  wk_trimmed  ")).toBe("wk_trimmed")
  })

  it("returns undefined for invalid input", () => {
    expect(extractOpenCodeGoWorkspaceId("")).toBeUndefined()
    expect(extractOpenCodeGoWorkspaceId("no workspace here")).toBeUndefined()
  })
})

describe("extractOpenCodeGoAuthCookie", () => {
  it("returns raw cookie value", () => {
    expect(extractOpenCodeGoAuthCookie("opaquevalue123")).toBe("opaquevalue123")
  })

  it("extracts value from auth=... string", () => {
    expect(extractOpenCodeGoAuthCookie("auth=opaquevalue123")).toBe("opaquevalue123")
  })

  it("extracts value from cookie header", () => {
    expect(extractOpenCodeGoAuthCookie("cookie: auth=opaquevalue123; other=x")).toBe("opaquevalue123")
  })

  it("extracts value from curl -H line", () => {
    expect(extractOpenCodeGoAuthCookie("curl -H 'cookie: auth=opaquevalue123' https://opencode.ai/")).toBe("opaquevalue123")
  })

  it("extracts value from devtools row", () => {
    expect(extractOpenCodeGoAuthCookie("auth\topaquevalue123\topencode.ai\t/")).toBe("opaquevalue123")
  })

  it("returns undefined for empty or invalid input", () => {
    expect(extractOpenCodeGoAuthCookie("")).toBeUndefined()
    expect(extractOpenCodeGoAuthCookie("   ")).toBeUndefined()
  })
})