import { codeToHtml, bundledLanguages } from "shiki";
import { createSignal, createEffect, Show } from "solid-js";
import { transformerNotationDiff } from "@shikijs/transformers";
import "./content-code.css";

// Cache for highlighted code to prevent re-highlighting on re-renders
const highlightCache = new Map<string, string>();

async function highlight(code: string, lang?: string): Promise<string> {
  const key = `${lang ?? "text"}:${code}`;
  const cached = highlightCache.get(key);
  if (cached) return cached;

  const html = await codeToHtml(code || "", {
    lang: lang && lang in bundledLanguages ? lang : "text",
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    transformers: [transformerNotationDiff()],
  });

  highlightCache.set(key, html);
  return html;
}

interface Props {
  code: string;
  lang?: string;
  flush?: boolean;
}

// Per-line fragments of a highlighted document, so consumers that display
// individual lines (e.g. diff rows) can highlight the whole text once instead
// of paying a shiki call per line.
export interface HighlightedLines {
  preClass: string;
  preStyle: string;
  lines: string[];
}

const linesCache = new Map<string, HighlightedLines | undefined>();

function parseHighlightedLines(html: string, code: string): HighlightedLines | undefined {
  if (typeof document === "undefined") return undefined;
  const template = document.createElement("template");
  template.innerHTML = html;
  const pre = template.content.querySelector("pre");
  if (!pre) return undefined;
  const lineNodes = pre.querySelectorAll("code > span.line");
  if (lineNodes.length !== code.split("\n").length) return undefined;
  const lines: string[] = [];
  for (const node of lineNodes) lines.push((node as HTMLElement).outerHTML);
  return {
    preClass: pre.getAttribute("class") ?? "",
    preStyle: pre.getAttribute("style") ?? "",
    lines,
  };
}

export function highlightToLines(code: string, lang?: string): Promise<HighlightedLines | undefined> {
  const key = `${lang ?? "text"}:${code}`;
  if (linesCache.has(key)) return Promise.resolve(linesCache.get(key));
  return highlight(code, lang).then((html) => {
    const parsed = parseHighlightedLines(html, code);
    linesCache.set(key, parsed);
    return parsed;
  });
}

export function useHighlightedLines(code: () => string, lang: () => string | undefined) {
  const [result, setResult] = createSignal<HighlightedLines | undefined>(undefined);

  createEffect(() => {
    const text = code();
    const key = lang();
    setResult(undefined);
    highlightToLines(text, key).then((parsed) => {
      if (code() === text && lang() === key) setResult(parsed);
    });
  });

  return result;
}

export function ContentCode(props: Props) {
  const cacheKey = () => `${props.lang ?? "text"}:${props.code}`;

  // Initialize with cached value if available
  const [html, setHtml] = createSignal(highlightCache.get(cacheKey()) ?? "");

  // Effect runs when code/lang changes
  createEffect(() => {
    const key = cacheKey();
    const cached = highlightCache.get(key);

    if (cached) {
      // Already cached - use immediately
      setHtml(cached);
    } else {
      // Need to highlight - clear current and fetch
      setHtml("");
      highlight(props.code, props.lang).then((result) => {
        // Only update if still the same key
        if (cacheKey() === key) {
          setHtml(result);
        }
      });
    }
  });

  return (
    <Show
      when={html()}
      fallback={
        <pre
          class="content-code"
          data-flush={props.flush === true ? true : undefined}
        >
          {props.code}
        </pre>
      }
    >
      <div
        innerHTML={html()}
        class="content-code"
        data-flush={props.flush === true ? true : undefined}
      />
    </Show>
  );
}
