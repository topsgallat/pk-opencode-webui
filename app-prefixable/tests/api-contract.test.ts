/**
 * API Contract Smoke Tests for OpenCode Server
 *
 * These tests verify that the OpenCode server API hasn't changed in breaking ways.
 * They test endpoint availability and response schema structure.
 *
 * Usage:
 *   1. Start OpenCode server: opencode serve
 *   2. Run tests: bun run test:api
 *
 * Environment variables:
 *   OPENCODE_URL - Server URL (default: http://127.0.0.1:4096)
 *   REQUIRE_SERVER - Set to "true" to fail if server unavailable (default: false)
 *
 * Security: requests are only allowed against loopback servers. OPENCODE_URL
 * pointing anywhere else is rejected by apiUrl() before any fetch happens.
 */

import { describe, test, expect, beforeAll } from "bun:test";

const BASE_URL = process.env.OPENCODE_URL || "http://127.0.0.1:4096";
const REQUIRE_SERVER = process.env.REQUIRE_SERVER === "true";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

// Build a request URL for the contract test server, enforcing the loopback
// whitelist. Everything this file fetches must go through here.
function apiUrl(path: string, base: string = BASE_URL): URL {
  const url = new URL(path, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Contract tests only use http(s), got: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(host) && !host.endsWith(".localhost")) {
    throw new Error(`Contract tests only talk to loopback servers, got: ${url.host}`);
  }
  return url;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}

let serverIsAvailable = false;

// Helper to check if server is available
async function checkServer(): Promise<boolean> {
  const res = await apiFetch("/global/health", {
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  return res?.ok ?? false;
}

// Helper to skip test if server unavailable
function skipIfNoServer() {
  if (!serverIsAvailable) {
    if (REQUIRE_SERVER) {
      throw new Error(`OpenCode server required but not available at ${BASE_URL}`);
    }
    return true;
  }
  return false;
}

describe("contract test URL guard", () => {
  test("accepts loopback base urls", () => {
    expect(apiUrl("/session", "http://127.0.0.1:4096").host).toBe("127.0.0.1:4096");
    expect(apiUrl("/session", "http://localhost:4096").pathname).toBe("/session");
    expect(apiUrl("/session", "http://[::1]:4096").host).toBe("[::1]:4096");
  });

  test("rejects non-loopback and non-http targets", () => {
    expect(() => apiUrl("/session", "http://192.168.1.10:4096")).toThrow(/loopback/);
    expect(() => apiUrl("/session", "http://opencode.lan:4096")).toThrow(/loopback/);
    expect(() => apiUrl("/session", "file:///etc/passwd")).toThrow(/http\(s\)/);
  });
});

describe("OpenCode API Contract", () => {
  beforeAll(async () => {
    serverIsAvailable = await checkServer();
    if (!serverIsAvailable) {
      console.warn(
        `\nOpenCode server not available at ${BASE_URL}.\n` +
          "Start with: opencode serve\n" +
          "Tests will be skipped.\n"
      );
    }
  });

  // Core Session Endpoints
  describe("Session API", () => {
    test("GET /session/status returns expected schema", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/session/status");
      expect(res.ok).toBe(true);
      const data = await res.json();
      // /session/status returns a map of sessionID -> SessionStatus
      expect(data !== null && typeof data === "object" && !Array.isArray(data)).toBe(true);
    });

    test("GET /session returns array", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/session");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("POST /session creates session", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("id");
    });

    test("GET /session/{id}/message returns messages array", async () => {
      if (skipIfNoServer()) return;
      // First create a session to get an ID
      const sessionRes = await apiFetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(sessionRes.ok).toBe(true);
      const session = await sessionRes.json();

      const res = await apiFetch(`/session/${session.id}/message`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("POST /session/{id}/message endpoint exists", async () => {
      if (skipIfNoServer()) return;
      // First create a session
      const sessionRes = await apiFetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(sessionRes.ok).toBe(true);
      const session = await sessionRes.json();

      // Test that the endpoint accepts POST (we don't send a real prompt)
      const res = await apiFetch(`/session/${session.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });
      // Endpoint should exist (may return 400 for empty content, but not 404)
      expect(res.status).not.toBe(404);
    });
  });

  // Provider Endpoints
  describe("Provider API", () => {
    test("GET /provider returns provider summary object", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/provider");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data !== null && typeof data === "object").toBe(true);
    });

    test("GET /provider/auth returns auth info", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/provider/auth");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // Config Endpoints
  describe("Config API", () => {
    test("GET /config returns config object", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/config");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /config/providers returns providers config", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/config/providers");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // Global Endpoints
  describe("Global API", () => {
    test("GET /global/health returns ok", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/global/health");
      expect(res.ok).toBe(true);
    });

    test("GET /global/config returns global config", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/global/config");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // Project Endpoints
  describe("Project API", () => {
    test("GET /project returns array", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/project");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("GET /project/current returns project object", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/project/current");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("worktree");
    });
  });

  // File Endpoints
  describe("File API", () => {
    test("GET /file?path=. returns file list", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/file?path=.");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // MCP Endpoints
  describe("MCP API", () => {
    test("GET /mcp returns MCP status", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/mcp");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // PTY Endpoints
  describe("PTY API", () => {
    test("GET /pty returns pty list", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/pty");
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("POST /pty creates terminal session", async () => {
      if (skipIfNoServer()) return;
      const res = await apiFetch("/pty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("id");
    });
  });

  // SSE Event Endpoint
  describe("Event API", () => {
    test("GET /event returns SSE stream", async () => {
      if (skipIfNoServer()) return;
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 2000);

      const res = await apiFetch("/event", {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      }).catch((e) => {
        // AbortError is only expected after our explicit timeout
        if (e.name === "AbortError" && timedOut) return null;
        throw e;
      });

      clearTimeout(timeout);

      // If we got a response before abort, verify it's SSE
      if (res) {
        expect(res.ok).toBe(true);
        const contentType = res.headers.get("content-type") ?? "";
        expect(contentType).toContain("text/event-stream");
      }
    });
  });
});
