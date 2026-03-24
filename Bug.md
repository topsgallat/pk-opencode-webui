# Bug Report & Fix Summary: File Editor Issues

## สถานะ: ✅ แก้ไขเสร็จสมบูรณ์ (2026-03-23)

---

## Bug #1: "file is not defined" Error เมื่อสร้างไฟล์ใหม่

### อาการ
- สร้างไฟล์ใหม่ผ่าน New File Dialog → ไฟล์ถูกสร้างบน disk สำเร็จ
- แต่ UI แสดง error "file is not defined" และ editor ไม่โหลดไฟล์ใหม่

### สาเหตุ
ฟังก์ชัน `handleNewFileCreated` ใน `review-panel.tsx` เรียกใช้ `file.setContent()` และ `file.tree.list()` แต่ **ไม่ได้ import หรือเรียก `useFile()` hook** → ตัวแปร `file` ไม่มีอยู่ → เกิด `ReferenceError`

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/review-panel.tsx`

```diff
+ import { useFile } from "../context/file"

  export function ReviewPanel(props: ReviewPanelProps) {
    const { client, directory } = useSDK();
    const events = useEvents();
    const layout = useLayout();
+   const file = useFile();
```

---

## Bug #2: Upstream API Fallback สำหรับไฟล์ที่สร้างผ่าน Extended API

### อาการ
- ไฟล์ที่สร้างผ่าน `/api/ext/file` (Extended API) อาจไม่สามารถโหลดได้ผ่าน upstream OpenCode API (`/file/content`)
- เมื่อ upstream API ล้มเหลว UI แสดง error แทนที่จะลองอ่านจาก Extended API

### สาเหตุ
`loadFile()` ใน `file.tsx` เรียกเฉพาะ upstream OpenCode API (`client.file.read()`) → ถ้า upstream ไม่รู้จักไฟล์ → error โดยไม่มี fallback

### วิธีแก้
**ไฟล์**: `app-prefixable/src/context/file.tsx`

เพิ่ม fallback chain ใน `loadFile()`:
1. ลอง upstream API (`client.file.read()`) ก่อน
2. ถ้าล้มเหลว → ลอง Extended API (`readFile()` จาก `/api/ext/file`)
3. ถ้าล้มเหลวอีก → restore content ที่ `setContent()` เซ็ทไว้ก่อนหน้า
4. ถ้าไม่มีเลย → แสดง error

```typescript
.catch(async (e) => {
  // Fallback 1: try extended API
  const extData = await readFile(url, path)
  if (extData) { /* set content from ext API */ return }
  
  // Fallback 2: restore previously set content
  if (existingContent) { /* restore */ return }
  
  // Final: show error
})
```

---

## Bug #3: Monaco Editor ไม่แสดงเนื้อหา (DOM Conflict)

### อาการ
- กดปุ่ม Edit → Monaco Editor เปิดขึ้นมา แต่หน้าจอว่างเปล่า
- Console log ยืนยันว่า content ถูกส่งไปถูกต้อง (value length > 0) และ container มีขนาด (width x height)
- **แต่ Monaco ไม่ render เนื้อหาใดๆ**

### สาเหตุ (Root Cause)
ปัญหาอยู่ที่ **DOM ownership conflict** ระหว่าง Monaco Editor กับ SolidJS:

```tsx
// ❌ โค้ดเดิม - ปัญหา!
<div ref={containerRef}>        ← Monaco ยึดครอง div นี้
  <Show when={!ready()}>        ← SolidJS ก็จัดการ children ใน div เดียวกัน!
    <div>Loading editor...</div>
  </Show>
</div>
```

`monaco.editor.create(containerRef)` ยึดครอง container div ทั้งหมดและจัดการ child nodes ภายในเอง แต่ SolidJS `<Show>` ก็จัดการ child nodes ใน div เดียวกัน → เมื่อ `setReady(true)` ทำให้ SolidJS ลบ loading div → **Monaco ถูกรบกวนและ render ผิดพลาดโดยไม่แสดง error**

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/monaco-editor.tsx`

แยก div ออกเป็น 2 ส่วนที่ไม่ overlap กัน:

```tsx
// ✅ โค้ดที่แก้แล้ว
<div class="w-full relative" style={{ height: "100%" }}>
  {/* SolidJS จัดการ loading overlay (absolute positioned) */}
  <Show when={!ready()}>
    <div class="absolute inset-0 z-10">Loading editor...</div>
  </Show>
  
  {/* Monaco จัดการ container นี้โดยเฉพาะ - ไม่มี SolidJS children */}
  <div ref={monacoContainerRef} class="w-full h-full" />
</div>
```

**โครงสร้าง DOM**:
```
wrapper div (position: relative)
├── loading overlay (position: absolute, z-10) ← SolidJS จัดการ
└── monacoContainerRef div (clean)              ← Monaco จัดการ
```

---

## Bug #4: Monaco ใช้ Custom Theme ที่ไม่มีอยู่จริง

### อาการ
- Monaco Editor อาจล้มเหลวตอน initialize เพราะหา theme ไม่เจอ

### สาเหตุ
โค้ดเดิมใช้ theme `"opencode-dark"` และ `"opencode-light"` ซึ่ง**ไม่เคยถูกลงทะเบียน** (`monaco.editor.defineTheme()` ไม่เคยถูกเรียก)

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/monaco-editor.tsx`

```diff
- theme: isDark ? "opencode-dark" : "opencode-light",
+ theme: isDark ? "vs-dark" : "vs",
```

ใช้ built-in themes ของ Monaco (`vs-dark` / `vs`) แทน

---

## Bug #5: EditorDialog ส่ง Content ไป Monaco ไม่ทัน (Timing Issue)

### อาการ
- เปิด Editor Dialog → Monaco สร้างด้วย `value: ""` (ว่างเปล่า)
- Content จริงถูก set ผ่าน `createEffect` **หลังจาก** Monaco mount ไปแล้ว

### สาเหตุ
ใน `EditorDialog`:
```typescript
createEffect(() => {
  if (props.open) {
    setEditContent(props.content)  // ← ทำงานหลัง Monaco mount
  }
})
```
SolidJS `createEffect` ทำงาน**หลัง** render ครั้งแรก → Monaco ถูกสร้างก่อนที่ `editContent()` จะได้ค่าจาก `props.content`

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/editor-dialog.tsx`

เพิ่ม `editorKey` signal ที่ bump ทุกครั้งที่ dialog เปิด → **บังคับ Monaco re-create ใหม่** ด้วย content ที่ถูกต้อง:

```typescript
const [editorKey, setEditorKey] = createSignal(0)

createEffect(() => {
  if (props.open) {
    setEditContent(props.content)
    setEditorKey((k) => k + 1)  // ← force Monaco re-create
  }
})

// ใน JSX:
<MonacoEditor key={editorKey()} value={editContent()} ... />
```

---

## Bug #6: EditorDialog Container Height ใน Portal

### อาการ
- Monaco Editor อาจแสดงขนาด 0 หรือ collapse เพราะ flex layout ใน Portal ไม่ทำงานถูกต้อง

### สาเหตุ
ใช้ `flex-1 min-h-0` สำหรับ editor container ใน Portal → Portal render นอก DOM tree ปกติ → `flex-1` ต้องการ parent มี explicit height → Monaco อาจไม่ได้รับขนาดที่ถูกต้อง

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/editor-dialog.tsx`

```diff
- <div class="flex-1 min-h-0" style={{ "min-height": "500px" }}>
+ <div style={{ height: "calc(100vh - 90px)", width: "100%", position: "relative" }}>
```

ใช้ `calc(100vh - 90px)` ให้ขนาดชัดเจน 100% แทน flex

---

## Bug #7: SolidJS Store Reactivity ไม่ Trigger Re-render

### อาการ
- ข้อมูลไฟล์โหลดมาสำเร็จ (ยืนยันจาก console.log) แต่ UI ไม่อัปเดต
- `state()?.content?.content` ดึงข้อมูลลึก 3 ชั้นจาก SolidJS Store proxy

### สาเหตุ
SolidJS Store proxy อาจ "หลุดการติดตาม (lose tracking)" เมื่อข้อมูลถูกเปลี่ยนแบบ deep nested ผ่าน `produce()` → `<Match when={state()?.loaded}>` และ `<ContentCode code={content()} />` ไม่ถูก trigger ให้ re-render

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/file-viewer.tsx`

เปลี่ยนจากการอ่าน Store proxy โดยตรง → ใช้ **explicit `createSignal`** ที่ถูก sync จาก Store ผ่าน `createEffect`:

```typescript
// ✅ Explicit signals ที่รับประกัน reactivity
const [fileLoading, setFileLoading] = createSignal(false)
const [fileLoaded, setFileLoaded] = createSignal(false)
const [fileError, setFileError] = createSignal<string | undefined>(undefined)
const [fileContent, setFileContent] = createSignal("")

createEffect(() => {
  const s = file.get(props.path)
  setFileLoading(!!s?.loading)
  setFileLoaded(!!s?.loaded)
  setFileError(s?.error)
  setFileContent(s?.content?.content ?? "")
  
  if (!s?.loaded && !s?.loading) {
    void file.load(props.path)
  }
})

// ใน JSX ใช้ signals แทน:
<Match when={fileLoaded()}>
  <ContentCode code={fileContent()} lang={lang()} />
</Match>
```

---

## Bug #8: บันทึกไฟล์ไปผิดที่ (Wrong Path Resolution)

### อาการ
- กด Save ใน Editor → API ตอบ `{"success": true}` แต่ไฟล์จริงไม่เปลี่ยน
- Server log แสดง: `[ExtAPI] file write: /home/sgallat/README.md` แทนที่จะเป็น `/home/sgallat/pk-opencode-webui/README.md`

### สาเหตุ
`handleSave()` ส่ง `props.path` (relative path เช่น `README.md`) ไปที่ Extended API โดยตรง → Extended API ใช้ `OPENCODE_WORKSPACE_ROOT` (`/home/sgallat`) เป็น root → resolve ได้ `/home/sgallat/README.md` → **เขียนผิดที่!**

```
props.path = "README.md"
OPENCODE_WORKSPACE_ROOT = "/home/sgallat"
Resolved path = "/home/sgallat/README.md"         ← ผิด!
Expected path = "/home/sgallat/pk-opencode-webui/README.md"  ← ถูก!
```

### วิธีแก้
**ไฟล์**: `app-prefixable/src/components/file-viewer.tsx`

ดึง `directory` จาก SDK context (ซึ่งเป็น project directory) แล้ว prepend ก่อน relative path:

```typescript
const { directory } = useSDK()

async function handleSave(newContent: string) {
  const fullPath = directory && !props.path.startsWith("/")
    ? `${directory}/${props.path}`
    : props.path
  
  const res = await fetch(`${serverUrl}/api/ext/file`, {
    body: JSON.stringify({ path: fullPath, content: newContent }),
    ...
  })
}
```

---

## Bug #9: Browser Cache ทำให้ไม่ได้รับโค้ดที่อัปเดต

### อาการ
- แก้ไขโค้ดและ rebuild Docker image แล้ว แต่ browser ยังใช้โค้ดเวอร์ชันเก่า
- ต้องกด Ctrl+Shift+R (hard refresh) ทุกครั้ง

### สาเหตุ
`serve-ui.ts` ส่ง Cache-Control header แบบ aggressive สำหรับ static assets:
```
Cache-Control: public, max-age=31536000, immutable
```
→ Browser จำไฟล์ JS/CSS ไว้ 1 ปี → ไม่ดาวน์โหลดเวอร์ชันใหม่

### วิธีแก้
**ไฟล์**: `docker/serve-ui.ts`

1. เปลี่ยน Cache-Control เป็น `must-revalidate`:
```diff
- "Cache-Control": "public, max-age=31536000, immutable"
+ "Cache-Control": "public, max-age=0, must-revalidate"
```

2. เพิ่ม cache buster ใน index.html โดยใช้ server start time:
```typescript
const serverStartTime = Date.now()
const cacheBuster = `?v=${serverStartTime}`

const injected = indexHtml
  .replace('src="./entry.js"', `src="./entry.js${cacheBuster}"`)
  .replace('href="./entry.css"', `href="./entry.css${cacheBuster}"`)
```

→ ทุกครั้งที่ container restart → entry files ได้ URL ใหม่ → browser ดาวน์โหลดโค้ดล่าสุด

---

## ไฟล์ที่ถูกแก้ไขทั้งหมด

| ไฟล์ | Bugs ที่แก้ |
|---|---|
| `app-prefixable/src/components/review-panel.tsx` | #1 (useFile import) |
| `app-prefixable/src/context/file.tsx` | #2 (fallback), #7 (store init) |
| `app-prefixable/src/components/monaco-editor.tsx` | #3 (DOM conflict), #4 (theme) |
| `app-prefixable/src/components/editor-dialog.tsx` | #5 (timing), #6 (height) |
| `app-prefixable/src/components/file-viewer.tsx` | #7 (reactivity), #8 (save path) |
| `docker/serve-ui.ts` | #9 (cache) |
| `app-prefixable/src/components/diff/content-code.tsx` | เพิ่ม error handling สำหรับ Shiki |
| `app-prefixable/src/components/diff/content-code.css` | เพิ่ม fallback text color |

---

## บทเรียนที่ได้

1. **SolidJS Store + deep nested access**: อย่า chain `.?.` ลึกเกิน 2 ชั้นในการ track reactivity จาก Store → ใช้ explicit `createSignal` แทน
2. **Monaco Editor + SolidJS**: ห้ามให้ SolidJS จัดการ children ใน container div เดียวกับที่ Monaco ใช้ → แยก div ให้ชัดเจน
3. **Relative vs Absolute path**: Extended API ใช้ `OPENCODE_WORKSPACE_ROOT` เป็น root → ต้อง prepend project directory ก่อน relative path
4. **Browser caching**: อย่าใช้ `immutable` cache header สำหรับ assets ที่อาจเปลี่ยนบ่อย → ใช้ cache buster แทน
5. **createEffect timing**: `createEffect` ทำงานหลัง render → ถ้าต้องการให้ Monaco ได้ค่าตั้งแรก ต้อง force re-create ด้วย key
