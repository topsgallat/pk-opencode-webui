import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import { reconcile } from "solid-js/store";
import { createStore } from "solid-js/store";
import { ChevronRight, Eye, File, FileCode, Folder, GitBranch, X } from "lucide-solid";
import { Spinner } from "./ui/spinner";
import { Markdown } from "./markdown";
import { listGitFiles, listGitTree, readGitFile, gitRawFileUrl, type GitTreeEntry } from "../utils/extended-api";
import { resolveRepoRelativePath, rewriteMarkdownImages } from "../utils/markdown-images";

const SEARCH_MATCH_LIMIT = 300;

interface BranchFileTreeProps {
  serverUrl: string;
  directory: string;
  branch: string;
  query?: string;
  targetUrl?: string;
}

function sortEntries(list: GitTreeEntry[]): GitTreeEntry[] {
  return [...list].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
}

/**
 * Read-only file browser for a git branch that is not checked out.
 * Lists directories via /api/ext/git/tree and previews file content via
 * /api/ext/git/file — never touches the working tree.
 */
export function BranchFileTree(props: BranchFileTreeProps) {
  const [dirs, setDirs] = createStore<Record<string, GitTreeEntry[]>>({});
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = createSignal(false);
  const [treeError, setTreeError] = createSignal<string | null>(null);
  const [allFiles, setAllFiles] = createSignal<string[] | null>(null);
  const [matches, setMatches] = createSignal<string[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);

  const [previewPath, setPreviewPath] = createSignal<string | null>(null);
  const [previewContent, setPreviewContent] = createSignal<string | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [markdownPreview, setMarkdownPreview] = createSignal(true);

  const isMarkdown = createMemo(() => !!previewPath()?.toLowerCase().endsWith(".md"));

  const markdownBaseDir = createMemo(() => {
    const p = previewPath() ?? "";
    const idx = p.lastIndexOf("/");
    return idx === -1 ? "" : p.slice(0, idx);
  });

  function markdownImageUrl(target: string): string | null {
    const cleaned = target.replace(/^<|>$/g, "").trim().split("#")[0];
    if (!cleaned || /^(https?:|data:|blob:|mailto:)/i.test(cleaned)) return null;
    const resolved = resolveRepoRelativePath(markdownBaseDir(), cleaned);
    if (!resolved) return null;
    return gitRawFileUrl(props.serverUrl, props.directory, props.branch, resolved, props.targetUrl);
  }

  const renderedContent = createMemo(() =>
    isMarkdown() && markdownPreview()
      ? rewriteMarkdownImages(previewContent() ?? "", markdownImageUrl)
      : previewContent(),
  );

  const inflight = new Map<string, Promise<void>>();
  let searchVersion = 0;
  let previewVersion = 0;

  async function loadDir(dir: string) {
    if (untrack(() => dirs[dir] || inflight.has(dir))) return;
    const promise = (async () => {
      const list = await listGitTree(props.serverUrl, props.directory, props.branch, dir, props.targetUrl);
      inflight.delete(dir);
      if (list) {
        setDirs(dir, sortEntries(list));
        setTreeError(null);
      } else if (dir === "") {
        setTreeError("Failed to load branch files");
      }
    })();
    inflight.set(dir, promise);
    await promise;
  }

  // Reset and reload whenever the branch changes
  createEffect(() => {
    const branch = props.branch;
    if (!branch) return;
    setDirs(reconcile({}));
    setExpanded(reconcile({}));
    setTreeError(null);
    setAllFiles(null);
    setMatches([]);
    closePreview();
    setRootLoading(true);
    void loadDir("").finally(() => setRootLoading(false));
  });

  createEffect(() => {
    const q = (props.query ?? "").trim().toLowerCase();
    const branch = props.branch;
    if (!q || !branch) {
      setSearchLoading(false);
      setMatches([]);
      return;
    }
    const version = ++searchVersion;
    setSearchLoading(true);
    const cached = allFiles();
    void (async () => {
      let files = cached;
      if (!files) {
        const fetched = await listGitFiles(props.serverUrl, props.directory, branch, props.targetUrl);
        if (version !== searchVersion) return;
        files = fetched ?? [];
        setAllFiles(files);
      }
      if (version !== searchVersion) return;
      setMatches(files.filter((f) => f.toLowerCase().includes(q)).sort());
      setSearchLoading(false);
    })();
  });

  function toggleDir(path: string) {
    const next = !expanded[path];
    setExpanded(path, next);
    if (next) void loadDir(path);
  }

  async function openFile(path: string) {
    const version = ++previewVersion;
    setPreviewPath(path);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setMarkdownPreview(true);
    const res = await readGitFile(props.serverUrl, props.directory, props.branch, path, props.targetUrl);
    if (version !== previewVersion) return;
    setPreviewLoading(false);
    if (res.content !== undefined) setPreviewContent(res.content);
    else setPreviewError(res.error ?? "Failed to load file");
  }

  function closePreview() {
    previewVersion++;
    setPreviewPath(null);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  function renderNodes(dir: string, depth: number) {
    return (
      <For each={dirs[dir]}>
        {(entry) => (
          <Show
            when={entry.type === "dir"}
            fallback={
              <button
                type="button"
                onClick={() => void openFile(entry.path)}
                class="w-full min-h-[44px] flex items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{
                  "padding-left": `${Math.max(0, 6 + depth * 12 + 16)}px`,
                  background: previewPath() === entry.path ? "var(--surface-interactive-hover)" : undefined,
                  "border-color": "transparent",
                }}
              >
                <File class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                <span class="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--text-base)" }}>
                  {entry.name}
                </span>
              </button>
            }
          >
            <div>
              <button
                type="button"
                onClick={() => toggleDir(entry.path)}
                class="w-full min-h-[44px] flex items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{
                  "padding-left": `${Math.max(0, 6 + depth * 12)}px`,
                  "border-color": "transparent",
                }}
              >
                <ChevronRight
                  class="w-4 h-4 shrink-0 transition-transform"
                  classList={{ "rotate-90": !!expanded[entry.path] }}
                  style={{ color: "var(--icon-weak)" }}
                />
                <Folder class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                <span class="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--text-base)" }}>
                  {entry.name}
                </span>
              </button>
              <Show when={expanded[entry.path]}>{renderNodes(entry.path, depth + 1)}</Show>
            </div>
          </Show>
        )}
      </For>
    );
  }

  const shownMatches = () => matches().slice(0, SEARCH_MATCH_LIMIT);

  return (
    <div class="flex flex-col">
      <Show
        when={previewPath()}
        fallback={
          <>
            <Show when={rootLoading() && !dirs[""]}>
              <div class="flex items-center justify-center gap-2 p-4">
                <Spinner class="w-4 h-4" />
                <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                  Loading branch files...
                </span>
              </div>
            </Show>
            <Show when={treeError()}>
              <div class="p-4 text-center text-xs" style={{ color: "var(--text-weak)" }}>
                {treeError()}
              </div>
            </Show>
            <Show when={props.query}>
              <Show when={searchLoading()}>
                <div class="px-1 py-1 text-[10px]" style={{ color: "var(--text-weak)" }}>
                  Searching files...
                </div>
              </Show>
              <For each={shownMatches()}>
                {(path) => (
                  <button
                    type="button"
                    onClick={() => void openFile(path)}
                    class="w-full min-h-[44px] flex items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{
                      "padding-left": "6px",
                      background: previewPath() === path ? "var(--surface-interactive-hover)" : undefined,
                      "border-color": "transparent",
                    }}
                  >
                    <File class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
                    <span class="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--text-base)" }} title={path}>
                      {path}
                    </span>
                  </button>
                )}
              </For>
              <Show when={matches().length > SEARCH_MATCH_LIMIT}>
                <div class="px-1 py-2 text-[10px]" style={{ color: "var(--text-weak)" }}>
                  Showing first {SEARCH_MATCH_LIMIT} of {matches().length} matches
                </div>
              </Show>
              <Show when={!searchLoading() && allFiles() !== null && matches().length === 0}>
                <div class="p-4 text-center text-xs" style={{ color: "var(--text-weak)" }}>
                  No matching files
                </div>
              </Show>
            </Show>
            <Show when={!props.query}>
              {renderNodes("", 0)}
            </Show>
          </>
        }
      >
        <div class="rounded overflow-hidden" style={{ border: "1px solid var(--border-base)" }}>
          <div
            class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
            style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate font-mono">{previewPath()}</span>
              <span
                class="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-1"
                style={{ background: "var(--interactive-base)", color: "var(--text-on-interactive)" }}
              >
                <GitBranch class="w-3 h-3" />
                {props.branch}
              </span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Show when={isMarkdown() && !previewLoading() && !previewError() && previewContent() !== null}>
                <button
                  type="button"
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded flex items-center justify-center"
                  onClick={() => setMarkdownPreview(!markdownPreview())}
                  title={markdownPreview() ? "Switch to source" : "Switch to preview"}
                  aria-label={markdownPreview() ? "Switch to source" : "Switch to preview"}
                  style={{ color: "var(--text-base)" }}
                >
                  <Show when={markdownPreview()} fallback={<Eye class="w-3.5 h-3.5" />}>
                    <FileCode class="w-3.5 h-3.5" />
                  </Show>
                </button>
              </Show>
              <button
                type="button"
                aria-label="Close preview"
                onClick={closePreview}
                class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                style={{ color: "var(--icon-weak)" }}
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div class="overflow-auto" style={{ "max-height": "calc(100vh - 240px)" }}>
            <Show when={previewLoading()}>
              <div class="flex items-center justify-center gap-2 p-4">
                <Spinner class="w-4 h-4" />
                <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                  Loading file...
                </span>
              </div>
            </Show>
            <Show when={!previewLoading() && previewError()}>
              <div class="p-3 text-xs" style={{ color: "var(--text-weak)" }}>
                {previewError()}
              </div>
            </Show>
            <Show when={!previewLoading() && !previewError() && previewContent() !== null}>
              <Show
                when={isMarkdown() && markdownPreview()}
                fallback={
                  <pre class="p-3 font-mono text-xs leading-6 whitespace-pre" style={{ color: "var(--text-base)" }}>
                    {previewContent()}
                  </pre>
                }
              >
                <div class="p-3">
                  <Markdown content={renderedContent() ?? ""} class="text-sm" />
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
