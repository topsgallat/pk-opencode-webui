import { createSignal, createEffect, createMemo, Show, For, createRoot, JSX, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { Part, ToolPart as SDKToolPart, ToolState, ReasoningPart as SDKReasoningPart } from "../sdk/client";
import { ChevronDown, ExternalLink, Users, Sparkles, Brain } from "lucide-solid";
import { ContentDiff } from "./diff/content-diff";
import { ContentCode } from "./diff/content-code";
import { useSync } from "../context/sync";
import { useParams, useNavigate } from "@solidjs/router";
import { base64Encode } from "../utils/path";
import { useSDK } from "../context/sdk";
import { Markdown } from "./markdown";

// Use the SDK's types
type ToolPart = SDKToolPart;
type ReasoningPart = SDKReasoningPart;

// Limit how many tool part expansion states we keep to avoid unbounded growth.
const MAX_EXPANDED_STATES = 1000;

// Module-level store for expanded states that persists across re-renders
// Wrapped in createRoot to avoid "no owner" warnings and ensure proper reactive context
const expandedStore = createRoot(() => {
  const expandedKeys: string[] = [];
  const [states, setStates] = createStore<Record<string, boolean>>({});

  return {
    get: (id: string) => states[id] ?? false,
    set: (id: string, value: boolean) => {
      const isNewKey = !(id in states);

      // Only update if value actually changes
      if (!isNewKey && states[id] === value) return;

      setStates(produce(state => {
        state[id] = value;

        if (isNewKey) {
          expandedKeys.push(id);
          // Evict oldest entry if over limit
          if (expandedKeys.length > MAX_EXPANDED_STATES) {
            const oldest = expandedKeys.shift();
            if (oldest && oldest in state && oldest !== id) {
              delete state[oldest];
            }
          }
        }
      }));
    },
    toggle: (id: string) => {
      expandedStore.set(id, !expandedStore.get(id));
    },
  };
});

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

// Get status from tool state
function getStatus(
  state: ToolState,
): "pending" | "running" | "completed" | "error" {
  return state.status;
}

// Check if state has output
function hasOutput(state: ToolState): boolean {
  return state.status === "completed" || state.status === "error";
}

// Get output from state
function getOutput(state: ToolState): string | undefined {
  if (state.status === "completed") return state.output;
  return undefined;
}

// Get error from state
function getError(state: ToolState): string | undefined {
  if (state.status === "error") return state.error;
  return undefined;
}

// Get input from state
function getInput(state: ToolState): Record<string, unknown> | undefined {
  return state.input;
}

// Get title from state
function getTitle(state: ToolState): string | undefined {
  if (state.status === "completed") return state.title;
  if (state.status === "running") return state.title;
  return undefined;
}

// Get icon for tool type
function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    bash: "M4 17l6-6-6-6M12 19h8",
    read: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    write:
      "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    glob: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    grep: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    list: "M4 6h16M4 10h16M4 14h16M4 18h16",
    webfetch:
      "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
    task: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    todowrite:
      "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    question:
      "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return icons[tool] || "M13 10V3L4 14h7v7l9-11h-7z"; // Default: lightning bolt
}

// Get status color
function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "var(--icon-success-base)";
    case "running":
      return "var(--text-interactive-base)";
    case "pending":
      return "var(--text-weak)";
    case "error":
      return "var(--icon-critical-base)";
    default:
      return "var(--text-weak)";
  }
}

function fieldLabel(text: string): JSX.Element {
  return (
    <span class="text-xs" style={{ color: "var(--text-weak)", "margin-right": "0.35em" }}>
      {text}
    </span>
  );
}

function codePill(text: string): JSX.Element {
  return (
    <code
      class="text-xs px-1.5 py-0.5 rounded font-mono break-all"
      style={{ background: "var(--surface-inset)", color: "var(--text-strong)" }}
    >
      {text}
    </code>
  );
}

function CopyButton(props: { getText: () => string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = () => {
    const text = props.getText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copy(); }}
      class="w-6 h-6 flex items-center justify-center rounded transition-colors shrink-0"
      style={{ background: "transparent", border: "none", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-inset)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      title="Copy to clipboard"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
        style={{ color: copied() ? "var(--status-success-text)" : "var(--text-weak)" }}>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d={copied() ? "M5 13l4 4L19 7" : "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"} />
      </svg>
    </button>
  );
}

function renderToolInput(tool: string, input: Record<string, unknown>): JSX.Element {
  switch (tool) {
    case "bash": {
      const cmd = String(input.command ?? "");
      return (
        <pre
          class="whitespace-pre-wrap text-xs font-mono px-2 py-1.5 rounded"
          style={{ background: "var(--background-base)", color: "var(--text-strong)" }}
        >
          {cmd}
        </pre>
      );
    }

    case "read": {
      const fp = String(input.filePath ?? "");
      const offset = input.offset != null ? Number(input.offset) : null;
      const limit = input.limit != null ? Number(input.limit) : null;
      return (
        <div class="flex flex-col gap-1">
          <div class="flex items-start gap-1 flex-wrap">
            {fieldLabel("file")}
            {codePill(fp)}
          </div>
          <Show when={offset != null || limit != null}>
            <div class="flex items-center gap-2 flex-wrap">
              <Show when={offset != null}>
                <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                  line {offset}
                </span>
              </Show>
              <Show when={limit != null}>
                <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                  limit {limit}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      );
    }

    case "write":
    case "edit": {
      const fp = String(input.filePath ?? "");
      return (
        <div class="flex items-start gap-1 flex-wrap">
          {fieldLabel("file")}
          {codePill(fp)}
        </div>
      );
    }

    case "glob": {
      const pattern = String(input.pattern ?? "");
      const path = input.path ? String(input.path) : null;
      return (
        <div class="flex flex-col gap-1">
          <div class="flex items-start gap-1 flex-wrap">
            {fieldLabel("pattern")}
            {codePill(pattern)}
          </div>
          <Show when={path}>
            <div class="flex items-start gap-1 flex-wrap">
              {fieldLabel("in")}
              {codePill(path!)}
            </div>
          </Show>
        </div>
      );
    }

    case "grep": {
      const pattern = String(input.pattern ?? "");
      const path = input.path ? String(input.path) : null;
      const include = input.include ? String(input.include) : null;
      const outputMode = input.output_mode ? String(input.output_mode) : null;
      return (
        <div class="flex flex-col gap-1">
          <div class="flex items-start gap-1 flex-wrap">
            {fieldLabel("pattern")}
            {codePill(pattern)}
          </div>
          <Show when={path}>
            <div class="flex items-start gap-1 flex-wrap">
              {fieldLabel("in")}
              {codePill(path!)}
            </div>
          </Show>
          <Show when={include}>
            <div class="flex items-start gap-1 flex-wrap">
              {fieldLabel("files")}
              {codePill(include!)}
            </div>
          </Show>
          <Show when={outputMode}>
            <div class="flex items-center gap-1">
              {fieldLabel("mode")}
              <span class="text-xs" style={{ color: "var(--text-base)" }}>{outputMode}</span>
            </div>
          </Show>
        </div>
      );
    }

    case "webfetch": {
      const url = String(input.url ?? "");
      const fmt = input.format ? String(input.format) : null;
      return (
        <div class="flex flex-col gap-1">
          <div class="flex items-start gap-1 flex-wrap">
            {fieldLabel("url")}
            <span
              class="text-xs font-mono break-all"
              style={{ color: "var(--text-interactive-base)" }}
            >
              {url}
            </span>
          </div>
          <Show when={fmt}>
            <div class="flex items-center gap-1">
              {fieldLabel("format")}
              <span class="text-xs" style={{ color: "var(--text-base)" }}>{fmt}</span>
            </div>
          </Show>
        </div>
      );
    }

    case "todowrite": {
      const todos = Array.isArray(input.todos)
        ? (input.todos as { content: string; status: string; priority?: string }[])
        : [];
      const statusIcon = (s: string) =>
        s === "completed" ? "✓" : s === "in_progress" ? "▸" : s === "cancelled" ? "✕" : "○";
      const statusColor = (s: string) =>
        s === "completed"
          ? "var(--icon-success-base)"
          : s === "in_progress"
          ? "var(--text-interactive-base)"
          : s === "cancelled"
          ? "var(--text-weak)"
          : "var(--text-base)";
      return (
        <div class="flex flex-col gap-0.5">
          <For each={todos}>
            {(todo) => (
              <div class="flex items-start gap-1.5 text-xs">
                <span style={{ color: statusColor(todo.status), "flex-shrink": 0 }}>
                  {statusIcon(todo.status)}
                </span>
                <span style={{ color: "var(--text-base)" }}>{todo.content}</span>
                <Show when={todo.priority && todo.priority !== "medium"}>
                  <span
                    class="ml-auto shrink-0 text-xs"
                    style={{ color: "var(--text-weak)" }}
                  >
                    {todo.priority}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      );
    }

    case "question": {
      const prompt = String(input.prompt ?? "");
      const questions = Array.isArray(input.questions)
        ? (input.questions as { question: string; options?: { label: string }[] }[])
        : [];
      return (
        <div class="flex flex-col gap-2">
          <Show when={prompt}>
            <p class="text-xs" style={{ color: "var(--text-base)" }}>{prompt}</p>
          </Show>
          <For each={questions}>
            {(q) => (
              <div class="flex flex-col gap-0.5">
                <p class="text-xs font-medium" style={{ color: "var(--text-strong)" }}>{q.question}</p>
                <Show when={q.options && q.options.length > 0}>
                  <div class="flex flex-col gap-0.5 pl-2">
                    <For each={q.options ?? []}>
                      {(opt) => (
                        <span class="text-xs" style={{ color: "var(--text-weak)" }}>· {opt.label}</span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      );
    }

    default: {
      const entries = Object.entries(input).filter(([, v]) => v != null && v !== "");
      if (entries.length === 0) return <></>;
      return (
        <div class="flex flex-col gap-1">
          <For each={entries}>
            {([k, v]) => (
              <div class="flex items-start gap-1 text-xs flex-wrap">
                {fieldLabel(k)}
                <span
                  class="font-mono break-all"
                  style={{ color: "var(--text-base)" }}
                >
                  {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                    ? String(v)
                    : JSON.stringify(v)}
                </span>
              </div>
            )}
          </For>
        </div>
      );
    }
  }
}

// Get language from file extension for syntax highlighting
function getLangFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
  };
  return langMap[ext] || "text";
}

function parseReadOutput(raw: string): string {
  const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/);
  const text = contentMatch ? contentMatch[1] : raw;
  return text.replace(/^\d+: /gm, "").replace(/\n$/, "");
}

// Deterministic color pair for an agent name (mirrors message-turn.tsx)
function getAgentColors(agent?: string) {
  const base = { bg: "var(--surface-brand-muted)", fg: "var(--text-interactive-base)" };
  if (!agent) return base;
  const palette = [
    base,
    { bg: "var(--status-success-dim)", fg: "var(--status-success-text)" },
    { bg: "var(--status-warning-dim)", fg: "var(--status-warning-text)" },
    { bg: "var(--status-danger-dim)", fg: "var(--status-danger-text)" },
    { bg: "var(--surface-inset)", fg: "var(--text-strong)" },
  ];
  const hash = Array.from(agent).reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return palette[Math.abs(hash) % palette.length];
}

// Get metadata from state
function getMetadata(state: ToolState): Record<string, unknown> | undefined {
  if (state.status === "completed")
    return state.metadata as Record<string, unknown> | undefined;
  if (state.status === "running")
    return state.metadata as Record<string, unknown> | undefined;
  return undefined;
}

// Extract child session ID from task tool metadata or output
function getChildSessionId(state: ToolState): string | undefined {
  const metadata = getMetadata(state);
  if (metadata?.sessionId) return metadata.sessionId as string;

  // Fallback: parse from output if metadata not available
  const output = getOutput(state);
  if (output) {
    const match = output.match(/task_id:\s*([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  }
  return undefined;
}

// Get tool summary from child session messages
function getChildToolSummary(
  tools: { tool: string; status: string }[],
): string {
  if (tools.length === 0) return "";
  const counts = tools.reduce(
    (acc, t) => {
      acc[t.tool] = (acc[t.tool] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return Object.entries(counts)
    .map(([tool, count]) => `${tool}${count > 1 ? ` (${count})` : ""}`)
    .join(", ");
}

// Task tool display with child session visualization
function TaskToolDisplay(props: { part: ToolPart }) {
  const sync = useSync();
  const params = useParams<{ dir: string }>();
  const navigate = useNavigate();
  const { directory } = useSDK();

  // Use the module-level store for expanded state to persist across re-renders
  const expanded = () => expandedStore.get(props.part.id);

  const state = () => props.part.state;
  const status = () => getStatus(state());
  const metadata = () => getMetadata(state());
  const title = () => getTitle(state()) || "Delegating work";
  const childId = () => getChildSessionId(state());

  // Get child session messages to show tool usage
  const childMessages = createMemo(() => {
    const id = childId();
    if (!id) return [];
    return sync.messages(id);
  });

  // Extract tool parts from child session
  const childTools = createMemo(() => {
    return childMessages().flatMap((msg) =>
      msg.parts
        .filter((p): p is ToolPart => p.type === "tool")
        .map((p) => ({ tool: p.tool, status: getStatus(p.state) })),
    );
  });

  const childAgent = createMemo(() => {
    const first = childMessages().find((m) => m.info.role === "assistant" && (m.info as { agent?: string }).agent);
    if (!first) return undefined;
    const info = first.info as { agent: string; providerID: string; modelID: string };
    return { agent: info.agent, providerID: info.providerID, modelID: info.modelID };
  });

  // Sync child session data when we have a child ID
  createEffect(() => {
    const id = childId();
    if (id) {
      sync.session.sync(id);
    }
  });

  const dirSlug = createMemo(() =>
    directory ? base64Encode(directory) : params.dir,
  );

  function navigateToChild(e: MouseEvent) {
    e.stopPropagation();
    const id = childId();
    if (!id) return;
    navigate(`/${dirSlug()}/session/${id}`);
  }

  return (
    <div
      class="rounded-md overflow-hidden"
      style={{
        border: "1px solid var(--border-base)",
        background: "var(--background-base)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => expandedStore.toggle(props.part.id)}
        class="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
        style={{
          background: expanded() ? "var(--surface-inset)" : "transparent",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!expanded())
            e.currentTarget.style.background = "var(--surface-inset)";
        }}
        onMouseLeave={(e) => {
          if (!expanded()) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Task/Agent icon */}
        <Users
          class="w-4 h-4 shrink-0"
          style={{ color: getStatusColor(status()) }}
        />

        {/* Title + optional agent badge */}
        <span class="flex items-center gap-1.5 flex-1 min-w-0">
          <span
            class="font-mono text-sm truncate"
            style={{ color: "var(--text-strong)" }}
          >
            {title()}
          </span>
          <Show when={childAgent()}>
            {(ca) => {
              const colors = () => getAgentColors(ca().agent);
              return (
                <>
                  <span style={{ color: "var(--text-weak)", "font-size": "0.7rem" }}>·</span>
                  <span
                    style={{
                      background: colors().bg,
                      color: colors().fg,
                      "border-radius": "9999px",
                      padding: "1px 7px",
                      "font-size": "0.7rem",
                      "font-weight": 600,
                      "white-space": "nowrap",
                      "flex-shrink": 0,
                    }}
                  >
                    {ca().agent}
                  </span>
                </>
              );
            }}
          </Show>
        </span>

        {/* Status indicator */}
        <span
          class="text-xs shrink-0"
          style={{ color: getStatusColor(status()) }}
        >
          {status() === "running" && "delegating..."}
          {status() === "pending" && "pending"}
          {status() === "error" && "error"}
        </span>

        {/* Expand arrow */}
        <ChevronDown
          class="w-4 h-4 shrink-0 transition-transform"
          style={{
            color: "var(--icon-weak)",
            transform: expanded() ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Expanded content */}
      <Show when={expanded()}>
        <div
          class="px-3 py-2 text-sm"
          style={{
            "border-top": "1px solid var(--border-base)",
            background: "var(--background-stronger)",
          }}
        >
          {/* Task prompt/description */}
          <Show
            when={(getInput(state()) as { description?: string })?.description}
          >
            {(desc) => (
              <div class="mb-2">
                <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                  Task:
                </div>
                <div class="text-xs" style={{ color: "var(--text-base)" }}>
                  {desc()}
                </div>
              </div>
            )}
          </Show>

          {/* Agent + model info */}
          <Show when={childAgent()}>
            {(ca) => {
              const colors = () => getAgentColors(ca().agent);
              return (
                <div class="flex items-center gap-1.5 flex-wrap mb-2">
                  <span class="text-xs" style={{ color: "var(--text-weak)" }}>Agent:</span>
                  <span
                    style={{
                      background: colors().bg,
                      color: colors().fg,
                      "border-radius": "9999px",
                      padding: "1px 8px",
                      "font-size": "0.7rem",
                      "font-weight": 600,
                    }}
                  >
                    {ca().agent}
                  </span>
                  <Show when={ca().providerID || ca().modelID}>
                    <span style={{ color: "var(--text-weak)", "font-size": "0.7rem" }}>·</span>
                    <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                      {[ca().providerID, ca().modelID].filter(Boolean).join(" / ")}
                    </span>
                  </Show>
                </div>
              );
            }}
          </Show>

          {/* Child session tools summary */}
          <Show when={childTools().length > 0}>
            <div class="mb-2">
              <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                Tools used ({childTools().length}):
              </div>
              <div class="flex flex-wrap gap-1">
                <For each={childTools()}>
                  {(tool) => (
                    <span
                      class="px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{
                        background: "var(--surface-inset)",
                        color: getStatusColor(tool.status),
                      }}
                    >
                      {tool.tool}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Link to child session */}
          <Show when={childId()}>
            <button
              onClick={navigateToChild}
              class="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors"
              style={{
                color: "var(--text-interactive-base)",
                background: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-inset)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <ExternalLink class="w-3 h-3" />
              <span>View sub-agent session</span>
            </button>
          </Show>

          {/* Output (collapsed by default, only shown if no child tools) */}
          <Show when={getOutput(state()) && childTools().length === 0}>
            {(output) => (
              <div class="mt-2">
                <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                  Result:
                </div>
                <pre
                  class="whitespace-pre-wrap text-xs max-h-32 overflow-y-auto"
                  style={{ color: "var(--text-base)" }}
                >
                  {output()}
                </pre>
              </div>
            )}
          </Show>

          {/* Error */}
          <Show when={getError(state())}>
            {(err) => (
              <div
                class="px-2 py-1 rounded text-xs mt-2"
                style={{
                  background: "var(--status-danger-dim)",
                  color: "var(--status-danger-text)",
                }}
              >
                {err()}
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Reasoning part display (AI Thinking)
function ReasoningPartDisplay(props: { part: ReasoningPart }) {
  const expanded = () => expandedStore.get(props.part.id);

  // Auto-expand when content starts arriving
  createEffect(() => {
    if (props.part.text.length > 0 && !expandedStore.get(props.part.id)) {
      expandedStore.set(props.part.id, true);
    }
  });

  return (
    <div
      class="rounded-md overflow-hidden bg-[var(--background-base)] border border-[var(--border-base)] mb-2"
    >
      <button
        onClick={() => expandedStore.toggle(props.part.id)}
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-inset)]"
        style={{
          background: expanded() ? "var(--surface-inset)" : "transparent",
        }}
      >
        <Sparkles class="w-3.5 h-3.5" style={{ color: "var(--text-interactive-base)" }} />
        <span class="text-xs font-medium uppercase tracking-wider opacity-70 flex-1" style={{ color: "var(--text-strong)" }}>
          Thought process
        </span>
        <ChevronDown
          class="w-3.5 h-3.5 transition-transform"
          style={{
            color: "var(--icon-weak)",
            transform: expanded() ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      <Show when={expanded()}>
        <div
          class="px-4 py-3 text-sm border-t border-[var(--border-base)] italic"
          style={{
            background: "var(--background-stronger)",
            color: "var(--text-base)",
          }}
        >
          <Markdown content={props.part.text} class="thinking-content opacity-80" />
        </div>
      </Show>
    </div>
  );
}

export function ToolPartDisplay(props: { part: ToolPart }) {
  // Use special rendering for task tool
  if (props.part.tool === "task") {
    return <TaskToolDisplay part={props.part} />;
  }

  // Use the module-level store for expanded state to persist across re-renders
  const expanded = () => expandedStore.get(props.part.id);

  const state = () => props.part.state;
  const status = () => getStatus(state());
  const metadata = () => getMetadata(state());
  const isFileChange = () =>
    props.part.tool === "edit" || props.part.tool === "write";
  const hasDiff = () => isFileChange() && metadata()?.diff;
  const isBash = () => props.part.tool === "bash";
  const bashInput = () => isBash() ? (getInput(state()) as { command?: string })?.command ?? "" : "";
  const isRead = () => props.part.tool === "read";
  const readFilePath = () => isRead() ? (getInput(state()) as { filePath?: string })?.filePath ?? "" : "";
  const isGlob = () => props.part.tool === "glob";
  const canExpand = () => (isBash() || isRead()) ? !!getInput(state()) : (hasOutput(state()) || hasDiff());
  const title = () => getTitle(state()) || props.part.tool;
  const filePath = () =>
    (getInput(state()) as { filePath?: string })?.filePath || "";

  const autoExpandedKey = `auto-${props.part.id}`;

  createEffect(() => {
    const shouldExpand = hasDiff() || (isBash() && !!getInput(state()));
    if (shouldExpand && !expandedStore.get(autoExpandedKey)) {
      expandedStore.set(autoExpandedKey, true);
      expandedStore.set(props.part.id, true);
    }
  });

  return (
    <div
      class="rounded-md overflow-hidden"
      style={{
        border: "1px solid var(--border-base)",
        background: "var(--background-base)",
      }}
    >
      {/* Header - always visible */}
      <button
        onClick={() => canExpand() && expandedStore.toggle(props.part.id)}
        class="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
        style={{
          background: expanded() ? "var(--surface-inset)" : "transparent",
          cursor: canExpand() ? "pointer" : "default",
        }}
        onMouseEnter={(e) => {
          if (canExpand() && !expanded())
            e.currentTarget.style.background = "var(--surface-inset)";
        }}
        onMouseLeave={(e) => {
          if (!expanded()) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Tool icon */}
        <svg
          class="w-4 h-4 shrink-0"
          style={{ color: getStatusColor(status()) }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d={getToolIcon(props.part.tool)}
          />
        </svg>

        {/* Tool name/title */}
        <span
          class="font-mono text-sm flex-1 truncate"
          style={{ color: "var(--text-strong)" }}
        >
          {title()}
        </span>

        {/* Status indicator */}
        <span
          class="text-xs shrink-0"
          style={{ color: getStatusColor(status()) }}
        >
          {status() === "running" && "running..."}
          {status() === "pending" && "pending"}
          {status() === "error" && "error"}
        </span>

        {/* Expand arrow */}
        <Show when={canExpand()}>
          <ChevronDown
            class="w-4 h-4 shrink-0 transition-transform"
            style={{
              color: "var(--icon-weak)",
              transform: expanded() ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </Show>
      </button>

      {/* Bash terminal block */}
      <Show when={expanded() && isBash() ? true : undefined}>
        {(_isTrue) => {
          const [elapsed, setElapsed] = createSignal<number>(0);
          createEffect(() => {
            if (status() === "running") {
              const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
              onCleanup(() => clearInterval(interval));
            } else {
              setElapsed(0);
            }
          });
          const formatElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

          return (
            <div
              class="px-3 py-2 font-mono text-xs overflow-x-auto"
              style={{
                "border-top": "1px solid var(--border-base)",
                background: "var(--background-base)",
              }}
            >
              <div class="flex items-start justify-between gap-1.5 mb-1">
                <div class="flex items-start gap-1.5">
                  <span style={{ color: "var(--status-success-text)", "flex-shrink": 0 }}>$</span>
                  <pre
                    class="whitespace-pre-wrap"
                    style={{ color: "var(--text-strong)" }}
                  >
                    {bashInput()}
                    <Show when={status() === "running" && !getOutput(state())}>
                      <span class="animate-pulse" style={{ color: "var(--status-success-text)" }}>▊</span>
                    </Show>
                  </pre>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <Show when={status() === "running"}>
                    <span style={{ color: "var(--text-weak)", "font-size": "0.7rem" }}>
                      {formatElapsed(elapsed())}
                    </span>
                  </Show>
                  <CopyButton getText={() => bashInput() + (getOutput(state()) ? "\n" + getOutput(state()) : "")} />
                </div>
              </div>
              <Show when={getOutput(state())}>
                {(output) => (
                  <pre
                    class="whitespace-pre-wrap max-h-64 overflow-y-auto mt-1"
                    style={{ color: "var(--text-base)" }}
                  >
                    {output()}
                  </pre>
                )}
              </Show>
              <Show when={getError(state())}>
                {(err) => (
                  <pre
                    class="whitespace-pre-wrap mt-1"
                    style={{ color: "var(--icon-critical-base)" }}
                  >
                    {err()}
                  </pre>
                )}
              </Show>
            </div>
          );
        }}
      </Show>

      {/* Read file code viewer block */}
      <Show when={expanded() && isRead() && getOutput(state())}>
        {(output) => (
          <div
            style={{ "border-top": "1px solid var(--border-base)" }}
          >
            <div
              class="px-3 py-1.5 text-xs font-mono flex justify-between items-center gap-2"
              style={{
                background: "var(--surface-inset)",
                color: "var(--text-weak)",
                "border-bottom": "1px solid var(--border-base)",
              }}
            >
              <span class="truncate">{readFilePath()}</span>
              <CopyButton getText={() => parseReadOutput(output())} />
            </div>
            <div class="overflow-x-auto max-h-96 overflow-y-auto">
              <ContentCode
                code={parseReadOutput(output())}
                lang={getLangFromPath(readFilePath())}
                flush
              />
            </div>
          </div>
        )}
      </Show>

      {/* Glob file list block */}
      <Show when={expanded() && isGlob() && getOutput(state())}>
        {(output) => {
          const lines = output().split("\n").map(l => l.trim()).filter(Boolean);
          const summary = lines.find(l => /^Found \d+/.test(l)) ?? "";
          const paths = lines.filter(l => l.startsWith("/") || l.startsWith("./") || (!l.startsWith("Found") && l.includes("/")));
          return (
            <div style={{ "border-top": "1px solid var(--border-base)" }}>
              <div
                class="px-3 py-1.5 text-xs flex justify-between items-center gap-2"
                style={{
                  background: "var(--surface-inset)",
                  color: "var(--text-weak)",
                  "border-bottom": paths.length > 0 ? "1px solid var(--border-base)" : "none",
                }}
              >
                <Show when={summary} fallback={<span />}>
                  <span class="truncate">{summary}</span>
                </Show>
                <CopyButton getText={() => paths.join("\n")} />
              </div>
              <div class="px-3 py-2 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
                <For each={paths}>
                  {(p) => (
                    <div class="flex items-center gap-1.5 text-xs font-mono">
                      <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "var(--text-weak)" }}>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span style={{ color: "var(--text-base)" }}>{p}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          );
        }}
      </Show>

      {/* Diff display for edit tools - controlled by expanded state */}
      <Show when={expanded() && hasDiff()}>
        <div
          class="px-3 py-2"
          style={{ "border-top": "1px solid var(--border-base)" }}
        >
          <ContentDiff
            diff={metadata()?.diff as string}
            lang={getLangFromPath(filePath())}
          />
        </div>
      </Show>

      {/* Expanded content for non-bash, non-read, non-glob, non-edit tools or when no diff */}
      <Show when={expanded() && canExpand() && !hasDiff() && !isBash() && !isRead() && !isGlob()}>
        <div
          class="px-3 py-2 text-sm overflow-x-auto"
          style={{
            "border-top": "1px solid var(--border-base)",
            background: "var(--background-stronger)",
          }}
        >
          <Show when={getOutput(state()) || props.part.tool === "todowrite"}>
            <div class="flex justify-end mb-2">
              <CopyButton getText={() => {
                const out = getOutput(state());
                if (out) return out;
                if (props.part.tool === "todowrite") {
                  const input = getInput(state()) as { todos?: { content: string; status: string; priority?: string }[] };
                  if (Array.isArray(input?.todos)) {
                    return input.todos.map(t => `[${t.status}] ${t.content}`).join("\n");
                  }
                }
                return "";
              }} />
            </div>
          </Show>

          {/* Input */}
          <Show when={getInput(state())}>
            {(input) => (
              <div class="mb-2">
                <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                  Input:
                </div>
                {renderToolInput(props.part.tool, input() as Record<string, unknown>)}
              </div>
            )}
          </Show>

          {/* Output */}
          <Show when={props.part.tool !== "todowrite" && getOutput(state())}>
            {(output) => (
              <div>
                <div class="text-xs mb-1" style={{ color: "var(--text-weak)" }}>
                  Output:
                </div>
                <pre
                  class="whitespace-pre-wrap text-xs max-h-64 overflow-y-auto"
                  style={{ color: "var(--text-base)" }}
                >
                  {output()}
                </pre>
              </div>
            )}
          </Show>

          {/* Error */}
          <Show when={getError(state())}>
            {(err) => (
              <div
                class="px-2 py-1 rounded text-xs"
                style={{
                  background: "var(--status-danger-dim)",
                  color: "var(--status-danger-text)",
                }}
              >
                {err()}
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Render tool parts from a message
export function MessageParts(props: { parts: Part[] }) {
  // Separate parts by type but keep order
  const filteredParts = () => props.parts.filter(p => p.type === "tool" || p.type === "reasoning");

  return (
    <Show when={filteredParts().length > 0}>
      <div class="space-y-2 mt-3">
        <For each={filteredParts()}>
          {(part) => {
            if (part.type === "reasoning") return <ReasoningPartDisplay part={part as ReasoningPart} />;
            if (part.type === "tool") return <ToolPartDisplay part={part as ToolPart} />;
            return null;
          }}
        </For>
      </div>
    </Show>
  );
}
