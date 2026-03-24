import { createStore, produce } from "solid-js/store";
import { createRoot, createMemo, createEffect } from "solid-js";

createRoot(() => {
  const [store, setStore] = createStore<any>({ files: {} });

  const get = (path: string) => store.files[path];

  const setContent = (path: string, contentStr: string) => {
    setStore("files", path, produce((f: any) => {
      f.loaded = true;
      f.loading = false;
      f.content = { content: contentStr };
    }));
  };

  setStore("files", "test", { loading: true, loaded: false });

  const state = createMemo(() => get("test"));
  const content = createMemo(() => state()?.content?.content ?? "");

  createEffect(() => {
    console.log("Effect: content is now ->", content());
  });

  setTimeout(() => {
    console.log("Setting content...");
    setContent("test", "Hello World");
  }, 100);
});
