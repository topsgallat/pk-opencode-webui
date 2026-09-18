import { createSignal, createEffect, Show } from "solid-js";
import { highlight, peekHighlight } from "./highlight-cache";
import { useInView } from "../../utils/in-view";
import "./content-code.css";

interface Props {
  code: string;
  lang?: string;
  flush?: boolean;
}

export function ContentCode(props: Props) {
  // Cached content paints immediately; uncached content is highlighted only
  // once the element approaches the viewport, and shows plain text until then.
  const { ref, inView } = useInView();
  const [html, setHtml] = createSignal(peekHighlight(props.code, props.lang) ?? "");

  // Effect runs when code/lang/visibility changes
  createEffect(() => {
    const text = props.code;
    const lang = props.lang;
    const cached = peekHighlight(text, lang);

    if (cached) {
      // Already cached - use immediately
      setHtml(cached);
      return;
    }
    if (!inView()) {
      setHtml("");
      return;
    }
    // Need to highlight - clear current and fetch
    setHtml("");
    highlight(text, lang).then((result) => {
      // Only update if still the same content
      if (props.code === text && props.lang === lang) {
        setHtml(result);
      }
    });
  });

  return (
    <Show
      when={html()}
      fallback={
        <pre
          ref={ref}
          class="content-code"
          data-flush={props.flush === true ? true : undefined}
        >
          {props.code}
        </pre>
      }
    >
      <div
        ref={ref}
        innerHTML={html()}
        class="content-code"
        data-flush={props.flush === true ? true : undefined}
      />
    </Show>
  );
}
