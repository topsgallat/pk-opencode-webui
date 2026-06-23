import {
  createSignal,
  Show,
  For,
  onMount,
  createEffect,
  createResource,
  onCleanup,
  createMemo,
  on,
  untrack,
  batch,
} from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { generateUUID } from "../utils/uuid";
import { Button } from "../components/ui/button";
import { useSDK } from "../context/sdk";
import { useEvents } from "../context/events";
import { useSync } from "../context/sync";
import { useProviders } from "../context/providers";
import { usePermission } from "../context/permission";
import { useLayout } from "../context/layout";
import { useBranding } from "../context/branding";
import { useSavedPrompts } from "../context/saved-prompts";
import { useTerminal } from "../context/terminal";
import { useConfig } from "../context/config";
import { useServer } from "../context/server";
import { getCopilotMultiplier } from "../utils/path";
import { isAnthropicProviderID } from "../../../shared/anthropic-models";
import { MessageTimeline } from "../components/message-timeline";
import { MCPDialog } from "../components/mcp-dialog";
import { MCPAddDialog } from "../components/mcp-add-dialog";
import { PickerDialog } from "../components/picker-dialog";
import { QuestionPrompt } from "../components/question-prompt";
import { PermissionPrompt } from "../components/permission-prompt";
import { SessionInfo } from "../components/session-info";
import { SessionSidebar } from "../components/session-sidebar";
import { MobileTodoTray } from "../components/mobile-todo-tray";
import { ReviewPanel } from "../components/review-panel";
import { Terminal } from "../components/terminal";
import { SessionHeader } from "../components/session-header";
import { ResizeHandle } from "../components/resize-handle";
import { base64Encode, base64Decode } from "../utils/path";
import type { Command as BackendCommand, Part, TextPart } from "../sdk/client";
import type { DisplayMessage, QueueTurnState } from "../types/message";
import { Plus, Settings, Paperclip, Upload, Bookmark, BookOpen, X as XIcon, SquareTerminal, RefreshCw, Clock } from "lucide-solid";
import { Portal } from "solid-js/web";
import { ContextItems, type FileContext } from "../components/context-items";
import { FilePickerDialog } from "../components/file-picker-dialog";
import { FileMentionDialog } from "../components/file-mention-dialog";
import { useDevice } from "../context/device";
import {
  ImageAttachments,
  type ImageAttachment,
} from "../components/image-attachments";
import { readNotifyMap, writeNotifyMap, fireBrowserNotification } from "../utils/notify";
import { readSoundSettings, playSound } from "../utils/sound";
import { sessionQuestionRequest } from "../utils/session-tree-request";
import { errorMessage, withTimeout } from "../utils/request-timeout";
import { applyQueuedPromptSubmission } from "../utils/chat-queue";
import { findOptimisticMessageEcho, mergeOptimisticMessage, projectDisplayMessages, type OptimisticQueueMessage, type SyncMessageLike } from "../utils/message-reconcile";
import { getQuota, uploadFile, deleteFile } from "../utils/extended-api";
import { isConnectionModelFailure, isRetryableModelFailure, pickFallbackCandidate, shouldFallbackAfterRetryAttempts } from "../utils/model-fallback";
import { loadFallbackSettings, resolveFallbackPolicyForAgent, resolveFallbackPolicies } from "../utils/fallback-settings";

const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const ACCEPTED_TEXT_EXTENSIONS = [
  ".txt",
  ".conf",
  ".cfg",
  ".ini",
  ".log",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".sh",
  ".bash",
  ".zsh",
  ".env",
  ".properties",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".kt",
  ".swift",
  ".php",
  ".toml",
  ".yaml",
  ".yml",
];
const ACCEPTED_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf",
];
const ACCEPTED_TEXT_MIME_TYPES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-toml",
  "application/x-shellscript",
  "application/javascript",
  "application/ecmascript",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const SESSION_STATUS_TIMEOUT_MS = 8_000;
const SERVER_SWITCH_HOME_KEY = "opencode.serverSwitchHome";
const FILE_TREE_DRAG_DATA = "application/x-opencode-file-path";
const FILE_TREE_KIND_DATA = "application/x-opencode-file-kind";
const MODEL_NOT_READY_ERROR = "Please select a model before sending messages. Click the model button in the header.";
const LOAD_FAILED_SUBSTR = "Load failed";
const CONNECTION_RETRY_LIMIT = 5;

interface LocalSlashCommand {
  id: string;
  title: string;
  description?: string;
  slash?: string;
  onSelect: () => void;
}

interface BackendSlashCommand {
  id: string;
  title: string;
  description?: string;
  slash: string;
  source?: BackendCommand["source"];
  template: string;
  hints: string[];
  subtask?: boolean;
}

type SlashCommandItem = LocalSlashCommand | BackendSlashCommand;

interface SlashCommandGroup {
  key: string;
  label: string;
  description: string;
  items: SlashCommandItem[];
}

// Per-session draft storage — module-level because SolidJS Router reuses
// the component instance when only the :id param changes.
interface SessionDraft {
  text: string;
  files: FileContext[];
  images: ImageAttachment[];
  height: string;
  drag: number;
}
const drafts = new Map<string, SessionDraft>();
const emptyMessages: DisplayMessage[] = [];

interface SessionSelection {
  agent: string;
  model: { providerID: string; modelID: string };
  variant?: string | null;
}

interface PendingPromptItem {
  id: string;
  createdAt: number;
  text: string;
  files: FileContext[];
  images: ImageAttachment[];
  agent: string;
  model?: { providerID: string; modelID: string };
  variant?: string | null;
  status?: "queued" | "running";
}

interface PendingPromptStorage {
  items: Array<{
    id: string;
    text: string;
    ts: number;
    fileContext?: FileContext[];
    imageAttachments?: ImageAttachment[];
    agent?: string;
    model?: { providerID: string; modelID: string };
    variant?: string | null;
  }>;
}

const SESSION_SELECTIONS_KEY = "opencode.sessionSelections";

// Composite key for the drafts Map so drafts are scoped to a directory+session
// pair. Uses "__new__" as sentinel when there is no session id yet.
function draftKey(serverKey: string, dir: string, id?: string) {
  return `${serverKey}:${dir}:${id ?? "__new__"}`;
}

function selectionKey(serverKey: string, dir: string) {
  return `${SESSION_SELECTIONS_KEY}.${serverKey}.${dir}`;
}

function parseDraftKey(key: string) {
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  if (first < 0 || last < 0 || last <= first) return null;
  return {
    serverKey: key.slice(0, first),
    dir: key.slice(first + 1, last),
    id: key.slice(last + 1),
  };
}

function readSelections(serverKey: string, dir: string) {
  try {
    const raw = localStorage.getItem(selectionKey(serverKey, dir));
    return raw ? (JSON.parse(raw) as Record<string, SessionSelection>) : {};
  } catch (e) {
    console.error("Failed to load session selections:", e);
    return {};
  }
}

  function writeSelections(serverKey: string, dir: string, selections: Record<string, SessionSelection>) {
    try {
      localStorage.setItem(selectionKey(serverKey, dir), JSON.stringify(selections));
    } catch (e) {
      console.error("Failed to save session selections:", e);
    }
  }

function consumeServerSwitchHome() {
  try {
    if (sessionStorage.getItem(SERVER_SWITCH_HOME_KEY) !== "1") return false;
    sessionStorage.removeItem(SERVER_SWITCH_HOME_KEY);
    return true;
  } catch {
    return false;
  }
}

type RetrySessionStatus = { type: "retry"; next?: number; message: string }

function RetryStatusBanner(props: { status: () => RetrySessionStatus | undefined }) {
  const [timeLeft, setTimeLeft] = createSignal(0)

  const calculateRemaining = () => {
    const s = props.status()
    if (s?.type === "retry" && s.next) {
      return Math.max(0, Math.round((s.next - Date.now()) / 1000))
    }
    return 0
  }

  createEffect(() => {
    const s = props.status()
    if (s?.type !== "retry" || !s.next) return

    setTimeLeft(calculateRemaining())
    const timer = setInterval(() => {
      setTimeLeft(calculateRemaining())
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={props.status()}>
      {(status) => (
        <div
          class="mx-2 mb-2 rounded-lg px-3 py-2 text-xs font-medium"
          style={{
            background: "var(--status-warning-dim)",
            color: "var(--status-warning-text)",
            border: "1px solid var(--status-warning-border)",
          }}
        >
          <div class="flex items-center gap-2">
            <RefreshCw class="w-3.5 h-3.5 animate-spin-slow" />
            <span class="text-sm font-semibold">Retrying soon</span>
            <div class="flex items-center gap-1 ml-auto text-xs px-2 py-0.5 rounded bg-black/10" style={{ color: "var(--status-warning-text)" }}>
              <Clock class="w-3 h-3" />
              <span class="font-mono">{timeLeft()}s</span>
            </div>
          </div>
          <div class="mt-1 text-[11px] leading-relaxed opacity-90">{status().message}</div>
        </div>
      )}
    </Show>
  )
}

export function Session() {
  const params = useParams<{ dir: string; id?: string }>();
  const navigate = useNavigate();
  const { client, directory, targetUrl, url: serverUrl } = useSDK();
  const events = useEvents();
  const sync = useSync();
  const providers = useProviders();
  const permission = usePermission();
  const layout = useLayout();
  const branding = useBranding();
  const savedPrompts = useSavedPrompts();
  const terminal = useTerminal();
  const appConfig = useConfig();
  const server = useServer();
  const device = useDevice();
  const serverKey = () => server.serverKey();
  const [fallbackSettings] = createResource(() => [serverUrl, serverKey()] as const, ([base, key]) => loadFallbackSettings(base, key));
  const fallbackPolicy = (agent: string) => resolveFallbackPolicyForAgent(
    fallbackSettings() ?? {},
    directory,
    agent,
    appConfig.global.fallback,
    appConfig.project.fallback,
  ).effective;

  function normalizePreviewPath(raw: string) {
    const decoded = decodeURIComponent(raw.replace(/^file:\/\//, "")).trim();
    const withoutLine = decoded.replace(/:\d+(?::\d+)?$/, "");
    const dir = directory;
    if (!dir) {
      if (withoutLine.startsWith("/")) return withoutLine;
      return withoutLine.replace(/^\.\//, "");
    }

    const base = dir.replace(/\/$/, "");
    if (withoutLine.startsWith(base + "/")) return withoutLine.slice(base.length + 1);
    if (withoutLine === base) return "";
    if (withoutLine.startsWith("/")) return withoutLine;
    return withoutLine.replace(/^\.\//, "");
  }

  function openFilePreview(path: string) {
    layout.review.open();
    layout.tabs.open(normalizePreviewPath(path));
  }

  // Unified toast system — only one toast visible at a time
  const [toastTitle, setToastTitle] = createSignal<string | null>(null);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  const [toastVariant, setToastVariant] = createSignal<"default" | "hint" | "warning" | "error" | "success">("default");
  const toastMsgTimer: { id: ReturnType<typeof setTimeout> | null } = { id: null };
  onCleanup(() => { if (toastMsgTimer.id !== null) clearTimeout(toastMsgTimer.id); });

  function hideToast() {
    if (toastMsgTimer.id !== null) clearTimeout(toastMsgTimer.id);
    toastMsgTimer.id = null;
    setToastMessage(null);
    setToastTitle(null);
  }

  function showToast(msg: string, duration = 2500, variant: any = "default", title: string | null = null) {
    if (toastMsgTimer.id !== null) clearTimeout(toastMsgTimer.id);
    setToastTitle(title);
    setToastMessage(msg);
    setToastVariant(variant);
    toastMsgTimer.id = setTimeout(() => hideToast(), duration);
  }

  // Instructions active state
  const [instructionsActive, setInstructionsActive] = createSignal(false);
  onMount(() => {
    client.config
      .get()
      .then((res) => {
        const cfg = res.data as { instructions?: string[] } | undefined;
        setInstructionsActive((cfg?.instructions ?? []).length > 0);
      })
      .catch(() => { });
  });

  // Helper to get the current directory slug
  const dirSlug = createMemo(() =>
    directory ? base64Encode(directory) : params.dir,
  );

  // Saved prompt picker items for /prompt command
  const promptPickerItems = createMemo(() =>
    savedPrompts.prompts().map((p) => ({
      id: p.id,
      title: p.title,
      description: p.text.length > 80 ? p.text.slice(0, 80) + "..." : p.text,
    })),
  );

  const [input, setInput] = createSignal("");
  const [dragHeight, setDragHeight] = createSignal(0);
  const [optimisticMessages, setOptimisticMessages] =
    createSignal<OptimisticQueueMessage[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [processing, setProcessing] = createSignal(false);
  const [loadingHistory, setLoadingHistory] = createSignal(false);
  const [sessionId, setSessionId] = createSignal(params.id);

  // Find the Nth-from-last user message (1-indexed: 1 = last, 2 = second-to-last)
  function getNthLastUserMsg(msgs: DisplayMessage[], n: number) {
    let count = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== "user") continue;
      count++;
      if (count === n) return msgs[i];
    }
    return undefined;
  }

  function countUserMessages(msgs: DisplayMessage[]) {
    return msgs.reduce((count, msg) => count + (msg.role === "user" ? 1 : 0), 0);
  }

  // Extract text content from message parts with optional separator and truncation
  function textFromParts(parts: Part[], separator = " ", maxLen?: number) {
    const text = parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join(separator);
    if (maxLen && text.length > maxLen) return text.slice(0, maxLen) + "...";
    return text;
  }

  // Viewport-aware maximum matching the CSS max-height on the textarea
  function maxInputHeight() {
    const reserve = device.isTouchDevice() ? 300 : 200;
    const floor = device.isTouchDevice() ? 160 : 200;
    return Math.max(floor, window.innerHeight - reserve);
  }

  // Clamp height to at least the drag floor but no more than viewport max
  function clampInputHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const desired = Math.max(dragHeight(), el.scrollHeight);
    el.style.height = `${Math.min(maxInputHeight(), desired)}px`;
  }

  // Set textarea value, trigger auto-grow, and focus — bypasses input handler
  // to avoid slash-command detection when restored text starts with "/"
  function applyInputAndAutogrow(el: HTMLTextAreaElement, text: string) {
    setInput(text);
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    nativeSet?.call(el, text);
    clampInputHeight(el);
    requestAnimationFrame(() => el.focus());
  }

  // Fork picker items: user messages in reverse chronological order
  const forkPickerItems = createMemo(() => {
    const id = sessionId();
    if (!id) return [];
    const msgs = sync.messages(id);
    return msgs
      .filter((m) => m.info.role === "user")
      .sort((a, b) => b.info.time.created - a.info.time.created)
      .map((m) => {
        const preview = textFromParts(m.parts, " ", 80);
        const date = new Date(m.info.time.created);
        const timestamp = date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return {
          id: m.info.id,
          title: preview || (m.parts && m.parts.length > 0 ? "(attachments)" : "(empty message)"),
          description: timestamp,
        };
      });
  });
  const [showSlashPopover, setShowSlashPopover] = createSignal(false);
  const [slashQuery, setSlashQuery] = createSignal("");
  const [slashIndex, setSlashIndex] = createSignal(0);
  const [backendSlashCommands, setBackendSlashCommands] = createSignal<BackendCommand[]>([]);
  const [backendSlashLoading, setBackendSlashLoading] = createSignal(false);
  const [backendSlashError, setBackendSlashError] = createSignal<string | null>(null);
  
  const [showAtPopover, setShowAtPopover] = createSignal(false);
  const [atQuery, setAtQuery] = createSignal("");
  const [atIndex, setAtIndex] = createSignal(0);
  const [atFiles, setAtFiles] = createSignal<string[]>([]);
  const [atLoading, setAtLoading] = createSignal(false);
  const [atAnchorPos, setAtAnchorPos] = createSignal(0);
  const [showMCPDialog, setShowMCPDialog] = createSignal(false);
  const [showMCPAddDialog, setShowMCPAddDialog] = createSignal(false);
  const [showModelPicker, setShowModelPicker] = createSignal(false);
  const [showVariantPicker, setShowVariantPicker] = createSignal(false);
  const [showAgentPicker, setShowAgentPicker] = createSignal(false);
  const [showPromptPicker, setShowPromptPicker] = createSignal(false);
  const [promptPickerFilter, setPromptPickerFilter] = createSignal("");
  const [showFilePicker, setShowFilePicker] = createSignal(false);
  const [showForkPicker, setShowForkPicker] = createSignal(false);
  const [showSavePrompt, setShowSavePrompt] = createSignal(false);
  const [showTodoTray, setShowTodoTray] = createSignal(false);
  const [savePromptTitle, setSavePromptTitle] = createSignal("");
  const [savePromptBody, setSavePromptBody] = createSignal("");
  const [sessionSelection, setSessionSelection] = createSignal<SessionSelection | null>(null);
  const [hydratingSelection, setHydratingSelection] = createSignal(false);

  function defaultSelection(): SessionSelection | null {
    const agentNames = providers.agents.map((a) => a.name);
    const configAgent = appConfig.project.default_agent || appConfig.global.default_agent;
    const agent = configAgent && agentNames.includes(configAgent) ? configAgent : "build";

    const configModel = appConfig.project.model || appConfig.global.model;
    if (configModel) {
      const slash = configModel.indexOf("/");
      if (slash > 0) {
        const providerID = configModel.slice(0, slash);
        const modelID = configModel.slice(slash + 1);
        const provider = providers.providers.find((p) => p.id === providerID);
        if (provider && providers.connected.includes(providerID) && provider.models[modelID]) {
          return { agent, model: { providerID, modelID } };
        }
      }
    }

    const fallback = providers.providers.find((p) => p.id === "opencode" && providers.connected.includes(p.id))
      ?? providers.providers.find((p) => providers.connected.includes(p.id));
    if (!fallback) return null;

    const fallbackModelID = fallback.models["big-pickle"] ? "big-pickle" : Object.keys(fallback.models)[0];
    if (!fallbackModelID) return null;

    return { agent, model: { providerID: fallback.id, modelID: fallbackModelID } };
  }

  const activeSelection = createMemo(() => sessionSelection() ?? defaultSelection());

  function currentModelVariants(model = activeSelection()?.model) {
    if (!model) return [] as Array<{ id: string; title: string; description?: string }>
    const provider = providers.rawProviders.find((p) => p.id === model.providerID)
    const variants = provider?.models[model.modelID]?.variants ?? {}
    const items = Object.entries(variants)
      .filter(([, config]) => !config.disabled)
      .map(([id]) => ({ id, title: id }))
    return items.length > 0
      ? [{ id: "__default__", title: "Default", description: "Use the model default" }, ...items]
      : items
  }

  const variantPickerItems = createMemo(() => currentModelVariants())

  function applySelection(next: SessionSelection) {
    batch(() => {
      providers.setSelectedAgent(next.agent);
      providers.setSelectedModel({
        providerID: next.model.providerID,
        modelID: next.model.modelID,
      });
      providers.setSelectedVariant(next.variant ?? null);

      const model = providers.selectedModel
      if (!model) {
        setSessionSelection(null)
        return
      }

      setSessionSelection({
        agent: providers.selectedAgent,
        model: { providerID: model.providerID, modelID: model.modelID },
        variant: providers.selectedVariant,
      })
    });
  }

  function selectAgent(agent: string) {
    providers.setSelectedAgent(agent);
    const model = providers.selectedModel;
    if (!model) return;
    setSessionSelection({
      agent,
      model: { providerID: model.providerID, modelID: model.modelID },
      variant: providers.selectedVariant,
    });
  }

  function selectModel(model: { providerID: string; modelID: string }) {
    providers.setSelectedModel(model);
    providers.setSelectedVariant(null);
    setModelPickerError(null);
    setSessionSelection({
      agent: providers.selectedAgent,
      model: { providerID: model.providerID, modelID: model.modelID },
      variant: null,
    });
    if (currentModelVariants(model).length > 0) {
      setShowVariantPicker(true);
      return;
    }

    if (retryAwaitingSelection() && failedPromptItem()) {
      void retryFailedSendWithSelection();
    }
  }

  function openModelPicker() {
    setModelPickerError(null);
    setShowModelPicker(true);
  }

  function closeModelPicker() {
    setModelPickerError(null);
    setShowModelPicker(false);
  }

  async function refreshModelPicker() {
    if (refreshingModelPicker()) return;

    setRefreshingModelPicker(true);
    setModelPickerError(null);
    try {
      try {
        await client.instance.dispose();
      } catch (e) {
        console.error("Failed to dispose client instance before model refresh:", e);
      }

      const result = await providers.refetch();
      if (!result.ok) {
        setModelPickerError(result.error ?? "Failed to refresh models.");
      }
    } finally {
      setRefreshingModelPicker(false);
    }
  }

  function selectVariant(variant: string | null) {
    providers.setSelectedVariant(variant);
    setSessionSelection((prev) => {
      const current = prev ?? activeSelection()
      if (!current) return current
      return {
        ...current,
        variant,
      }
    })

    if (retryAwaitingSelection() && failedPromptItem()) {
      void retryFailedSendWithSelection();
    }
  }

  const [fileContext, setFileContext] = createSignal<FileContext[]>([]);
  const [imageAttachments, setImageAttachments] = createSignal<
    ImageAttachment[]
  >([]);
  const draftUploadId = generateUUID();
  const [mentionPath, setMentionPath] = createSignal<string | null>(null);
  const [mentionSelection, setMentionSelection] = createSignal<{ startLine: number; endLine: number } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [retryingModel, setRetryingModel] = createSignal(false);
  const [refreshingModelPicker, setRefreshingModelPicker] = createSignal(false);
  const [modelPickerError, setModelPickerError] = createSignal<string | null>(null);
  const [failedPromptItem, setFailedPromptItem] = createSignal<PendingPromptItem | null>(null);
  const [retryAwaitingSelection, setRetryAwaitingSelection] = createSignal(false);
  const [connectionRetryCounts, setConnectionRetryCounts] = createSignal<Record<string, number>>({});
  const [historyError, setHistoryError] = createSignal<string | null>(null);
  // Use session tree walk to find pending questions from this session or any descendant.
  // This surfaces child/grandchild session questions in the parent session view.
  const pendingQuestion = createMemo(() =>
    sessionQuestionRequest(sync.sessions(), events.pendingQuestions, sessionId()) ?? null,
  );
  const [activePrompt, setActivePrompt] = createSignal<PendingPromptItem | null>(null);
  const [pendingQueue, setPendingQueue] = createSignal<PendingPromptItem[]>([]);
  const autoFallbackAttempts = new Set<string>();

  createEffect(() => {
    params.id;
    autoFallbackAttempts.clear();
  });

  function connectionRetryCount(promptID: string) {
    return connectionRetryCounts()[promptID] ?? 0
  }

  function incrementConnectionRetryCount(promptID: string) {
    setConnectionRetryCounts((prev) => ({
      ...prev,
      [promptID]: (prev[promptID] ?? 0) + 1,
    }))
  }

  function clearConnectionRetryCount(promptID: string) {
    setConnectionRetryCounts((prev) => {
      if (!(promptID in prev)) return prev
      const next = { ...prev }
      delete next[promptID]
      return next
    })
  }

  const pendingPermissions = createMemo(() => permission.pendingForSession(sessionId() ?? ""));
  const inputBlocked = createMemo(() => !!pendingQuestion() || pendingPermissions().length > 0);
  const queuePausedReason = createMemo<QueueTurnState["status"] | null>(() => {
    if (pendingQuestion()) return "paused_question";
    if (pendingPermissions().length > 0) return "paused_permission";
    return null;
  });

  // Double-Escape to abort: track last Escape press timestamp
  const lastEsc = { ts: 0 };

  // --- Notification toggle (per-session, persisted in localStorage) ---
  const [notifyEnabled, setNotifyEnabled] = createSignal(
    (() => {
      const id = params.id;
      if (!id) return false;
      return readNotifyMap()[id] === true;
    })(),
  );
  const [notifyDenied, setNotifyDenied] = createSignal(false);
  const deniedTimer = { id: null as ReturnType<typeof setTimeout> | null };
  onCleanup(() => { if (deniedTimer.id !== null) clearTimeout(deniedTimer.id) });

  function confirmNotifyEnabled(id: string) {
    fireBrowserNotification({
      title: "Notifications enabled",
      body: "You will now get browser notifications for this session.",
      tag: `session-notify-enabled-${id}`,
      requireInteraction: false,
    })

    const sound = readSoundSettings()
    if (sound.enabled) playSound(sound.sound)
  }

  // Re-read notification state when session changes
  createEffect(() => {
    const id = params.id;
    setNotifyEnabled(id ? readNotifyMap()[id] === true : false);
    setNotifyDenied(false);
  });

  function toggleNotify() {
    const id = sessionId();
    if (!id) return;

    // Turning off
    if (notifyEnabled()) {
      const map = readNotifyMap();
      delete map[id];
      writeNotifyMap(map);
      setNotifyEnabled(false);
      setNotifyDenied(false);
      return;
    }

    // Turning on — check permission
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const perm = Notification.permission;
    if (perm === "granted") {
      const map = readNotifyMap();
      map[id] = true;
      writeNotifyMap(map);
      setNotifyEnabled(true);
      confirmNotifyEnabled(id);
      return;
    }
    if (perm === "denied") {
      setNotifyDenied(true);
      if (deniedTimer.id !== null) clearTimeout(deniedTimer.id);
      deniedTimer.id = setTimeout(() => setNotifyDenied(false), 4000);
      return;
    }
    // permission === "default" — request
    Notification.requestPermission().then((result) => {
      if (result === "granted") {
        const map = readNotifyMap();
        map[id] = true;
        writeNotifyMap(map);
        setNotifyEnabled(true);
        confirmNotifyEnabled(id);
        return;
      }
      if (result === "denied") {
        setNotifyDenied(true);
        if (deniedTimer.id !== null) clearTimeout(deniedTimer.id);
        deniedTimer.id = setTimeout(() => setNotifyDenied(false), 4000);
      }
    });
  }

  // Track whether the agent was genuinely processing (not initial load)
  const wasProcessing = { value: false };

  const syncGen = { value: 0 };

  // Keep sessionId in sync with URL params and sync session data.
  // Track the composite dir+id key so the effect fires on directory changes too,
  // preventing drafts from leaking across projects when id stays undefined.
  createEffect(on(() => draftKey(server.serverKey(), params.dir, params.id), (key, prevKey) => {
    const id = params.id;
    // DEBUG: URL param changed - removed console.log for production

    // Save draft from the previous session before switching.
    // Read signals via untrack() so they aren't tracked dependencies.
    if (prevKey && prevKey !== key) {
      const prevId = untrack(sessionId);
      const prev = parseDraftKey(prevKey);
      const prevDir = prev?.dir;
      if (prevId && prevDir) {
        const selections = readSelections(prev?.serverKey ?? server.serverKey(), prevDir);
        const model = untrack(() => providers.selectedModel);
        const variant = untrack(() => providers.selectedVariant);
        if (model) {
          selections[prevId] = {
            agent: untrack(() => providers.selectedAgent),
            model: { providerID: model.providerID, modelID: model.modelID },
            variant,
          };
          writeSelections(prev?.serverKey ?? server.serverKey(), prevDir, selections);
        }
      }

      const text = untrack(input);
      const files = untrack(fileContext);
      const images = untrack(imageAttachments);
      const meaningful =
        text.trim().length > 0 ||
        (files && files.length > 0) ||
        (images && images.length > 0);

      if (meaningful) {
        drafts.set(prevKey, { text, files, images, height: inputRef?.style.height ?? "", drag: untrack(dragHeight) });
      } else {
        drafts.delete(prevKey);
      }
    }

    setSessionSelection(null);
    setSessionId(id);
    setActivePrompt(null);
    setPendingQueue([]);

    // Restore draft for the new session (or clear if none saved)
    const saved = drafts.get(key);
    setInput(saved?.text ?? "");
    setFileContext(saved?.files ?? []);
    setImageAttachments(saved?.images ?? []);
    setDragHeight(saved?.drag ?? 0);
    if (inputRef) inputRef.style.height = saved?.height ?? "";
    setShowSlashPopover(false);
    setSlashQuery("");
    setSlashIndex(0);
    setPromptSent(false); // Reset so pending prompts fire in the new session
    wasProcessing.value = false; // Reset to avoid false notifications
    if (id) {
      setLoadingHistory(true);
      setHistoryError(null);
      setProcessing(false);
      const gen = ++syncGen.value;
      sync.session.sync(id).then(() => {
        if (syncGen.value !== gen) return;
        setHistoryError(null);
        setLoadingHistory(false);
      }).catch((err) => {
        if (syncGen.value !== gen) return;
        setHistoryError(errorMessage(err, "Loading chat history failed"));
        setLoadingHistory(false);
      });

      // Check if this session is actually busy
      void refreshProcessingState(id);
    } else {
      setLoadingHistory(false);
      setHistoryError(null);
      setProcessing(false);
    }
  }));

  createEffect(on(
    () => draftKey(server.serverKey(), params.dir, sessionId()),
    () => {
      const id = sessionId();
      const dir = params.dir;
      if (!id || typeof dir !== "string" || !dir) return;

      setHydratingSelection(true);
      const selections = readSelections(server.serverKey(), dir);
      const saved = selections[id];
      const next = saved ?? defaultSelection();
      if (next) {
        applySelection(next);
        setHydratingSelection(false);
        return;
      }
      setHydratingSelection(false);
    },
  ));

  createEffect(() => {
    if (hydratingSelection()) return;
    const selection = sessionSelection();
    if (!selection) return;

    const id = sessionId();
    const dir = params.dir;
    const serverKey = server.serverKey();
    if (!id || !dir || !serverKey) return;

    const selections = readSelections(serverKey, dir);
    selections[id] = {
      agent: selection.agent,
      model: { providerID: selection.model.providerID, modelID: selection.model.modelID },
      variant: selection.variant ?? null,
    };
    writeSelections(serverKey, dir, selections);
  });

  // Auto-send saved prompt stored in sessionStorage by layout's createSessionWithPrompt.
  // We read from sessionStorage instead of URL params to avoid browser URL length limits.
  // Guard: the effect may re-run when reactive deps (e.g. providers.connected) update
  // after the prompt has already been sent. A local signal prevents double sends.
  const [promptSent, setPromptSent] = createSignal(false);
  createEffect(() => {
    if (promptSent()) return;
    const id = params.id;
    if (!id) return;
    const key = `opencode.pendingPrompt.${id}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const EXPIRY_MS = 60_000; // 60 seconds
    const parsed = (() => {
      try { return JSON.parse(raw) as PendingPromptStorage | { text: string; ts: number; variant?: string | null }; }
      catch { return null; }
    })();
    const queued = Array.isArray((parsed as PendingPromptStorage | null)?.items)
      ? (parsed as PendingPromptStorage).items
      : parsed && "text" in parsed && typeof parsed.text === "string" && typeof parsed.ts === "number"
        ? [{ id: generateUUID(), text: parsed.text, ts: parsed.ts, variant: typeof parsed.variant === "string" ? parsed.variant : null }]
        : [];
    const valid = queued.filter((item) => item.text && Date.now() - item.ts <= EXPIRY_MS);
    if (valid.length === 0) {
      sessionStorage.removeItem(key);
      return;
    }
    // Provider data may not be available yet — the resource fetch is async and
    // selectedModel is populated from localStorage in an onMount callback that
    // runs after createEffect. Skip without removing the sessionStorage item so
    // the effect re-runs once providers finish loading.
    if (providers.loading || providers.providers.length === 0) return;
    if (!providers.selectedModel) {
      sessionStorage.removeItem(key);
      setError(MODEL_NOT_READY_ERROR);
      return;
    }
    if (!providers.connected.includes(providers.selectedModel.providerID)) {
      sessionStorage.removeItem(key);
      setError(`Provider "${providers.selectedModel.providerID}" is not connected. Please configure it in Settings.`);
      return;
    }
    // All validation passed — mark as sent, clear storage, and enqueue
    setPromptSent(true);
    sessionStorage.removeItem(key);
    setError(null);
    for (const item of valid) {
      enqueuePrompt({
        id: item.id,
        createdAt: item.ts,
        text: item.text,
        files: item.fileContext ?? [],
        images: item.imageAttachments ?? [],
        agent: item.agent ? item.agent : (providers.selectedAgent || "build"),
        model: item.model ?? providers.selectedModel,
        variant: item.variant ?? providers.selectedVariant ?? undefined,
        status: "queued",
      });
    }
  });

  // Get messages from sync context - reactive, automatically updated via SSE
  // Cache the base messages array to avoid recreating on every call
  let projectedMessages = emptyMessages;
  const syncMessages = createMemo(() => {
    const id = sessionId();
    if (!id) {
      projectedMessages = emptyMessages;
      return projectedMessages;
    }
    projectedMessages = projectDisplayMessages(projectedMessages, sync.messages(id) as SyncMessageLike[]);
    return projectedMessages;
  });

  function previewPromptParts(item: PendingPromptItem) {
    const sid = sessionId() || "";
    const textParts = item.text
      ? [{
          id: `${item.id}-text`,
          sessionID: sid,
          messageID: "",
          type: "text" as const,
          text: item.text,
        }]
      : [];

    const fileCommentParts = item.files.flatMap((file, index) => {
      if (!file.selection && !file.comment) return [];
      const selection = file.selection ? `\nLines: ${file.selection.startLine}-${file.selection.endLine}` : "";
      const note = file.comment ? `\nNote: ${file.comment}` : "";
      const body = file.preview ? `\n\n${file.preview}` : "";
      return [{
        id: `${item.id}-file-text-${index}`,
        sessionID: sid,
        messageID: "",
        type: "text" as const,
        text: `File: ${file.path}${selection}${note}${body}`,
      }];
    });

    const fileParts = item.files.map((file, index) => {
      const dir = directory || "";
      const absolute = file.path.startsWith("/")
        ? file.path
        : `${dir.replace(/\/$/, "")}/${file.path.replace(/^\//, "")}`;
      const filename = file.path.split("/").pop() || file.path;
      const encoded = absolute
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      return {
        id: `${item.id}-file-${index}`,
        sessionID: sid,
        messageID: "",
        type: "file" as const,
        mime: "text/plain",
        url: `file://${encoded}`,
        filename,
      };
    });

    const imageParts = item.images.map((image, index) => {
      const encoded = image.serverPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      return {
        id: `${item.id}-image-${index}`,
        sessionID: sid,
        messageID: "",
        type: "file" as const,
        mime: image.mime,
        url: `file://${encoded}`,
        filename: image.name,
      };
    });

    const parts = [...textParts, ...fileCommentParts, ...fileParts, ...imageParts];
    if (parts.length > 0) return parts as Part[];

    return [{
      id: `${item.id}-text`,
      sessionID: sid,
      messageID: "",
      type: "text" as const,
      text: "",
    }] as Part[];
  }

  createEffect(on(activePrompt, (item) => {
    if (!item) {
      setOptimisticMessages([]);
      return;
    }

    const userCount = countUserMessages(syncMessages());
    setOptimisticMessages([{
      id: item.id,
      expectedUserMessageIndex: userCount + 1,
      message: {
        id: item.id,
        role: "user",
        parts: previewPromptParts(item),
        time: { created: item.createdAt },
      },
    }]);
  }));

  // Includes optimistic message if present and not yet in sync
  let mergedMessages = emptyMessages;
  const messages = createMemo(() => {
    const syncMsgs = syncMessages();
    if (syncMsgs.length === 0 && optimisticMessages().length === 0) {
      mergedMessages = syncMsgs;
      return mergedMessages;
    }
    mergedMessages = mergeOptimisticMessage(mergedMessages, syncMsgs, optimisticMessages());
    return mergedMessages;
  });
  const queuedTurns = createMemo(() =>
    pendingQueue()
      .filter((item) => item.id !== activePrompt()?.id)
      .map((item) => ({
        id: item.id,
        userMessage: {
          id: item.id,
          role: "user" as const,
          parts: previewPromptParts(item),
          time: { created: item.createdAt },
        },
        assistantMessages: [],
        queueState: { status: "queued", canDelete: true } satisfies QueueTurnState,
      }))
  );
  const activeTurnId = createMemo(() => {
    const active = activePrompt();
    const optimistic = optimisticMessages()[0];
    if (!active || !optimistic) return undefined;
    return findOptimisticMessageEcho(messages(), optimistic)?.id ?? active.id;
  });
  const activeTurnState = createMemo<QueueTurnState | undefined>(() => {
    if (!activePrompt()) return undefined;
    const paused = queuePausedReason();
    if (paused) return { status: paused };
    return { status: "thinking" };
  });
  const sessionStatus = createMemo(() => {
    const id = sessionId();
    if (!id) return undefined;
    return events.status[id];
  });
  const retrySessionStatus = createMemo<RetrySessionStatus | undefined>(() => {
    const status = sessionStatus();
    if (!status || status.type !== "retry") return undefined;
    return {
      type: "retry",
      next: status.next,
      message: status.message,
    };
  });
  const sessionPausedReason = createMemo<"paused_question" | "paused_permission" | null>(() => {
    const reason = queuePausedReason();
    if (reason === "paused_question" || reason === "paused_permission") return reason;
    return null;
  });
  let inputRef: HTMLTextAreaElement | undefined;
  let slashPopoverRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  // Get session from sync context - reactive, automatically updated via SSE
  const session = createMemo(() => {
    const id = params.id;
    if (!id) return null;
    return sync.session.get(id) ?? null;
  });

  createEffect(on(
    () => `${server.serverKey()}:${params.dir}:${directory ?? ""}`,
    () => {
      const dir = directory || base64Decode(params.dir);
      if (!dir) return;

      setBackendSlashLoading(true);
      setBackendSlashError(null);

      client.command
        .list({ directory: dir })
        .then((res) => {
          setBackendSlashCommands(res.data ?? []);
          setBackendSlashError(null);
        })
        .catch((err) => {
          setBackendSlashError(errorMessage(err, "Loading commands failed"));
          setBackendSlashCommands([]);
        })
        .finally(() => {
          setBackendSlashLoading(false);
        });
    },
  ));

  // Slash commands — computed so state-dependent commands update reactively
  function normalizeSlashName(name: string) {
    return name.replace(/^\/+/, "").trim();
  }

  function backendSlashName(command: BackendCommand) {
    return normalizeSlashName(command.name);
  }

  const backendSlashCommandItems = createMemo<BackendSlashCommand[]>(() =>
    backendSlashCommands().map((command) => ({
      id: `backend:${command.name}`,
      title: command.name,
      description: command.description,
      slash: backendSlashName(command),
      source: command.source,
      template: command.template,
      hints: command.hints,
      subtask: command.subtask,
    })),
  );

  const localSlashCommands = createMemo<LocalSlashCommand[]>(() => {
    const id = sessionId();
    const sess = session();
    const msgs = syncMessages();
    const hasMessages = msgs.length > 0;
    const isProcessing = processing();
    const lastUserMsg = getNthLastUserMsg(msgs, 1);

    const commands: LocalSlashCommand[] = [
      {
        id: "session.new",
        title: "New Session",
        description: "Create a new chat session",
        slash: "new",
        onSelect: async () => {
          // Command: New session (debug logs removed)
          try {
            const res = await client.session.create({});
            if (!res.data || !res.data.id) throw new Error("Failed to create session");
            const newId = res.data.id;
            navigate(`/${dirSlug()}/session/${newId}`);
          } catch (err) {
            showToast(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      {
        id: "settings.open",
        title: "Settings",
        description: "Open settings page",
        slash: "settings",
        onSelect: () => {
           // Command: Settings opened
          navigate(`/${dirSlug()}/settings`);
        },
      },
      {
        id: "provider.connect",
        title: "Connect Provider",
        description: "Add an AI provider",
        slash: "connect",
        onSelect: () => {
          // Command: Connect provider selected
          navigate(`/${dirSlug()}/settings`);
        },
      },
      {
        id: "model.choose",
        title: "Choose Model",
        description: "Select the AI model to use",
        slash: "model",
        onSelect: () => {
          openModelPicker();
        },
      },
      {
        id: "agent.choose",
        title: "Choose Agent",
        description: "Select the agent to use",
        slash: "agent",
        onSelect: () => {
          setShowAgentPicker(true);
        },
      },
      {
        id: "mcp.manage",
        title: "MCP Servers",
        description: "Manage MCP server connections",
        slash: "mcp",
        onSelect: () => {
          // Command: MCP dialog opened
          setShowMCPDialog(true);
        },
      },
      {
        id: "prompt.pick",
        title: "Insert Saved Prompt",
        description: "Insert a saved prompt into the input",
        slash: "prompt",
        onSelect: () => {
          setPromptPickerFilter("");
          setShowPromptPicker(true);
        },
      },
      {
        id: "terminal.toggle",
        title: "Toggle Terminal",
        description: "Open or close the terminal panel",
        slash: "terminal",
        onSelect: () => {
          terminal.toggle(directory);
        },
      },
      {
        id: "session.fork",
        title: "Fork Session",
        description: "Branch from a previous message",
        slash: "fork",
        onSelect: () => {
          if (!sessionId() || forkPickerItems().length === 0) return;
          setShowForkPicker(true);
        },
      },
    ];

    // /compact — requires a session with messages and a selected model
    if (id && hasMessages && !isProcessing && providers.selectedModel) {
      commands.push({
        id: "session.compact",
        title: "Compact Session",
        description: "Summarize conversation to free up context space",
        slash: "compact",
        onSelect: async () => {
          if (!id) return;
          const model = providers.selectedModel;
          if (!model) {
            showToast("Select a model before compacting");
            return;
          }
          showToast("Compacting session...", 10000);
          try {
            await client.session.summarize({
              sessionID: id,
              providerID: model.providerID,
              modelID: model.modelID,
            });
            showToast("Session compacted");
          } catch (err) {
            showToast(`Failed to compact session: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
    }

    // /share — requires an active session, not already shared, and sharing not disabled.
    // Project config overrides global for conflicting keys (merge semantics).
    // Default to disabled while config is loading or errored to avoid showing commands prematurely.
    const effectiveShare = appConfig.project.share ?? appConfig.global.share
    const shareDisabled = appConfig.loading() || !!appConfig.error() || effectiveShare === "disabled"
    if (id && !sess?.share?.url && !shareDisabled) {
      commands.push({
        id: "session.share",
        title: "Share Session",
        description: "Generate a shareable link and copy to clipboard",
        slash: "share",
        onSelect: async () => {
          if (!id) return;
          try {
            const res = await client.session.share({ sessionID: id });
            const url = res.data?.share?.url;
            if (!url) {
              showToast("Failed to share session: no URL returned");
              return;
            }
            try {
              await navigator.clipboard.writeText(url);
              showToast("Share link copied to clipboard");
            } catch {
              showToast(`Share link: ${url}`, 8000);
            }
            refetchSession();
          } catch (err) {
            showToast(`Failed to share session: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
    }

    // /share — already shared: copy existing link
    if (id && sess?.share?.url && !shareDisabled) {
      commands.push({
        id: "session.share",
        title: "Copy Share Link",
        description: "Copy the existing share link to clipboard",
        slash: "share",
        onSelect: async () => {
          const url = sess!.share!.url;
          try {
            await navigator.clipboard.writeText(url);
            showToast("Share link copied to clipboard");
          } catch {
            showToast(`Share link: ${url}`, 8000);
          }
        },
      });
    }

    // /unshare — only when session is already shared
    if (id && sess?.share?.url && !shareDisabled) {
      commands.push({
        id: "session.unshare",
        title: "Unshare Session",
        description: "Remove the shared link and make session private",
        slash: "unshare",
        onSelect: async () => {
          if (!id) return;
          try {
            await client.session.unshare({ sessionID: id });
            showToast("Session unshared");
            refetchSession();
          } catch (err) {
            showToast(`Failed to unshare session: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
    }

    // /undo — requires a session with at least one user message
    // Allowed during processing so abort-then-revert flow works
    // Supports `/undo` (last turn) and `/undo N` (Nth-from-last turn)
    if (id && lastUserMsg) {
      commands.push({
        id: "session.undo",
        title: "Undo Message",
        description: "Revert the last user message (use /undo N for multiple turns)",
        slash: "undo",
        onSelect: async () => {
          await undoTurns(1);
        },
      });
    }

    // /redo — only when session is in a reverted state
    if (id && sess?.revert?.messageID) {
      commands.push({
        id: "session.redo",
        title: "Redo Message",
        description: "Restore previously reverted messages",
        slash: "redo",
        onSelect: async () => {
          if (!id) return;
          try {
            await client.session.unrevert({ sessionID: id });
            setInput("");
            showToast("Messages restored");
            refetchSession();
          } catch (err) {
            showToast(`Failed to redo messages: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
    }

    return commands;
  });

  const slashCommands = createMemo<SlashCommandItem[]>(() => {
    const backend = backendSlashCommandItems();
    const backendNames = new Set(backend.map((command) => command.slash));
    const local = localSlashCommands().filter((command) => !command.slash || !backendNames.has(command.slash));
    return [...backend, ...local];
  });

  // Undo N user turns — finds the Nth-from-last user message and reverts to it.
  // The backend accepts any messageID, so reverting to an earlier message
  // implicitly removes everything after it.
  async function undoTurns(count: number) {
    const id = sessionId();
    if (!id) {
      showToast("No active session to undo");
      return;
    }
    const msgs = syncMessages();
    const target = getNthLastUserMsg(msgs, count);
    if (!target) {
      const total = msgs.filter((m) => m.role === "user").length;
      showToast(count === 1 ? "No user message to undo" : `Only ${total} user message${total === 1 ? "" : "s"} to undo`);
      return;
    }
    try {
      // If processing, abort first (clears pendingQuestion too)
      if (processing()) {
        await handleAbort();
      }
      await client.session.revert({
        sessionID: id,
        messageID: target.id,
      });
      // Restore the reverted message text into the input field
      const textPart = target.parts.find((p) => p.type === "text") as
        | { type: "text"; text?: string }
        | undefined;
      if (textPart?.text && inputRef) {
        applyInputAndAutogrow(inputRef, textPart.text);
      }
      showToast(count === 1 ? "Undone 1 turn" : `Undone ${count} turns`);
      refetchSession();
    } catch (err) {
      showToast(`Failed to undo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function retryTurn(messageId: string) {
    const id = sessionId();
    if (!id) return;
    try {
      if (processing()) {
        await handleAbort();
      }
      await client.session.revert({
        sessionID: id,
        messageID: messageId,
      });
      const msgs = syncMessages();
      const target = msgs.find((m) => m.id === messageId);
      if (target) {
        const textPart = target.parts.find((p) => p.type === "text") as
          | { type: "text"; text?: string }
          | undefined;
        if (textPart?.text && inputRef) {
          applyInputAndAutogrow(inputRef, textPart.text);
        }
      }
      showToast("Retrying message...");
      refetchSession();
    } catch (err) {
      showToast(`Failed to retry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function slashGroupFor(command: SlashCommandItem) {
    if (!isBackendSlashCommand(command)) {
      return {
        key: "local",
        label: "App actions",
        description: "OpenCode UI actions",
      };
    }

    if (command.source === "skill") {
      return {
        key: "backend-skill",
        label: "Skills",
        description: "Installed skill commands",
      };
    }

    if (command.source === "mcp") {
      return {
        key: "backend-mcp",
        label: "MCP",
        description: "MCP-provided commands",
      };
    }

    return {
      key: "backend-command",
      label: "Commands",
      description: "OpenCode commands",
    };
  }

  function isBackendSlashCommand(command: SlashCommandItem): command is BackendSlashCommand {
    return command.id.startsWith("backend:");
  }

  const groupedSlashCommands = createMemo<SlashCommandGroup[]>(() => {
    const q = slashQuery().toLowerCase();
    const groups = new Map<string, SlashCommandGroup>();

    for (const cmd of slashCommands()) {
      if (q && !(
        cmd.slash?.toLowerCase().startsWith(q) ||
        cmd.title.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q)
      )) continue;

      const group = slashGroupFor(cmd);
      const next = groups.get(group.key) ?? { ...group, items: [] };
      next.items.push(cmd);
      groups.set(group.key, next);
    }

    return [
      groups.get("backend-skill"),
      groups.get("backend-mcp"),
      groups.get("backend-command"),
      groups.get("local"),
    ].filter(Boolean) as SlashCommandGroup[];
  });

  const flatSlashCommands = createMemo(() => groupedSlashCommands().flatMap((group) => group.items));
  const flatSlashCommandIndex = createMemo(() => {
    const map = new Map<string, number>();
    flatSlashCommands().forEach((command, idx) => map.set(command.id, idx));
    return map;
  });

  // Close slash popover on click outside
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (inputRef?.contains(target)) return;
    if (slashPopoverRef && !slashPopoverRef.contains(target)) {
      setShowSlashPopover(false);
    }
    if (showAtPopover()) setShowAtPopover(false);
  }

  // Handle slash command selection
  function applyBackendSlashCommand(cmd: BackendSlashCommand) {
    const current = input();
    const first = current.match(/^\/\S*/)?.[0] ?? "";
    const rest = current.slice(first.length).trimStart();
    const next = rest ? `/${cmd.slash} ${rest}` : `/${cmd.slash} `;

    setInput(next);
    if (inputRef) {
      inputRef.value = next;
      inputRef.selectionStart = inputRef.selectionEnd = next.length;
      clampInputHeight(inputRef);
      requestAnimationFrame(() => inputRef?.focus());
    }
    setShowSlashPopover(false);
    setSlashQuery("");
    setSlashIndex(0);
  }

  function selectSlashCommand(cmd: SlashCommandItem) {
    if (cmd.id.startsWith("backend:")) {
      applyBackendSlashCommand(cmd as BackendSlashCommand);
      return;
    }

    setInput("");
    setShowSlashPopover(false);
    setSlashQuery("");

    // Use setTimeout to ensure state updates before command runs
    setTimeout(() => {
      (cmd as LocalSlashCommand).onSelect();
    }, 0);
  }

  function selectAtFile(path: string) {
    if (!path) return;
    addFileToContext(path);
    const current = input();
    const before = current.slice(0, atAnchorPos());
    const after = current.slice(atAnchorPos() + 1 + atQuery().length);
    setInput(before + after);
    if (inputRef) {
      inputRef.value = before + after;
      clampInputHeight(inputRef);
      inputRef.selectionStart = inputRef.selectionEnd = before.length;
      inputRef.focus();
    }
    setShowAtPopover(false);
    setAtQuery("");
  }

  // Handle input changes to detect slash commands
  function handleInputChange(value: string) {
    setInput(value);

    // Detect `/prompt <search>` — auto-open prompt picker with filter
    const promptMatch = value.match(/^\/prompt\s+(.*)$/i);
    if (promptMatch) {
      setInput("");
      setShowSlashPopover(false);
      setSlashQuery("");
      setPromptPickerFilter(promptMatch[1].trim());
      setShowPromptPicker(true);
      return;
    }

    // Detect slash command pattern: /command (no spaces — popover only for partial commands)
    const slashMatch = value.match(/^\/(\S*)$/);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      setShowSlashPopover(true);
      setSlashIndex(0);
    } else {
      setShowSlashPopover(false);
      setSlashQuery("");
    }

    const atMatch = value.match(/@(\S*)$/);
    if (atMatch) {
      const pos = value.lastIndexOf("@");
      setAtAnchorPos(pos);
      setAtQuery(atMatch[1]);
      setAtIndex(0);
      setShowAtPopover(true);
      searchAtFiles(atMatch[1]);
    } else {
      setShowAtPopover(false);
      setAtQuery("");
    }
  }

  // Handle keyboard navigation in slash popover
  function handleInputKeyDown(e: KeyboardEvent) {
    if (!showSlashPopover()) return;

    const cmds = flatSlashCommands();
    if (cmds.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSlashIndex((i) => (i + 1) % cmds.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSlashIndex((i) => (i - 1 + cmds.length) % cmds.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const cmd = cmds[slashIndex()];
      if (cmd) {
        selectSlashCommand(cmd);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSlashPopover(false);
      setSlashQuery("");
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("click", handleClickOutside);
  });

  // Reset escape state when processing stops (prevents stale timestamps across processing windows)
  createEffect(() => {
    if (!processing()) {
      lastEsc.ts = 0;
    }
  });

  createEffect(on(
    () => ({
      processing: processing(),
      blocked: inputBlocked(),
      active: !!activePrompt(),
      queueLength: pendingQueue().length,
      loading: loading(),
      session: sessionId(),
    }),
    (state, prev) => {
      if (state.processing || state.blocked || state.loading || state.active || state.queueLength === 0) return;
      if (!prev) {
        void flushQueuedPrompt();
        return;
      }
      const sameSession = prev.session === state.session;
      if (
        sameSession &&
        !prev.processing &&
        !prev.active &&
        prev.queueLength === state.queueLength &&
        prev.loading === state.loading
      ) return;
      void flushQueuedPrompt();
    },
  ));

  createEffect(() => {
    if (!sessionId()) {
      setShowTodoTray(false);
      return;
    }

    if (processing()) {
      setShowTodoTray(false);
    }
  });

  createEffect(() => {
    if (
      showAtPopover() ||
      showSlashPopover() ||
      showMCPDialog() ||
      showMCPAddDialog() ||
      showModelPicker() ||
      showAgentPicker() ||
      showPromptPicker() ||
      showFilePicker() ||
      showForkPicker() ||
      showSavePrompt()
    ) {
      setShowTodoTray(false)
    }
  });

  // Global keydown listener for double-Escape to abort
  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (e.repeat) return; // Ignore held-key auto-repeat
    if (e.defaultPrevented) return; // Already handled by another component
    // Let dialogs/popovers handle their own Escape
    if (
      showAtPopover() ||
      showSlashPopover() ||
      showMCPDialog() ||
      showMCPAddDialog() ||
      showModelPicker() ||
      showAgentPicker() ||
      showPromptPicker() ||
      showFilePicker() ||
      showForkPicker() ||
      showSavePrompt() ||
      showTodoTray()
    ) return;
    if (!processing()) return;

    const now = Date.now();
    if (now - lastEsc.ts < 500) {
      e.preventDefault();
      lastEsc.ts = 0;
      hideToast();
      handleAbort();
      return;
    }
    lastEsc.ts = now;
    showToast("Press Esc again to stop", 1500, "hint");
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleGlobalKeyDown);
  });

  // Refetch is now just re-syncing
  const refetchSession = async () => {
    const id = params.id;
    if (!id) return;
    try {
      await sync.session.sync(id);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(errorMessage(err, "Loading chat history failed"));
    }
  };

  async function refreshProcessingState(sessionID: string) {
    const wasBusy = processing();

    try {
      const res = await withTimeout(
        () => client.session.status({}),
        SESSION_STATUS_TIMEOUT_MS,
        "Loading session status",
      );
      const statuses = res.data;
      const status = statuses?.[sessionID];
      const isBusy = !error() && (status?.type === "busy" || status?.type === "retry");

      if (isBusy) {
        wasProcessing.value = true;
        setProcessing(true);
        return;
      }

      if (wasBusy) {
        batch(() => {
          setActivePrompt(null);
          wasProcessing.value = false;
          setProcessing(false);
        });
        void sync.session.sync(sessionID).catch(() => {});
        return;
      }

      setProcessing(false);
    } catch {
      if (!wasBusy) return;
    }
  }

  createEffect(() => {
    const id = sessionId();
    if (!id || !processing()) return;

    void refreshProcessingState(id);
    const interval = setInterval(() => {
      void refreshProcessingState(id);
    }, 15_000);

    onCleanup(() => clearInterval(interval));
  });

  // Clear stale localStorage key when sessions are loaded and ID is not found
  createEffect(() => {
    const id = params.id;
    if (!id) return;
    if (consumeServerSwitchHome()) {
      navigate("/", { replace: true });
      return;
    }
    // loadingHistory() stays true when sync.session.sync() rejects,
    // so this effect only fires after a successful sync — not on transient failures.
    if (loadingHistory() || historyError()) return;
    const found = sync.session.get(id);
    // Non-archived session exists — keep it
    if (found && !found.time?.archived) return;
    // For archived sessions: only treat as stale when it matches the stored last-session
    // (allows direct navigation to archived sessions from the sidebar)
    if (found?.time?.archived) {
      try {
        const dir = directory || base64Decode(params.dir);
        if (dir && typeof window !== "undefined") {
          const key = `opencode.lastSession.${server.serverKey()}.${dir}`;
          const stored = window.localStorage.getItem(key);
          if (stored === id) {
            window.localStorage.removeItem(key);
            navigate(`/${dirSlug()}/session`, { replace: true });
          }
        }
      } catch (err) {
        console.error("[Session] localStorage error:", err);
      }
      return;
    }
    // Session not found at all: clear and redirect
    try {
      const dir = directory || base64Decode(params.dir);
      if (dir && typeof window !== "undefined") {
        const key = `opencode.lastSession.${server.serverKey()}.${dir}`;
        const stored = window.localStorage.getItem(key);
        if (stored === id) window.localStorage.removeItem(key);
      }
    } catch (err) {
      console.error("[Session] localStorage error:", err);
    }
    navigate(`/${dirSlug()}/session`, { replace: true });
  });

  // Persist lastSession only after the session is confirmed to exist in sync
  createEffect(() => {
    const id = params.id;
    if (!id) return;
    if (loadingHistory()) return;
    const found = sync.session.get(id);
    if (!found || found.time?.archived) return;
    try {
      const dir = directory || base64Decode(params.dir);
      if (dir && typeof window !== "undefined") {
        window.localStorage.setItem(`opencode.lastSession.${server.serverKey()}.${dir}`, id);
      }
    } catch (err) {
      console.error("[Session] Failed to persist last session:", err);
    }
  });

  // Start processing state - SSE events will handle updates and completion
  function startProcessing() {
    wasProcessing.value = true;
    setProcessing(true);
  }

  // Subscribe to events for status changes and session updates
  // Note: Message updates are handled by sync context, no need to manage here
  onMount(() => {
    const unsub = events.subscribe(
      (event: { type: string; properties: Record<string, unknown> }) => {
        const id = sessionId();
        if (!id) return;

        // Handle status changes
        if (event.type === "session.status") {
          const props = event.properties as {
            sessionID: string;
            status: { type: string };
          };
          if (props.sessionID === id && props.status.type === "idle") {
            setActivePrompt(null);
            setConnectionRetryCounts({});

            // Reset local processing tracker (notifications now handled globally in Layout)
            wasProcessing.value = false;
            setProcessing(false);
          } else if (props.sessionID === id && !error()) {
            wasProcessing.value = true;
            setProcessing(true);
          }
        }

        if (event.type === "session.error") {
          const props = event.properties as {
            sessionID?: string;
            error?: unknown;
          };

          if (props.sessionID !== id) return;

          const prompt = activePrompt() ?? failedPromptItem();
          if (prompt) {
            void (async () => {
              const connectionFailure = isConnectionModelFailure(props.error)
              const retryCount = connectionFailure ? connectionRetryCount(prompt.id) + 1 : 0
              if (connectionFailure) incrementConnectionRetryCount(prompt.id)

              const fallbackReady = connectionFailure
                ? shouldFallbackAfterRetryAttempts(props.error, retryCount, CONNECTION_RETRY_LIMIT)
                : isRetryableModelFailure(props.error)

              if (fallbackReady) {
                const fallback = await maybeAutoFallback(prompt, props.error)
                if (fallback.attempted) {
                  clearConnectionRetryCount(prompt.id)
                  void sync.session.sync(id).catch(() => {})
                  return
                }
              }

              batch(() => {
                setError(errorMessage(props.error, "The selected model hit a limit. Please choose another model or try again later."))
                setActivePrompt(null)
                wasProcessing.value = false
                setProcessing(false)
                if (isRetryableModelFailure(props.error) || connectionFailure) setFailedPromptItem(prompt)
              })

              void sync.session.sync(id).catch(() => {})
            })()
            return
          }

          batch(() => {
            setError(errorMessage(props.error, "The selected model hit a limit. Please choose another model or try again later."));
            setActivePrompt(null);
            wasProcessing.value = false;
            setProcessing(false);
          });

          void sync.session.sync(id).catch(() => {});
          return;
        }

        // Handle global TUI events
        if (event.type === "tui.toast.show") {
          const props = event.properties as {
            title?: string;
            message: string;
            variant: "info" | "success" | "warning" | "error";
            duration?: number;
          };
          // Increase default duration for non-info toasts to 8s
          const duration = props.duration ?? (props.variant === "info" ? 4000 : 8000);
          showToast(props.message, duration, props.variant, props.title ?? null);
        }

        if (event.type === "tui.session.select") {
          const props = event.properties as { sessionID: string };
          if (props.sessionID !== sessionId()) {
            navigate(`/${dirSlug()}/session/${props.sessionID}`);
          }
        }

        // Handle session updates
        if (event.type === "session.updated") {
          refetchSession();
        }
      },
    );

    return unsub;
  });

  // Question tracking is now handled via the global events.pendingQuestions store
  // (seeded via HTTP and updated via SSE in EventProvider) combined with the
  // sessionQuestionRequest tree-walk memo defined above. This surfaces questions
  // from child/grandchild sessions automatically without per-session SSE subscriptions.

  async function handleQuestionReply(answers: string[][]) {
    const q = pendingQuestion();
    if (!q) return;

    try {
      await client.question.reply({ requestID: q.id, answers, directory });
    } catch (e) {
      console.error("[Session] Failed to reply to question:", e);
    }
  }

  async function handleQuestionReject() {
    const q = pendingQuestion();
    if (!q) return;

    try {
      await client.question.reject({ requestID: q.id, directory });
    } catch (e) {
      console.error("[Session] Failed to reject question:", e);
    }
  }

  async function handleAbort() {
    const id = sessionId();
    if (!id) return;

    try {
      await client.session.abort({ sessionID: id, directory });
    } catch (e) {
      console.error("[Session] Failed to abort session:", e);
    }
  }

  const primaryAgents = () => providers.agents.filter((a) => a.mode === "primary")

  // Focus input on mount
  onMount(() => {
    if (("ontouchstart" in window)) return;
    inputRef?.focus();
  });

  function addFileToContext(path: string, comment?: string, selection?: { startLine: number; endLine: number }, preview?: string) {
    if (!comment) {
      const key = `file:${path}`;
      const existing = fileContext().find((f) => f.key === key);
      if (existing) return;
      setFileContext((prev) => [...prev, { path, key, selection, preview }]);
      return;
    }

    setFileContext((prev) => [...prev, { path, key: generateUUID(), comment, selection, preview }]);
  }

  function openFileMention(path: string, options?: { autoAddToContext?: boolean; note?: string }) {
    if (options?.autoAddToContext) {
      addFileToContext(path, options.note)
      setInput((prev) => prev || "Please review the attached HTML file before enabling JavaScript in preview.")
      closeFileMention()
      return
    }

    setMentionSelection(null);
    setMentionPath(path);
  }

  function openFileLineMention(path: string, selection: { startLine: number; endLine: number }) {
    setMentionSelection(selection);
    setMentionPath(path);
  }

  function closeFileMention() {
    setMentionPath(null);
    setMentionSelection(null);
  }

  function submitFileMention(note: string, selection: { startLine: number; endLine: number }, preview: string) {
    const path = mentionPath();
    if (!path) return;
    addFileToContext(path, note || undefined, selection, preview);
    closeFileMention();
  }

  async function searchAtFiles(query: string) {
    setAtLoading(true);
    const res = await client.find.files({ query, dirs: "false" });
    setAtFiles(res.data ?? []);
    setAtLoading(false);
  }

  function removeFileFromContext(key: string) {
    setFileContext((prev) => prev.filter((f) => f.key !== key));
  }

  function addUpload(file: File) {
    setError(null);
    const name = file.name.toLowerCase();
    const isTextBased =
      file.type.startsWith("text/") ||
      ACCEPTED_TEXT_MIME_TYPES.includes(file.type) ||
      ACCEPTED_TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!ACCEPTED_TYPES.includes(file.type) && !isTextBased) {
      setError(
        `Unsupported file type: ${file.type || file.name}. Accepted: images, PDFs, and text-based files.`,
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(
        `File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB). Max size: 10MB.`,
      );
      return;
    }

    const id = generateUUID();
    const mime = isTextBased ? "text/plain" : file.type;
    const dir = directory || "";
    const sid = sessionId() || draftUploadId;
    const filename = file.name.replace(/[\/\\:*?"<>|]/g, "_");
    const serverPath = `${dir.replace(/\/$/, "")}/.opencode/uploads/${sid}/${id}-${filename}`;
    setImageAttachments((prev) => [...prev, { id, name: file.name, mime, serverPath, status: "uploading" }]);

    uploadFile(serverUrl, serverPath, file, targetUrl).then((ok) => {
      if (ok) {
        setImageAttachments((prev) => prev.map((a) =>
          a.id === id ? { ...a, status: "uploaded" } : a,
        ));
      } else {
        setImageAttachments((prev) => prev.filter((a) => a.id !== id));
        setError(`Failed to upload file: ${file.name}`);
      }
    });
  }

  function removeUpload(id: string) {
    const attachment = imageAttachments().find((a) => a.id === id);
    setImageAttachments((prev) => prev.filter((a) => a.id !== id));
    if (attachment?.serverPath && attachment.status === "uploaded") {
      deleteFile(serverUrl, attachment.serverPath, targetUrl);
    }
  }

  function resetComposer() {
    setInput("");
    setDragHeight(0);
    if (inputRef) inputRef.style.height = "";
    for (const a of imageAttachments()) {
      if (a.serverPath && a.status === "uploaded") {
        deleteFile(serverUrl, a.serverPath, targetUrl);
      }
    }
    setFileContext([]);
    setImageAttachments([]);
    drafts.delete(draftKey(server.serverKey(), params.dir, sessionId()));
  }

  function enqueuePrompt(item: PendingPromptItem) {
    setError(null);
    setShowTodoTray(false);
    setPendingQueue((prev) => [...prev, { ...item, status: "queued" }]);
    resetComposer();
  }

  function queueActive() {
    return !!activePrompt() || processing();
  }

  function deleteQueuedPrompt(id: string) {
    setPendingQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function buildPromptParts(item: PendingPromptItem) {
    const parts: (
      | { type: "text"; text: string }
      | { type: "file"; mime: string; url: string; filename: string }
    )[] = [{ type: "text", text: item.text || "" }];

    for (const file of item.files) {
      if (file.selection || file.comment) {
        const selection = file.selection ? `\nLines: ${file.selection.startLine}-${file.selection.endLine}` : "";
        const note = file.comment ? `\nNote: ${file.comment}` : "";
        const body = file.preview ? `\n\n${file.preview}` : "";
        parts.push({ type: "text", text: `File: ${file.path}${selection}${note}${body}` });
      }

      const dir = directory || "";
      const absolute = file.path.startsWith("/")
        ? file.path
        : `${dir.replace(/\/$/, "")}/${file.path.replace(/^\//, "")}`;
      const filename = file.path.split("/").pop() || file.path;
      const encoded = absolute
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      parts.push({
        type: "file",
        mime: "text/plain",
        url: `file://${encoded}`,
        filename,
      });
    }

    for (const img of item.images) {
      if (img.status === "uploading" || !img.serverPath) continue;
      const encoded = img.serverPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      parts.push({
        type: "file",
        mime: img.mime,
        url: `file://${encoded}`,
        filename: img.name,
      });
    }

    return parts;
  }

  async function submitPrompt(item: PendingPromptItem, options?: { allowAutoFallback?: boolean }) {
    setError(null);
    setLoading(true);
    setShowTodoTray(false);
    resetComposer();

    try {
      let id = sessionId();

      if (!id) {
        const createRes = await client.session.create({});
        if (!createRes.data || !createRes.data.id) throw new Error("Failed to create session");

        const newId = createRes.data.id;
        id = newId;
        setSessionId(id);
        navigate(`/${dirSlug()}/session/${id}`, { replace: true });
      }

      await client.session.promptAsync({
        sessionID: id,
        parts: buildPromptParts(item),
        agent: item.agent,
        model: item.model,
        variant: item.variant ?? undefined,
      });

      setActivePrompt({ ...item, status: "running" });
      clearConnectionRetryCount(item.id)
      startProcessing();
      return true;
    } catch (err) {
      if (options?.allowAutoFallback !== false) {
        const fallback = await maybeAutoFallback(item, err)
        if (fallback.attempted) return fallback.succeeded
      }

      console.error("[Session] Error sending message:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to send message: ${errMsg}`);
      if (errMsg.includes(LOAD_FAILED_SUBSTR) || isRetryableModelFailure(err)) {
        setFailedPromptItem(item);
      }
      setActivePrompt(null);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function flushQueuedPrompt() {
    const next = pendingQueue()[0];
    if (!next || queueActive() || inputBlocked() || loading()) return;
    const submitted = await submitPrompt(next);
    setPendingQueue((prev) => applyQueuedPromptSubmission(prev, next.id, submitted));
  }

  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files) return;
    for (const file of files) {
      addUpload(file);
    }
    target.value = ""; // Reset to allow re-selecting same file
  }

  // Handle paste events (Ctrl+V) to extract files from clipboard
  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault(); // Prevent default paste behavior for files
          addUpload(file);
        }
      }
    }
  }

  // Drag & Drop state and handlers
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragMode, setDragMode] = createSignal<"upload" | "mention" | null>(null);
  const [treePreview, setTreePreview] = createSignal<"mention" | null>(null);
  let dragCounter = 0; // Track nested drag events
  const dragLabel = createMemo(() =>
    (dragMode() ?? treePreview()) === "mention" ? "Drop to mention file" : "Drop files to upload",
  );
  const dropActive = createMemo(() => dragMode() !== null || isDragging() || treePreview() !== null);
  const dragSurface = "color-mix(in srgb, var(--surface-inset) 90%, var(--interactive-base) 10%)";
  const dragBorder = "color-mix(in srgb, var(--border-base) 56%, var(--interactive-base) 44%)";
  const dragGlow = "color-mix(in srgb, var(--interactive-base) 34%, transparent)";
  const dragLabelSurface = "color-mix(in srgb, var(--background-base) 72%, var(--surface-inset) 28%)";

  function clearDragState() {
    dragCounter = 0;
    setIsDragging(false);
    setDragMode(null);
  }

  function clearTreePreview() {
    setTreePreview(null);
  }

  function getDragMode(e: DragEvent) {
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (types.includes("Files")) return "upload" as const;
    if (!types.includes(FILE_TREE_DRAG_DATA)) return null;

    const kind = e.dataTransfer?.getData(FILE_TREE_KIND_DATA);
    if (kind !== "file") return null;
    return "mention" as const;
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inputBlocked()) return;
    const mode = getDragMode(e);
    if (!mode) return;
    dragCounter++;
    setIsDragging(true);
    setDragMode(mode);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only decrement if counter is positive to prevent negative values
    if (dragCounter > 0) {
      dragCounter--;
    }
    if (dragCounter === 0) {
      clearDragState();
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inputBlocked()) return;
    if (!dragMode()) {
      const mode = getDragMode(e);
      if (!mode) return;
      setDragMode(mode);
      setIsDragging(true);
      if (dragCounter === 0) dragCounter = 1;
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = dragMode() === "mention" ? "copy" : "copy";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const mode = dragMode() ?? getDragMode(e);
    clearDragState();

    if (inputBlocked()) return;
    if (mode === "mention") {
      const path = e.dataTransfer?.getData(FILE_TREE_DRAG_DATA);
      if (path) {
        addFileToContext(path);
        requestAnimationFrame(() => inputRef?.focus());
      }
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      addUpload(file);
    }
  }

  onMount(() => {
    const start = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind !== "file") return;
      setTreePreview("mention");
    };

    const end = () => {
      clearTreePreview();
    };

    window.addEventListener("opencode-filetree-preview-start", start as EventListener);
    window.addEventListener("opencode-filetree-preview-end", end as EventListener);

    onCleanup(() => {
      window.removeEventListener("opencode-filetree-preview-start", start as EventListener);
      window.removeEventListener("opencode-filetree-preview-end", end as EventListener);
    });
  });

  function selectedModelString() {
    const model = providers.selectedModel;
    if (!model) return null;
    return `${model.providerID}/${model.modelID}`;
  }

  async function loadQuotaSnapshot() {
    try {
      return await getQuota(serverUrl, { targetUrl, projectDir: directory })
    } catch {
      return null
    }
  }

  async function maybeAutoFallback(item: PendingPromptItem, error: unknown): Promise<{ attempted: boolean; succeeded: boolean }> {
    if (!isRetryableModelFailure(error)) return { attempted: false, succeeded: false }
    if (autoFallbackAttempts.has(item.id)) return { attempted: false, succeeded: false }

    const current = item.model ?? providers.selectedModel
    if (!current) return { attempted: false, succeeded: false }

    const candidates = providers.eligibleModels()
    if (candidates.length <= 1) return { attempted: false, succeeded: false }

    const quota = await loadQuotaSnapshot()
    const next = pickFallbackCandidate(candidates, current, quota, fallbackPolicy(item.agent))
    if (!next) return { attempted: false, succeeded: false }

    autoFallbackAttempts.add(item.id)
    batch(() => {
      providers.setSelectedAgent(item.agent)
      providers.setSelectedModel({ providerID: next.providerID, modelID: next.modelID })
      providers.setSelectedVariant(null)
      setSessionSelection({
        agent: item.agent,
        model: { providerID: next.providerID, modelID: next.modelID },
        variant: null,
      })
      setModelPickerError(null)
      setRetryAwaitingSelection(false)
      setFailedPromptItem(null)
      setError(null)
    })

    showToast(`Retrying with ${next.providerName} ${next.modelName} after rate limit.`, 8000, "warning")

    const retried = await submitPrompt({
      ...item,
      model: { providerID: next.providerID, modelID: next.modelID },
      variant: null,
    }, { allowAutoFallback: false })

    if (retried) {
      autoFallbackAttempts.delete(item.id)
      setFailedPromptItem(null)
      return { attempted: true, succeeded: true }
    }

    setFailedPromptItem(item)
    return { attempted: true, succeeded: false }
  }

  function buildCommandParts(files: FileContext[], images: ImageAttachment[]) {
    const currentDirectory = directory || base64Decode(params.dir);
    const parts: Array<{
      type: "file";
      mime: string;
      filename?: string;
      url: string;
    }> = [];

    for (const file of files) {
      if (file.status === "uploading" || !file.dataUrl) continue;
      const dir = currentDirectory || "";
      const absolute = file.path.startsWith("/")
        ? file.path
        : `${dir.replace(/\/$/, "")}/${file.path.replace(/^\//, "")}`;
      const filename = file.path.split("/").pop() || file.path;
      const encoded = absolute
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      parts.push({
        type: "file",
        mime: "text/plain",
        url: `file://${encoded}`,
        filename,
      });
    }

    for (const img of images) {
      if (img.status === "uploading" || !img.serverPath) continue;
      const encoded = img.serverPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      parts.push({
        type: "file",
        mime: img.mime,
        url: `file://${encoded}`,
        filename: img.name,
      });
    }

    return parts.length > 0 ? parts : undefined;
  }

  async function ensureSessionId() {
    const id = sessionId();
    if (id) return id;

    const res = await client.session.create({});
    if (!res.data || !res.data.id) throw new Error("Failed to create session");

    const sid = res.data.id;
    setSessionId(sid);
    navigate(`/${dirSlug()}/session/${sid}`, { replace: true });
    return sid;
  }

  function parseSlashCommand(text: string) {
    const match = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    return {
      name: match[1],
      arguments: match[2] ?? "",
    };
  }

  async function executeBackendSlashCommand(command: BackendSlashCommand, text: string, files: FileContext[], images: ImageAttachment[]) {
    if (queueActive()) {
      setError("Wait for the current turn to finish before running a command.");
      return false;
    }

    if (!providers.selectedModel) {
      setError(MODEL_NOT_READY_ERROR);
      return false;
    }

    if (!providers.connected.includes(providers.selectedModel.providerID)) {
      setError(`Provider "${providers.selectedModel.providerID}" is not connected. Please configure it in Settings.`);
      return false;
    }

    const id = await ensureSessionId();
    const model = selectedModelString();
    if (!model) return false;

    setError(null);
    setLoading(true);
    setShowTodoTray(false);
    resetComposer();

    try {
      await client.session.command({
        sessionID: id,
        directory: directory || base64Decode(params.dir),
        command: command.slash,
        arguments: text,
        agent: providers.selectedAgent || "build",
        model,
        variant: providers.selectedVariant ?? undefined,
        parts: buildCommandParts(files, images),
      });
      startProcessing();
      return true;
    } catch (err) {
      setError(`Failed to send command: ${err instanceof Error ? err.message : String(err)}`);
      setProcessing(false);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e: SubmitEvent) {
    e.preventDefault();
    await submitComposerAction();
  }

  async function retryFailedSend() {
    const item = failedPromptItem();
    if (!item || retryingModel()) return;

    setRetryingModel(true);
    setRetryAwaitingSelection(true);
    setError(null);
    try {
      try {
        await client.instance.dispose();
      } catch (e) {
        console.error("Failed to dispose client instance before retry:", e);
      }

      await providers.refetch();
      openModelPicker();
    } finally {
      setRetryingModel(false);
    }
  }

  async function retryFailedSendWithSelection() {
    const item = failedPromptItem();
    const model = providers.selectedModel;
    if (!item || !model) return;

    setRetryAwaitingSelection(false);
    const ok = await submitPrompt({
      ...item,
      model,
      variant: providers.selectedVariant ?? undefined,
    });
    if (ok) {
      clearConnectionRetryCount(item.id)
      setFailedPromptItem(null);
      setRetryAwaitingSelection(false);
    }
  }

  async function submitComposerAction() {
    const text = input().trim();

    // Intercept `/undo N` — revert N user turns at once (explicit submit only)
    const undoMatch = text.match(/^\/undo\s+(\d+)$/i);
    if (undoMatch) {
      const n = parseInt(undoMatch[1], 10);
      if (n > 0) {
        setInput("");
        undoTurns(n);
        return;
      }
    }

    const files = fileContext();
    const images = imageAttachments();
    if ((!text && files.length === 0 && images.length === 0) || inputBlocked())
      return;
    if (images.some((img) => img.status === "uploading")) {
      setError("Please wait for uploads to finish before sending.");
      return;
    }

    const slash = parseSlashCommand(text);
    if (slash) {
      const backend = backendSlashCommandItems().find((command) => command.slash === slash.name);
      if (backend) {
        await executeBackendSlashCommand(backend, slash.arguments, files, images);
        return;
      }

      const local = localSlashCommands().find((command) => command.slash === slash.name);
      if (local) {
        setInput("");
        setShowSlashPopover(false);
        setSlashQuery("");
        setTimeout(() => local.onSelect(), 0);
        return;
      }
    }

    // Require explicit model selection to avoid OpenCode auto-selecting a broken provider
    if (!providers.selectedModel) {
      setError(MODEL_NOT_READY_ERROR);
      return;
    }

    // Check if the selected model's provider is connected
    if (!providers.connected.includes(providers.selectedModel.providerID)) {
      setError(
        `Provider "${providers.selectedModel.providerID}" is not connected. Please configure it in Settings.`,
      );
      return;
    }

    if (queueActive()) {
      enqueuePrompt({
        id: generateUUID(),
        createdAt: Date.now(),
        text,
        files,
        images,
        agent: providers.selectedAgent || "build",
        model: providers.selectedModel
          ? {
              providerID: providers.selectedModel.providerID,
              modelID: providers.selectedModel.modelID,
            }
          : undefined,
        variant: providers.selectedVariant ?? undefined,
        status: "queued",
      });
      return;
    }

    await submitPrompt({
      id: generateUUID(),
      createdAt: Date.now(),
      text,
      files,
      images,
      agent: providers.selectedAgent || "build",
      model: providers.selectedModel
        ? {
            providerID: providers.selectedModel.providerID,
            modelID: providers.selectedModel.modelID,
          }
        : undefined,
      variant: providers.selectedVariant ?? undefined,
      status: "running",
    });
  }

  async function createSessionAndSendPrompt(text: string) {
    if (!providers.selectedModel) {
      setError(MODEL_NOT_READY_ERROR);
      return;
    }
    if (!providers.connected.includes(providers.selectedModel.providerID)) {
      setError(`Provider "${providers.selectedModel.providerID}" is not connected. Please configure it in Settings.`);
      return;
    }
    setError(null);
    try {
      const res = await client.session.create({});
      if (!res.data) return;
      const sid = res.data.id;
      setSessionId(sid);
      navigate(`/${dirSlug()}/session/${sid}`, { replace: true });
      sessionStorage.setItem(
        `opencode.pendingPrompt.${sid}`,
        JSON.stringify({
          items: [{
            id: generateUUID(),
            text,
            ts: Date.now(),
            agent: providers.selectedAgent || "build",
            model: providers.selectedModel,
            variant: providers.selectedVariant ?? undefined,
          }],
        } satisfies PendingPromptStorage),
      );
    } catch (err) {
      setError(`Failed to send saved prompt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Welcome screen component for when no session is selected
  function WelcomeScreen() {
    const savedPrompts = useSavedPrompts();

    return (
      <div
        class="flex flex-col h-full"
        style={{ background: "var(--background-stronger)" }}
      >
        <div class="flex flex-col items-center justify-center flex-1 text-center px-6">
          {/* OpenCode Logo */}
          <div class="mb-8">
            <svg
              class="w-80 mx-auto opacity-60"
              style={{ color: "var(--text-strong)" }}
              viewBox="0 0 640 115"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clip-path="url(#clip0_welcome)">
                <mask
                  id="mask0_welcome"
                  style="mask-type:luminance"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="640"
                  height="115"
                >
                  <path d="M640 0H0V115H640V0Z" fill="white" />
                </mask>
                <g mask="url(#mask0_welcome)">
                  <path
                    d="M49.2346 82.1433H16.4141V49.2861H49.2346V82.1433Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M49.2308 32.8573H16.4103V82.143H49.2308V32.8573ZM65.641 98.5716H0V16.4287H65.641V98.5716Z"
                    fill="var(--text-weak)"
                  />
                  <path
                    d="M131.281 82.1433H98.4609V49.2861H131.281V82.1433Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M98.4649 82.143H131.285V32.8573H98.4649V82.143ZM147.696 98.5716H98.4649V115H82.0547V16.4287H147.696V98.5716Z"
                    fill="var(--text-weak)"
                  />
                  <path
                    d="M229.746 65.7139V82.1424H180.516V65.7139H229.746Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M229.743 65.7144H180.512V82.143H229.743V98.5716H164.102V16.4287H229.743V65.7144ZM180.512 49.2859H213.332V32.8573H180.512V49.2859Z"
                    fill="var(--text-weak)"
                  />
                  <path
                    d="M295.383 98.5718H262.562V49.2861H295.383V98.5718Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M295.387 32.8573H262.567V98.5716H246.156V16.4287H295.387V32.8573ZM311.797 98.5716H295.387V32.8573H311.797V98.5716Z"
                    fill="var(--text-weak)"
                  />
                  <path
                    d="M393.848 82.1433H344.617V49.2861H393.848V82.1433Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M393.844 32.8573H344.613V82.143H393.844V98.5716H328.203V16.4287H393.844V32.8573Z"
                    fill="currentColor"
                  />
                  <path
                    d="M459.485 82.1433H426.664V49.2861H459.485V82.1433Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M459.489 32.8573H426.668V82.143H459.489V32.8573ZM475.899 98.5716H410.258V16.4287H475.899V98.5716Z"
                    fill="currentColor"
                  />
                  <path
                    d="M541.539 82.1433H508.719V49.2861H541.539V82.1433Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M541.535 32.8571H508.715V82.1428H541.535V32.8571ZM557.946 98.5714H492.305V16.4286H541.535V0H557.946V98.5714Z"
                    fill="currentColor"
                  />
                  <path
                    d="M639.996 65.7139V82.1424H590.766V65.7139H639.996Z"
                    fill="var(--icon-weak)"
                  />
                  <path
                    d="M590.77 32.8573V49.2859H623.59V32.8573H590.77ZM640 65.7144H590.77V82.143H640V98.5716H574.359V16.4287H640V65.7144Z"
                    fill="currentColor"
                  />
                </g>
              </g>
              <defs>
                <clipPath id="clip0_welcome">
                  <rect width="640" height="115" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </div>

          <Show when={branding.enabled}>
            <div
              class="flex items-center justify-center gap-2 mb-8"
              style={{ color: "var(--text-weak)" }}
            >
              <span>Powered by</span>
              <Show
                when={branding.url}
                fallback={
                  <span class="font-medium" style={{ color: "var(--text-strong)" }}>
                    {branding.name}
                  </span>
                }
              >
                <a
                  href={branding.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium transition-opacity hover:opacity-80"
                  style={{ color: "var(--text-interactive-base)" }}
                >
                  {branding.name}
                </a>
              </Show>
            </div>
          </Show>

          {/* Action buttons */}
          <div class="flex flex-col gap-3 w-full max-w-xs">
            <Button
              onClick={async () => {
                // New Session clicked
                if (!directory) {
                  console.error("[Welcome] No directory available");
                  return;
                }
                try {
                  const res = await client.session.create({});
                  if (res.data) {
                    const url = `/${dirSlug()}/session/${res.data.id}`;
                    navigate(url);
                    
                  }
                } catch (e) {
                  console.error("[Welcome] Failed to create session:", e);
                }
              }}
              variant="ghost"
              class="w-full"
              size="sm"
            >
              <Plus class="w-4 h-4" />
              <span>New Session</span>
            </Button>

            <Button
              onClick={() => navigate(`/${dirSlug()}/settings`)}
              variant="ghost"
              class="w-full"
              size="sm"
            >
              <Settings class="w-4 h-4" />
              <span>Settings</span>
            </Button>
          </div>

          {/* Instructions active indicator */}
          <Show when={instructionsActive()}>
            <button
              type="button"
              onClick={() => navigate(`/${dirSlug()}/settings#instructions`)}
              class="mt-4 flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors mx-auto"
              style={{
                border: "1px solid var(--border-base)",
                color: "var(--text-base)",
                background: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-inset)";
                e.currentTarget.style.borderColor = "var(--interactive-base)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "var(--border-base)";
              }}
            >
              <BookOpen class="w-4 h-4" style={{ color: "var(--icon-success-base)" }} />
              <span>Project instructions active</span>
            </button>
          </Show>

          {/* Saved Prompts */}
          <Show when={savedPrompts.prompts().length > 0}>
            <div class="mt-8 w-full max-w-2xl">
              <h3
                class="text-sm font-medium mb-3 text-left"
                style={{ color: "var(--text-weak)" }}
              >
                Saved Prompts
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <For each={savedPrompts.prompts()}>
                  {(prompt) => (
                    <button
                      type="button"
                      onClick={() => createSessionAndSendPrompt(prompt.text)}
                      class="p-3 rounded-lg text-left transition-colors"
                      style={{
                        background: "var(--background-base)",
                        border: "1px solid var(--border-base)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--interactive-base)";
                        e.currentTarget.style.background = "var(--surface-inset)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-base)";
                        e.currentTarget.style.background = "var(--background-base)";
                      }}
                    >
                      <div
                        class="text-sm font-medium truncate"
                        style={{ color: "var(--text-strong)" }}
                      >
                        {prompt.title}
                      </div>
                      <div
                        class="text-xs mt-1 line-clamp-2"
                        style={{ color: "var(--text-weak)" }}
                      >
                        {prompt.text.length > 100
                          ? prompt.text.slice(0, 100) + "..."
                          : prompt.text}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <p
            class="mt-10 text-sm"
            style={{ color: "var(--text-weak)", opacity: 0.7 }}
          >
            Select a session from the sidebar or start a new one
          </p>
        </div>
      </div>
    );
  }

  // Chat view component
  function ChatView() {
    // Re-focus main input when prompts are resolved
    let wasBlocked = false;
    createEffect(() => {
      const blocked = inputBlocked();
      if (wasBlocked && !blocked && !("ontouchstart" in window)) {
        requestAnimationFrame(() => inputRef?.focus());
      }
      wasBlocked = blocked;
    });

    return (
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header with panel toggle buttons */}
        <SessionHeader
          session={session()}
          processing={processing()}
          onOpenMCPDialog={() => setShowMCPDialog(true)}
          notifyEnabled={notifyEnabled()}
          notifyDenied={notifyDenied()}
          onToggleNotify={toggleNotify}
          instructionsActive={instructionsActive()}
          onOpenInstructions={() => navigate(`/${dirSlug()}/settings#instructions`)}
        />

        {/* Messages - using rich message timeline with lazy rendering */}
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
          <MessageTimeline
            messages={messages()}
            processing={
              processing() &&
              !pendingQuestion() &&
              pendingPermissions().length === 0
            }
            loadingHistory={loadingHistory()}
            historyError={historyError()}
            sessionStatus={sessionId() ? events.status[sessionId()!] : undefined}
            activeTurnId={activeTurnId()}
            activeTurnState={activeTurnState()}
            queuedTurns={queuedTurns()}
            onDeleteQueuedTurn={deleteQueuedPrompt}
            onRetry={retryTurn}
            onOpenFile={openFilePreview}
            onRetryHistory={() => {
              const id = params.id;
              if (!id) return;
              setLoadingHistory(true);
              setHistoryError(null);
              void sync.session.sync(id)
                .then(() => {
                  setHistoryError(null);
                  setLoadingHistory(false);
                })
                .catch((err) => {
                  setHistoryError(errorMessage(err, "Loading chat history failed"));
                  setLoadingHistory(false);
                });
            }}
          />

          <Show when={historyError() && !loadingHistory()}>
            <div
              class="mx-6 mt-4 px-4 py-3 rounded-lg flex items-center justify-between gap-3"
              style={{
                background: "var(--status-danger-dim)",
                color: "var(--status-danger-text)",
                border: "1px solid var(--status-danger-border)",
              }}
            >
              <div class="min-w-0">
                <div class="text-sm font-medium">Failed to load chat history</div>
                <div class="text-xs opacity-90 break-words">{historyError()}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const id = params.id;
                  if (!id) return;
                  setLoadingHistory(true);
                  setHistoryError(null);
                  void sync.session.sync(id)
                    .then(() => {
                      setHistoryError(null);
                      setLoadingHistory(false);
                    })
                    .catch((err) => {
                      setHistoryError(errorMessage(err, "Loading chat history failed"));
                      setLoadingHistory(false);
                    });
                }}
                class="px-3 py-1.5 rounded-md text-xs shrink-0 transition-colors"
                style={{
                  background: "rgba(0, 0, 0, 0.08)",
                  color: "var(--status-danger-text)",
                }}
              >
                Retry
              </button>
            </div>
          </Show>

          {/* Question Prompt - rendered outside timeline for proper focus.
              Uses session tree walk so child/grandchild questions are surfaced here. */}
          <Show when={pendingQuestion()}>
            {(q) => (
              <div
                class="min-h-0 overflow-hidden px-6 pb-4"
                style={{ background: "var(--background-stronger)" }}
              >
                <QuestionPrompt
                  request={q()}
                  onReply={handleQuestionReply}
                  onReject={handleQuestionReject}
                  fromSubAgent={q().sessionID !== sessionId()}
                />
              </div>
            )}
          </Show>

          {/* Permission Prompt - rendered outside timeline for proper focus.
              Uses session tree walk so child/grandchild permissions are surfaced here. */}
          <Show when={pendingPermissions().length > 0}>
            <div
              class="px-6 pb-4"
              style={{ background: "var(--background-stronger)" }}
            >
              <Show when={pendingPermissions().some((p) => p.sessionID !== sessionId())}>
                <div
                  class="text-xs mb-2 px-1"
                  style={{ color: "var(--text-dimmed)" }}
                >
                  Permission request from sub-agent
                </div>
              </Show>
              <PermissionPrompt
                requests={pendingPermissions()}
                onRespond={permission.respond}
                onAutoAccept={permission.enableAutoAccept}
                autoAcceptEnabled={permission.autoAcceptEnabled()}
                currentSessionID={sessionId()}
              />
            </div>
          </Show>
        </div>

        <Show when={device.isMobile()}>
          <div aria-hidden="true" class={showTodoTray() ? "h-[3.75rem]" : "h-4"} />
        </Show>

        {/* Input */}
        <div
          data-panel="chat"
          class="relative z-20 p-4"
          style={{
            background: "var(--background-base)",
            "border-top": "1px solid var(--border-base)",
          }}
          >
            <div class="relative w-full">
            <MobileTodoTray
              sessionId={sessionId}
              open={showTodoTray}
              setOpen={setShowTodoTray}
              processing={processing}
            />
            <Show when={showAtPopover()}>
              <div
                class="absolute bottom-full left-0 mb-2 w-80 max-h-64 rounded-lg shadow-lg z-20 flex flex-col"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                }}
              >
                <div
                  class="px-3 py-2 text-xs font-medium sticky top-0"
                  style={{
                    color: "var(--text-weak)",
                    background: "var(--surface-inset)",
                    "border-bottom": "1px solid var(--border-base)",
                  }}
                >
                  <span>Files</span>
                  <Show when={atLoading()}>
                    <span class="ml-2 animate-pulse">Loading...</span>
                  </Show>
                </div>
                <div
                  class="overflow-y-auto flex-1"
                  ref={(el) => {
                    createEffect(() => {
                      const idx = atIndex();
                      const selected = el.querySelector(`[data-at-index="${idx}"]`);
                      if (selected) {
                        selected.scrollIntoView({ block: "nearest" });
                      }
                    });
                  }}
                >
                  <Show
                    when={atFiles().length > 0}
                    fallback={
                      <div class="px-3 py-4 text-sm text-center" style={{ color: "var(--text-weak)" }}>
                        {atLoading() ? "Searching..." : "No files found"}
                      </div>
                    }
                  >
                    <For each={atFiles()}>
                      {(file, idx) => {
                        const isSelected = () => idx() === atIndex();
                        const parts = file.split("/");
                        const filename = parts.pop() || file;
                        const dir = parts.length > 0 ? parts.join("/") + "/" : "";
                        return (
                          <button
                            type="button"
                            data-at-index={idx()}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              selectAtFile(file);
                            }}
                            class="w-full px-3 py-2 text-left text-sm flex items-start gap-3 transition-colors"
                            style={{
                              background: isSelected()
                                ? "rgba(147, 112, 219, 0.15)"
                                : "transparent",
                              "border-left": isSelected()
                                ? "2px solid rgb(147, 112, 219)"
                                : "2px solid transparent",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected()) e.currentTarget.style.background = "var(--surface-inset)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected()) e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "var(--text-weak)" }}>
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <div class="flex-1 overflow-hidden">
                              <div class="font-medium truncate" style={{ color: "var(--text-strong)" }}>{filename}</div>
                              <Show when={dir}>
                                <div class="text-xs truncate" style={{ color: "var(--text-weak)" }}>{dir}</div>
                              </Show>
                            </div>
                          </button>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Slash Command Popover */}
            <Show when={showSlashPopover()}>
                <div
                  ref={slashPopoverRef}
                  class="absolute bottom-full left-0 mb-2 rounded-xl shadow-xl z-20 flex flex-col overflow-hidden"
                  style={{
                    width: "min(28rem, calc(100vw - 1.5rem))",
                    "max-height": "min(32rem, calc(100vh - 12rem))",
                    background: "var(--background-base)",
                    border: "1px solid var(--border-base)",
                  }}
                >
                 {/* Header */}
                <div
                  class="sticky top-0 px-4 py-3"
                  style={{
                    color: "var(--text-weak)",
                    background: "linear-gradient(180deg, var(--surface-inset), var(--background-base))",
                    "border-bottom": "1px solid var(--border-base)",
                  }}
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-sm font-semibold" style={{ color: "var(--text-strong)" }}>Commands</span>
                      <span class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-base)" }}>
                        / command
                      </span>
                    </div>
                    <Show when={backendSlashLoading()}>
                      <span class="animate-pulse text-xs">Loading...</span>
                    </Show>
                  </div>
                  <div class="mt-1 text-xs" style={{ color: "var(--text-dimmed)" }}>
                    Use ↑↓ to move, Enter to insert, Esc to close
                  </div>
                </div>

                {/* List */}
                <div
                  class="overflow-y-auto flex-1"
                  ref={(el) => {
                    createEffect(() => {
                      const idx = slashIndex();
                      const selected = el.querySelector(
                        `[data-index="${idx}"]`,
                      );
                      if (selected) {
                        selected.scrollIntoView({ block: "nearest" });
                      }
                    });
                  }}
                >
                  <Show
                    when={flatSlashCommands().length > 0}
                    fallback={
                      <div class="px-4 py-5 text-sm text-center" style={{ color: "var(--text-weak)" }}>
                        {backendSlashError()
                          ? backendSlashError()
                          : backendSlashLoading()
                            ? "Loading commands..."
                            : "No matching commands"}
                      </div>
                    }
                  >
                    <For each={groupedSlashCommands()}>
                      {(group) => (
                        <div>
                          <div
                            class="px-4 py-2 text-[10px] sticky top-0 flex items-center justify-between gap-2 uppercase tracking-[0.2em]"
                            style={{
                              color: "var(--text-dimmed)",
                              background: "var(--background-base)",
                              "border-bottom": "1px solid var(--border-base)",
                            }}
                          >
                            <span>{group.label}</span>
                            <span class="normal-case tracking-normal text-[10px]" style={{ color: "var(--text-dimmed)" }}>
                              {group.description}
                            </span>
                          </div>

                    <For each={group.items}>
                      {(cmd) => {
                        const commandIndex = () => flatSlashCommandIndex().get(cmd.id) ?? -1;
                        const isSelected = () => commandIndex() === slashIndex();
                        const isBackend = () => cmd.id.startsWith("backend:");
                        const backendCmd = () => isBackend() ? cmd as BackendSlashCommand : null;
                        return (
                          <button
                            type="button"
                            data-index={commandIndex()}
                            title={backendCmd()?.template ?? undefined}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                                    selectSlashCommand(cmd);
                                  }}
                                  class="w-full px-4 py-3 text-left text-sm transition-colors"
                                  style={{
                                    background: isSelected()
                                      ? "rgba(147, 112, 219, 0.15)"
                                      : "transparent",
                                    "border-left": isSelected()
                                      ? "3px solid rgb(147, 112, 219)"
                                      : "3px solid transparent",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected())
                                      e.currentTarget.style.background =
                                        "var(--surface-inset)";
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSelected())
                                      e.currentTarget.style.background = "transparent";
                                  }}
                                >
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                      <Show when={cmd.slash}>
                                        <span
                                          class="font-mono text-xs px-2 py-1 rounded-md whitespace-nowrap shrink-0"
                                          style={{
                                            color: "var(--text-interactive-base)",
                                            background: isSelected()
                                              ? "color-mix(in srgb, var(--interactive-base) 12%, transparent)"
                                              : "var(--surface-inset)",
                                            border: "1px solid var(--border-base)",
                                          }}
                                        >
                                          /{cmd.slash}
                                        </span>
                                      </Show>
                                      <span class="font-medium truncate" style={{ color: "var(--text-strong)" }}>
                                        {cmd.title}
                                      </span>
                                    </div>
                                    <Show when={cmd.description}>
                                      <div class="text-xs mt-1 leading-relaxed truncate" style={{ color: "var(--text-weak)" }}>
                                        {cmd.description}
                                      </div>
                                    </Show>
                                    <Show when={isBackend()}>
                                      <div class="mt-2 flex items-center gap-1.5">
                                        <span
                                          class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                                          style={{
                                            background: "var(--surface-inset)",
                                            color: "var(--text-weak)",
                                            border: "1px solid var(--border-base)",
                                          }}
                                        >
                                          {backendCmd()!.source ?? "command"}
                                        </span>
                                        <Show when={backendCmd()!.subtask}>
                                          <span
                                            class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                                            style={{
                                              background: "rgba(147,112,219,0.12)",
                                              color: "rgb(147,112,219)",
                                              border: "1px solid rgba(147,112,219,0.25)",
                                            }}
                                          >
                                            subtask
                                          </span>
                                        </Show>
                                      </div>
                                    </Show>
                                    <Show when={isBackend() && backendCmd()!.hints.length > 0}>
                                      <div class="mt-3 flex flex-wrap gap-1">
                                        <For each={backendCmd()!.hints.slice(0, 3)}>
                                          {(hint) => (
                                            <span
                                              class="rounded-full px-2 py-0.5 text-[10px]"
                                              style={{
                                                background: "transparent",
                                                color: "var(--text-dimmed)",
                                                border: "1px solid var(--border-base)",
                                              }}
                                            >
                                              {hint}
                                            </span>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </div>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
                <div
                  class="px-4 py-2 text-[10px] flex items-center justify-between"
                  style={{
                    color: "var(--text-dimmed)",
                    background: "var(--background-base)",
                    "border-top": "1px solid var(--border-base)",
                  }}
                >
                  <span>Local commands stay available for app actions.</span>
                  <span>Enter inserts backend commands into the composer.</span>
                </div>
              </div>
            </Show>

            {/* Error message */}
            <Show when={error()}>
              <div
                class="mb-2 rounded-lg px-4 py-2 text-sm"
                style={{
                  background: "var(--status-danger-dim)",
                  color: "var(--status-danger-text)",
                }}
              >
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{error()}</span>
                  <Show when={error() === MODEL_NOT_READY_ERROR || (error() ?? "").includes(LOAD_FAILED_SUBSTR) || (failedPromptItem() && isRetryableModelFailure(error()))}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={retryingModel()}
                      onClick={() => {
                        if (error() === MODEL_NOT_READY_ERROR) {
                          openModelPicker();
                          return;
                        }

                        void retryFailedSend();
                      }}
                      class="shrink-0 self-start sm:self-auto"
                    >
                      {retryingModel() ? "Loading..." : "Select model"}
                    </Button>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={!device.isMobile()}>
              <FileMentionDialog
                open={mentionPath() !== null}
                path={mentionPath() ?? ""}
                initialSelection={mentionSelection() ?? undefined}
                onSubmit={submitFileMention}
                onClose={closeFileMention}
              />
            </Show>

            <form
              onSubmit={sendMessage}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              style={{ cursor: inputBlocked() ? "not-allowed" : "auto" }}
            >
              <div
                class="relative flex flex-col rounded-lg focus-within:ring-2 transition-all"
                inert={inputBlocked() || undefined}
                style={
                  {
                    background: dropActive() ? dragSurface : "var(--background-base)",
                    border: dropActive()
                      ? `1px solid ${dragBorder}`
                      : "1px solid var(--border-base)",
                    "box-shadow": dropActive()
                      ? `0 0 0 1px ${dragBorder} inset, 0 0 0 3px ${dragGlow}`
                      : "none",
                    "--tw-ring-color": "var(--interactive-base)",
                    opacity: inputBlocked() ? "0.5" : "1",
                  } as any
                }
              >
                {/* File context items */}
                <ContextItems
                  items={fileContext()}
                  onRemove={removeFileFromContext}
                />

                {/* Device uploads (images, PDFs, and text-based files) */}
                <ImageAttachments
                  attachments={imageAttachments()}
                  onRemove={removeUpload}
                />

                {/* Hidden file input for device uploads */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={[...ACCEPTED_TYPES, "text/*", ...ACCEPTED_TEXT_EXTENSIONS].join(",")}
                  multiple
                  class="hidden"
                  onChange={handleFileInputChange}
                />

                {/* Drag overlay */}
                <Show when={dropActive()}>
                  <div
                    class="absolute inset-0 z-10 flex items-center justify-center rounded-lg pointer-events-none"
                    style={{
                      background: "color-mix(in srgb, var(--background-base) 24%, transparent)",
                    }}
                  >
                    <div
                      class="rounded-full px-3 py-1.5 text-sm font-medium shadow-sm"
                      style={{
                        color: "var(--text-strong)",
                        background: dragLabelSurface,
                        border: `1px solid ${dragBorder}`,
                      }}
                    >
                      {dragLabel()}
                    </div>
                  </div>
                </Show>

                <Show when={sessionPausedReason()}>
                  {(reason) => (
                    <div
                      class="mx-2 mb-2 rounded-lg px-3 py-2 text-xs font-medium"
                      style={{
                        background: "var(--status-warning-dim)",
                        color: "var(--status-warning-text)",
                        border: "1px solid var(--status-warning-border)",
                      }}
                    >
                      {reason() === "paused_question" ? "Paused: question" : "Paused: permission"}
                    </div>
                  )}
                </Show>

                <RetryStatusBanner status={retrySessionStatus} />

                {/* Drag-to-resize handle */}
                <ResizeHandle
                  direction="vertical"
                  edge="start"
                  size={dragHeight() || (inputRef?.offsetHeight ?? 48)}
                  min={48}
                  max={maxInputHeight()}
                  onResize={(h) => {
                    setDragHeight(h);
                    if (inputRef) inputRef.style.height = `${h}px`;
                  }}
                />

                <textarea
                  ref={inputRef}
                  value={input()}
                  disabled={inputBlocked()}
                  onPaste={handlePaste}
                  onFocus={() => device.isMobile() && setShowTodoTray(false)}
                  onInput={(e) => {
                    handleInputChange(e.currentTarget.value);
                    clampInputHeight(e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (showAtPopover()) {
                      if (e.key === "ArrowDown") { e.preventDefault(); setAtIndex(i => (i + 1) % atFiles().length); return; }
                      if (e.key === "ArrowUp") { e.preventDefault(); setAtIndex(i => (i - 1 + atFiles().length) % atFiles().length); return; }
                      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectAtFile(atFiles()[atIndex()]); return; }
                      if (e.key === "Escape") { e.preventDefault(); setShowAtPopover(false); return; }
                    }
                    // Handle slash command navigation first
                    if (showSlashPopover()) {
                      handleInputKeyDown(e);
                      return;
                    }
                    // Tab to cycle agents (when input is empty)
                    if (e.key === "Tab" && !input().trim()) {
                      e.preventDefault();
                      const agents = primaryAgents();
                      if (agents.length > 1) {
                        const currentIdx = agents.findIndex(
                          (a) => a.name === providers.selectedAgent,
                        );
                        const nextIdx = e.shiftKey
                          ? (currentIdx - 1 + agents.length) % agents.length
                          : (currentIdx + 1) % agents.length;
                        selectAgent(agents[nextIdx].name);
                      }
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (device.isTouchDevice()) {
                        const textarea = e.target as HTMLTextAreaElement;
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const text = input();
                        const newText = text.slice(0, start) + "\n" + text.slice(end);
                        setInput(newText);
                        setTimeout(() => {
                          textarea.style.height = "auto";
                          textarea.style.height = Math.min(textarea.scrollHeight, parseInt(getComputedStyle(textarea).maxHeight || "200")) + "px";
                          textarea.selectionStart = textarea.selectionEnd = start + 1;
                          textarea.focus();
                        }, 0);
                      } else {
                        sendMessage(new Event("submit") as any);
                      }
                    }
                  }}
                  placeholder={inputBlocked() ? "Respond to the prompt above to continue..." : "Type a message... (@ for files, / for commands)"}
                  rows={1}
                  class="w-full px-4 pt-3 pb-2 focus:outline-none resize-none bg-transparent"
                  style={{
                    color: "var(--text-base)",
                    "min-height": "48px",
                    "max-height": device.isTouchDevice()
                      ? "max(160px, calc(100dvh - 300px))"
                      : "max(200px, calc(100dvh - 200px))",
                    "overflow-y": "auto",
                  }}
                />

                {/* Bottom bar: attach buttons row + session info row */}
                <div class="flex flex-col">
                  {/* Attach buttons row */}
                  <div class="flex items-center justify-between px-2 pt-1 pb-0">
                    <div class="flex items-center gap-1">
                      {/* Save as prompt button */}
                      <Show when={input().trim()}>
                        <button
                          type="button"
                          onClick={() => {
                            const text = input().trim();
                            if (!text) return;
                            setSavePromptTitle(text.slice(0, 30));
                            setSavePromptBody(text);
                            setShowSavePrompt(true);
                          }}
                          class="p-1.5 rounded transition-colors"
                          style={{ color: "var(--text-weak)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              "var(--surface-inset)";
                            e.currentTarget.style.color = "var(--text-strong)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--text-weak)";
                          }}
                          title="Save as prompt"
                          aria-label="Save as prompt"
                        >
                          <Bookmark class="w-4 h-4" />
                        </button>
                      </Show>
                      {/* Upload from device button */}
                      <button
                        type="button"
                        onClick={() => fileInputRef?.click()}
                        class="p-1.5 rounded transition-colors"
                        style={{ color: "var(--text-weak)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "var(--surface-inset)";
                          e.currentTarget.style.color = "var(--text-strong)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-weak)";
                        }}
                        title="Upload file"
                        aria-label="Upload file"
                      >
                        <Upload class="w-4 h-4" />
                      </button>
                      {/* Attach file from project button */}
                      <button
                        type="button"
                        onClick={() => setShowFilePicker(true)}
                        class="p-1.5 rounded transition-colors"
                        style={{ color: "var(--text-weak)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "var(--surface-inset)";
                          e.currentTarget.style.color = "var(--text-strong)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-weak)";
                        }}
                        title="Attach file from project"
                        aria-label="Attach file from project"
                      >
                        <Paperclip class="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Session info row: Agent, Model, Token usage — always full width */}
                  <div class="w-full">
                    <SessionInfo
                      selectedAgent={() => activeSelection()?.agent ?? null}
                      selectedModel={() => activeSelection()?.model ?? null}
                      selectedVariant={() => activeSelection()?.variant ?? providers.selectedVariant ?? null}
                      input={input}
                      loading={loading}
                      processing={processing}
                      queueActive={queueActive}
                      queueCount={() => pendingQueue().length}
                      onAbort={handleAbort}
                      onAction={submitComposerAction}
                      onAgentClick={() => setShowAgentPicker(true)}
                      onModelClick={openModelPicker}
                      onVariantClick={() => setShowVariantPicker(true)}
                      hasAttachments={() => fileContext().length > 0 || imageAttachments().length > 0}
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* MCP Dialogs */}
        <Show when={showMCPDialog()}>
          <MCPDialog
            onClose={() => setShowMCPDialog(false)}
            onAddServer={() => {
              setShowMCPDialog(false);
              setShowMCPAddDialog(true);
            }}
          />
        </Show>

        <Show when={showMCPAddDialog()}>
          <MCPAddDialog
            onClose={() => setShowMCPAddDialog(false)}
            onBack={() => {
              setShowMCPAddDialog(false);
              setShowMCPDialog(true);
            }}
          />
        </Show>

        {/* Model Picker Dialog */}
        <Show when={showModelPicker()}>
          <PickerDialog
            title="Select Model"
            placeholder="Filter models..."
            emptyMessage="No models found. Connect a provider in settings."
            headerActionLabel="Retry load models"
            headerActionPendingLabel="Retrying..."
            headerActionDisabled={refreshingModelPicker()}
            onHeaderAction={() => void refreshModelPicker()}
            statusMessage={modelPickerError() ?? undefined}
            statusTone="error"
            loading={providers.loading || refreshingModelPicker()}
            loadingMessage={refreshingModelPicker() ? "Refreshing models…" : "Loading models…"}
            items={providers.providers
              .filter((p) => providers.connected.includes(p.id))
              .flatMap((p) => {
                const colonIdx = p.id.indexOf(":")
                const accountName = colonIdx > 0 ? p.id.slice(colonIdx + 1) : null
                return Object.values(p.models).map((m) => {
                  let description = `${p.id}/${m.id}`
                  const fmt = (n: number) => Number(n.toFixed(2)).toString()
                  const isOpenAI = p.id === "openai" || p.id.startsWith("openai:")
                  const isAnthropic = isAnthropicProviderID(p.id)
                  const hasZeroCost = !!m.cost && m.cost.input === 0 && m.cost.output === 0
                  const multiplier = getCopilotMultiplier(p.id, m.id, m.name) ?? m.copilotMultiplier
                  if (multiplier !== undefined) {
                    description += ` · x${fmt(multiplier)}`
                  } else if (m.cost) {
                    description += hasZeroCost && (isOpenAI || isAnthropic)
                      ? " · n/a"
                      : ` · $${fmt(m.cost.input)}/$${fmt(m.cost.output)}/M tokens`
                  } else if (isOpenAI || isAnthropic) {
                    description += " · n/a"
                  }
                  return {
                    id: `${p.id}:${m.id}`,
                    title: m.name || m.id,
                    description,
                    group: accountName ? `${p.name} (${accountName})` : p.name,
                  }
                })
              })}
            onSelect={(item) => {
              const parts = item.id.split(":");
              const providerID = parts[0];
              const modelID = parts.slice(1).join(":");
              selectModel({ providerID, modelID });
            }}
            onClose={closeModelPicker}
          />
        </Show>

        {/* Variant Picker Dialog */}
        <Show when={showVariantPicker()}>
          <PickerDialog
            title="Select Variant"
            placeholder="Filter variants..."
            emptyMessage="No variants available for this model."
            items={variantPickerItems()}
            onSelect={(item) => selectVariant(item.id === "__default__" ? null : item.id)}
            onClose={() => setShowVariantPicker(false)}
          />
        </Show>

        {/* Agent Picker Dialog */}
        <Show when={showAgentPicker()}>
          <PickerDialog
            title="Select Agent"
            placeholder="Filter agents..."
            emptyMessage="No agents available."
            items={primaryAgents().map((a) => ({
              id: a.name,
              title: a.name,
              description: `${a.mode} mode`,
            }))}
            onSelect={(item) => {
              selectAgent(item.id);
            }}
            onClose={() => setShowAgentPicker(false)}
          />
        </Show>

        {/* Saved Prompt Picker Dialog */}
        <Show when={showPromptPicker()}>
          <PickerDialog
            title="Insert Saved Prompt"
            placeholder="Filter prompts..."
            emptyMessage="No saved prompts. Add them in Settings."
            initialFilter={promptPickerFilter()}
            items={promptPickerItems()}
            onSelect={(item) => {
              const found = savedPrompts.prompts().find((p) => p.id === item.id);
              if (!found) return;
              if (inputRef) applyInputAndAutogrow(inputRef, found.text);
            }}
            onClose={() => setShowPromptPicker(false)}
          />
        </Show>

        {/* File Picker Dialog */}
        <Show when={showFilePicker()}>
          <FilePickerDialog
            title="Attach File"
            placeholder="Search files..."
            onSelect={addFileToContext}
            onClose={() => setShowFilePicker(false)}
          />
        </Show>

        {/* Fork Picker Dialog */}
        <Show when={showForkPicker()}>
          <PickerDialog
            title="Fork from Message"
            placeholder="Search messages..."
            emptyMessage="No user messages in this session."
            items={forkPickerItems()}
            onSelect={(item) => {
              const id = sessionId();
              if (!id) return;
              setError(null);
              client.session
                .fork({ sessionID: id, messageID: item.id })
                .then((res) => {
                  if (!res.data) {
                    setError("Failed to fork session");
                    return;
                  }
                  setError(null);
                  const forkedId = res.data.id;
                  // Find the selected message text to restore in the new session's input
                  const msgs = sync.messages(id);
                  const selected = msgs.find((m) => m.info.id === item.id);
                  const restoredText = selected
                    ? textFromParts(selected.parts, "\n")
                    : "";
                  navigate(`/${dirSlug()}/session/${forkedId}`);
                  // Restore the message text into the new session's input after navigation
                  if (inputRef) {
                    requestAnimationFrame(() => {
                      applyInputAndAutogrow(inputRef!, restoredText);
                    });
                  }
                })
                .catch((err: unknown) => {
                  setError(
                    `Failed to fork session: ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
            }}
            onClose={() => setShowForkPicker(false)}
          />
        </Show>

        {/* Save Prompt Dialog */}
        <Show when={showSavePrompt()}>
          <SavePromptDialog
            title={savePromptTitle}
            setTitle={setSavePromptTitle}
            onSave={() => {
              const title = savePromptTitle().trim();
              const body = savePromptBody();
              if (!title || !body) return;
              savedPrompts.add(title, body);
              setShowSavePrompt(false);
              showToast("Prompt saved");
            }}
            onClose={() => setShowSavePrompt(false)}
          />
        </Show>

        {/* Unified toast — only one visible at a time */}
        <Portal>
          <Show when={toastMessage()}>
            <div
              class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-xl text-sm transition-all border animate-in fade-in slide-in-from-bottom-2 duration-300 flex items-start gap-3"
              style={{
                "min-width": "280px",
                "max-width": "90vw",
                background: toastVariant() === "error" ? "var(--status-critical-dim)" :
                  toastVariant() === "warning" ? "var(--status-warning-dim)" :
                    toastVariant() === "success" ? "rgba(22, 163, 74, 0.1)" :
                      toastVariant() === "hint" ? "var(--surface-inset)" :
                        "var(--interactive-base)",
                color: toastVariant() === "error" ? "var(--status-critical-text)" :
                  toastVariant() === "warning" ? "var(--status-warning-text)" :
                    toastVariant() === "success" ? "var(--icon-success-base)" :
                      toastVariant() === "hint" ? "var(--text-strong)" :
                        "white",
                "border-color": toastVariant() === "error" ? "var(--status-critical-border)" :
                  toastVariant() === "warning" ? "var(--status-warning-border)" :
                    toastVariant() === "success" ? "rgba(22, 163, 74, 0.2)" :
                      toastVariant() === "hint" ? "var(--border-base)" :
                        "var(--interactive-hover)",
              }}
            >
              <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                <Show when={toastTitle()}>
                  <div class="font-bold text-xs uppercase tracking-wide opacity-80">{toastTitle()}</div>
                </Show>
                <div class="font-medium break-words">{toastMessage()}</div>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  hideToast();
                }}
                class="shrink-0 p-1 -mr-1 rounded-md opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Close notification"
              >
                <XIcon class="w-3.5 h-3.5" />
              </button>
            </div>
          </Show>
        </Portal>
      </div>
    );
  }

  // Use Show to reactively switch between welcome and chat views
  return (
    <Show when={sessionId()} fallback={<WelcomeScreen />}>
      <div class="flex h-full min-h-0 overflow-hidden">
        {/* Main chat area */}
        <div class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <ChatView />
        </div>

        {/* Review Panel */}
        <Show when={layout.review.opened()}>
          <Show when={device.isMobile()} fallback={
            <aside class="flex shrink-0" aria-label="Review panel">
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={layout.review.width()}
                min={200}
                max={Math.max(200, typeof window !== "undefined" ? Math.round(window.innerWidth * 0.8) : 800)}
                onResize={layout.review.resize}
                onCollapse={layout.review.close}
                collapseThreshold={100}
              />
              <div
                data-panel="review"
                tabIndex={-1}
                class="shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-[var(--interactive-base)] focus-visible:outline-offset-[-2px]"
                style={{ width: `${layout.review.width()}px` }}
              >
                <ReviewPanel sessionId={sessionId()!} onMentionFile={openFileMention} onMentionFileLine={openFileLineMention} />
              </div>
            </aside>
          }>
            <Portal>
              <div class="mobile-overlay" style={{ "z-index": 60 }}>
                <ReviewPanel sessionId={sessionId()!} onMentionFile={openFileMention} onMentionFileLine={openFileLineMention} />
              </div>
            </Portal>
          </Show>
        </Show>

        {/* Info Panel (Session Sidebar) - hidden on mobile since it's unneeded or handled elsewhere */}
        <Show when={layout.info.opened() && !device.isMobile()}>
          <aside class="flex shrink-0" aria-label="Session info">
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={layout.info.width()}
              min={180}
              max={400}
              onResize={layout.info.resize}
              onCollapse={layout.info.close}
              collapseThreshold={80}
            />
            <div
              class="shrink-0 overflow-hidden"
              style={{ width: `${layout.info.width()}px` }}
            >
            <SessionSidebar
              sessionId={sessionId()}
              selectedModel={() => activeSelection()?.model ?? null}
            />
            </div>
          </aside>
        </Show>
      </div>

      {/* Mobile Terminal Overlay */}
      <Show when={device.isMobile() && (terminal.opened() || terminal.creating() || !!terminal.error())}>
        <Portal>
          <div
            class="mobile-overlay flex flex-col"
            style={{ "z-index": 70, background: "var(--background-base)" }}
          >
            {/* Header */}
            <div
              class="flex items-center justify-between px-4 h-12 shrink-0"
              style={{
                background: "var(--background-stronger)",
                "border-bottom": "1px solid var(--border-base)",
              }}
            >
              <div class="flex items-center gap-2">
                <SquareTerminal class="w-4 h-4" style={{ color: "var(--icon-base)" }} />
                <span class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>Terminal</span>
              </div>
              <button
                onClick={() => terminal.toggle(directory)}
                class="p-1.5 rounded-md transition-colors"
                style={{ color: "var(--icon-base)" }}
                aria-label="Close terminal"
              >
                <XIcon class="w-5 h-5" />
              </button>
            </div>

            {/* Creating indicator */}
            <Show when={terminal.creating() && !terminal.error()}>
              <div class="p-4 flex items-center gap-3" style={{ color: "var(--text-weak)" }}>
                <span class="text-sm">Creating terminal session...</span>
              </div>
            </Show>

            {/* Error display */}
            <Show when={terminal.error()}>
              <div class="p-4 text-sm" style={{ color: "var(--text-critical-base)" }}>
                {terminal.error()}
              </div>
            </Show>

            {/* Terminal sessions */}
            <Show when={terminal.sessions().length > 0 && !terminal.error()}>
              {/* Tab bar */}
              <div
                class="flex items-center gap-2 px-3 py-1.5 shrink-0"
                style={{ "border-bottom": "1px solid var(--border-base)" }}
              >
                <For each={terminal.sessions()}>
                  {(session) => (
                    <div
                      onClick={() => terminal.setActive(session.id)}
                      class="flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer"
                      style={{
                        background: terminal.active() === session.id ? "var(--surface-inset)" : "transparent",
                        color: terminal.active() === session.id ? "var(--text-strong)" : "var(--text-weak)",
                      }}
                    >
                      <SquareTerminal class="w-3 h-3" />
                      {session.title}
                      <button
                        onClick={(e) => { e.stopPropagation(); terminal.close(session.id); }}
                        class="ml-1 p-0.5 rounded"
                        style={{ color: "var(--icon-weak)" }}
                      >
                        <XIcon class="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  onClick={() => terminal.create(directory)}
                  class="p-1 rounded"
                  style={{ color: "var(--icon-weak)" }}
                  title="New Terminal"
                >
                  <Plus class="w-4 h-4" />
                </button>
              </div>

              {/* Terminal content */}
              <div class="flex-1 overflow-hidden">
                <For each={terminal.sessions()}>
                  {(session) => (
                    <div
                      class="size-full"
                      style={{ display: terminal.active() === session.id ? "block" : "none" }}
                    >
                      <Terminal ptyId={session.id} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>

      <Show when={device.isMobile() && mentionPath() !== null}>
        <Portal>
          <div
            class="mobile-overlay items-center justify-center p-4"
            style={{ "z-index": 80, background: "rgba(0,0,0,0.5)" }}
          >
            <FileMentionDialog
              open={true}
              portal={false}
              path={mentionPath() ?? ""}
              initialSelection={mentionSelection() ?? undefined}
              onSubmit={submitFileMention}
              onClose={closeFileMention}
            />
          </div>
        </Portal>
      </Show>
    </Show>
  );
}

function SavePromptDialog(props: {
  title: () => string
  setTitle: (v: string) => void
  onSave: () => void | Promise<void>
  onClose: () => void
}) {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  let titleRef: HTMLInputElement | undefined;

  createEffect(() => {
    const el = container();
    if (!el) return;

    // Focus title input on open
    titleRef?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = el!.querySelectorAll<HTMLElement>(
        'input, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    onCleanup(() => document.removeEventListener("keydown", handleKey));
  });

  return (
    <Portal>
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.5)" }}
        role="presentation"
      >
        <div
          ref={setContainer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-prompt-dialog-title"
          class="w-full max-w-sm rounded-lg shadow-xl overflow-hidden"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
          }}
        >
          <div
            class="px-4 py-3"
            style={{
              "border-bottom": "1px solid var(--border-base)",
            }}
          >
            <h2
              id="save-prompt-dialog-title"
              class="text-base font-medium"
              style={{ color: "var(--text-strong)" }}
            >
              Save as Prompt
            </h2>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label
                class="block text-sm font-medium mb-1"
                style={{ color: "var(--text-base)" }}
              >
                Title
              </label>
              <input
                ref={titleRef}
                type="text"
                value={props.title()}
                onInput={(e) =>
                  props.setTitle(e.currentTarget.value)
                }
                placeholder="Prompt title"
                class="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                }}
                onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      try {
                        await props.onSave();
                      } catch (err) {
                        console.error("SavePromptDialog: save failed", err);
                      }
                    }
                  }}
              />
            </div>
            <p class="text-xs" style={{ color: "var(--text-weak)" }}>
              The current input text will be saved as the prompt body.
            </p>
          </div>
          <div
            class="px-4 py-3 flex justify-end gap-2"
            style={{
              "border-top": "1px solid var(--border-base)",
            }}
          >
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
              style={{
                background: "var(--surface-inset)",
                color: "var(--text-base)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!props.title().trim()}
              onClick={async () => {
                  try {
                    await props.onSave();
                  } catch (err) {
                    console.error("SavePromptDialog: save failed", err);
                  }
                }}
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50"
              style={{
                background: "var(--interactive-base)",
                color: "white",
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
