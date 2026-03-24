# Roadmap: pk-opencode-webui Feature Development

## 1. Fullscreen Editor Mode ✅ IMPLEMENTED

**Status:** Complete

**Changes Made:**
- Added fullscreen state to `layout.tsx` context
- Created fullscreen overlay in `review-panel.tsx` with Portal
- Added keyboard shortcuts (F11, Ctrl/Cmd+Shift+F, Escape)
- Fixed Monaco layout with ResizeObserver

**Files Modified:**
- `app-prefixable/src/context/layout.tsx` - Added `editor.fullscreen` state
- `app-prefixable/src/components/review-panel.tsx` - Added fullscreen overlay
- `app-prefixable/src/components/monaco-editor.tsx` - Fixed resize handling
- `app-prefixable/src/pages/session.tsx` - Added keyboard shortcuts

---

## 2. Support Create New File ✅ IMPLEMENTED

**Status:** Complete

**Changes Made:**
- Created `new-file-dialog.tsx` component
- Added "New File" button (+) in All Files tab header
- Added context menu "New File" on right-click in file tree
- Integrated with existing `writeFile` from extended-api.ts

---

## 3. Mobile & Responsive UI ✅ IMPLEMENTED

**Status:** Complete

### 3.1 การวิเคราะห์ปัญหาปัจจุบัน

#### UI Structure ปัจจุบัน (Desktop Only):
```
┌──────────────────────────────────────────────┐
│ [Sidebar (256px)]  [Chat Area]  [Review/Info] │
│ ├─ Project Header  ├─ Header    ├─ Diff View  │
│ ├─ New Session     ├─ Messages  ├─ File Tree  │
│ ├─ Search          ├─ Input     └─ File View  │
│ └─ Session List    └─ Actions                  │
└──────────────────────────────────────────────┘
```

#### ปัญหาที่เกิดบน Mobile:
1. **Sidebar 256px + Chat ไม่ shrink** → บีบจอจนอ่านไม่ได้
2. **ResizeHandle drag** → ไม่ทำงานกับ touch event
3. **Review/Info panels** → ซ้อนทับจอ กินพื้นที่ทั้งหมด
4. **SessionHeader buttons** → เล็กเกินสำหรับนิ้วกด (< 44px)
5. **Textarea input** → keyboard pushes content ขึ้น แต่ไม่ scroll ตาม
6. **Slash command popover** → ตกออกนอกจอ
7. **Context menus** → ออกแบบสำหรับ mouse hover ไม่ใช่ touch
8. **Session list** → Hover effects, menu dots ไม่แสดงบน touch
9. **No viewport meta** → ไม่มี mobile viewport scale

### 3.2 แนวทาง: แยก Layout ระหว่าง Desktop กับ Mobile

ใช้ **User Agent + Window Width** ตรวจสอบ:
- **Desktop**: `width >= 768px` AND ไม่ใช่ mobile UA → ใช้ layout เดิม
- **Mobile**: `width < 768px` OR เป็น mobile UA → ใช้ Mobile layout

#### Mobile Layout แบบ Tab-based:
```
┌──────────────────┐
│ [Header Bar]     │ ← Project name + hamburger
├──────────────────┤
│                  │
│   Chat / Files   │ ← Full viewport content
│   / Sessions     │
│                  │
├──────────────────┤
│ [Chat] [Review]  │ ← Bottom tab bar
│ [Sessions] [⚙️]  │
└──────────────────┘
```

### 3.3 Implementation Plan

#### Phase 1: Device Detection & Context (แก้ 2 ไฟล์)

**ไฟล์ใหม่: `app-prefixable/src/context/device.tsx`**
```typescript
// Device context - provides isMobile(), isTablet(), isDesktop()
// Detection: User Agent + window.innerWidth
// Re-evaluates on resize (debounced 200ms)
// UA detection: /iPhone|iPad|iPod|Android|webOS|Mobile/i
```

**แก้ไฟล์: `app-prefixable/src/index.html`**
```html
<!-- เพิ่ม viewport meta tag -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, 
  maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

#### Phase 2: Mobile Layout Shell (แก้ 2 ไฟล์)

**ไฟล์ใหม่: `app-prefixable/src/pages/mobile-layout.tsx`**
- Bottom tab navigation: Chat, Sessions, Review, Settings
- Full-viewport content area per tab
- No sidebar — sessions appear as separate tab
- Hamburger menu for project switcher

**แก้ไฟล์: `app-prefixable/src/pages/layout.tsx`**
- ใน `Layout()` function: `<Show when={!isMobile()} fallback={<MobileLayout>...}>`
- Desktop layout เดิมไม่เปลี่ยน

#### Phase 3: Mobile Chat View (แก้ 2 ไฟล์)

**ไฟล์ใหม่: `app-prefixable/src/components/mobile-chat.tsx`**
- Simplified header: Back arrow + session title + model selector
- Full-width message timeline
- Input area pinned to bottom above keyboard
- Touch-friendly action buttons (min 44x44px)
- Swipe gestures: left = review panel, right = session list

**แก้ไฟล์: `app-prefixable/src/pages/session.tsx`**
- `<Show when={!isMobile()} fallback={<MobileChat />}>`
- ChatView ใช้ mobile version เมื่อ isMobile()
- Review/Info panels เป็น fullscreen overlay แทน side panel

#### Phase 4: Mobile Session List (แก้ 1 ไฟล์)

**ไฟล์ใหม่: `app-prefixable/src/components/mobile-sessions.tsx`**
- Full-screen session list
- Search bar at top (sticky)
- Touch-friendly session items (larger tap targets)
- Swipe-to-archive / swipe-to-delete
- Long-press for context menu (rename, pin, delete)
- Pull-to-refresh

#### Phase 5: Mobile Review Panel (แก้ 1 ไฟล์)

**ไฟล์ใหม่: `app-prefixable/src/components/mobile-review.tsx`**
- Full-screen diff viewer
- Tab bar: Changes / All Files (horizontal scroll)
- File content viewer with horizontal scroll for code
- Pinch-to-zoom for code viewing
- Back button to return to chat

#### Phase 6: Responsive CSS (แก้ 1 ไฟล์)

**แก้ไฟล์: `app-prefixable/src/index.css`**
```css
/* Mobile-specific styles */
@media (max-width: 767px) {
  /* Touch targets */
  button, a, [role="button"] {
    min-height: 44px;
    min-width: 44px;
  }
  
  /* Safe area insets for notched phones */
  .mobile-bottom-bar {
    padding-bottom: env(safe-area-inset-bottom);
  }
  
  /* Prevent zoom on input focus (iOS) */
  input, textarea, select {
    font-size: 16px !important;
  }
  
  /* Full-height accounting for mobile browser chrome */
  .mobile-viewport {
    height: 100dvh; /* dynamic viewport height */
  }
}
```

### 3.4 Component Architecture

```
App
├── DeviceProvider          ← NEW: provides isMobile(), isTablet()
│   ├── Desktop Path (existing)
│   │   └── Layout
│   │       ├── Sidebar (sessions)
│   │       ├── Content (chat/session)
│   │       ├── ReviewPanel (side)
│   │       └── InfoPanel (side)
│   │
│   └── Mobile Path (NEW)
│       └── MobileLayout
│           ├── MobileHeader (project + hamburger)
│           ├── MobileContent (tab-switched)
│           │   ├── Tab: MobileChat
│           │   │   ├── Message Timeline (full-width)
│           │   │   ├── Input Bar (bottom-pinned)
│           │   │   └── Slash Popover (bottom-sheet)
│           │   ├── Tab: MobileSessions
│           │   │   ├── Search (sticky top)
│           │   │   └── Session List (touch-friendly)
│           │   ├── Tab: MobileReview
│           │   │   ├── Changes/AllFiles tabs
│           │   │   ├── Diff Viewer
│           │   │   └── File Viewer
│           │   └── Tab: Settings
│           └── MobileTabBar (bottom nav)
```

### 3.5 Mobile-Specific UX Patterns

| Desktop Pattern | Mobile Replacement |
|---|---|
| Sidebar (hover menus) | Bottom tab + fullscreen session list |
| ResizeHandle (drag) | No panels, fullscreen views |
| Context menu (right-click) | Long-press menu / bottom sheet |
| Slash command popover | Bottom sheet picker |
| Tooltip (hover) | Long-press tooltip |
| Keyboard shortcuts | Touch gestures |
| Side panels (review/info) | Fullscreen overlay tabs |
| File picker dialog | Fullscreen file browser |

### 3.6 Key Technical Decisions

1. **Detect via UA + width** (not CSS media queries alone): 
   - CSS media queries สำหรับ styling เท่านั้น
   - JS detection สำหรับ conditional rendering (ไม่ render desktop components บน mobile)
   - ลด DOM size และ memory usage บน mobile

2. **100dvh instead of 100vh**:
   - `100vh` บน mobile browsers ไม่รวม address bar
   - `100dvh` (dynamic viewport height) ปรับตาม browser chrome ที่ซ่อน/แสดง

3. **Bottom navigation instead of sidebar**:
   - Thumb-zone friendly (ด้านล่างจอ)
   - มาตรฐาน mobile apps ทั่วไป
   - 4 tabs: Chat, Sessions, Review, Settings

4. **No drag/resize on mobile**:
   - Touch drag conflict กับ scroll
   - ใช้ fullscreen views แทน side panels

5. **Input handling**:
   - `font-size: 16px` ป้องกัน iOS auto-zoom
   - `env(safe-area-inset-bottom)` สำหรับ notched phones
   - Virtual keyboard detection via `visualViewport.resize`

### 3.7 Priority Order

1. ✅ Device context + viewport meta (foundation)
2. ✅ Mobile layout shell + bottom tabs (navigation)
3. ✅ Mobile chat view (core feature)
4. ⬜ Mobile session list (session management)
5. ⬜ Mobile review panel (code review)
6. ⬜ Responsive CSS polish (refinement)

### 3.8 Files to Create/Modify Summary

| Action | File | Description |
|---|---|---|
| **CREATE** | `src/context/device.tsx` | Device detection (UA + width) |
| **CREATE** | `src/pages/mobile-layout.tsx` | Mobile layout shell + tab bar |
| **CREATE** | `src/components/mobile-chat.tsx` | Mobile-optimized chat view |
| **CREATE** | `src/components/mobile-sessions.tsx` | Touch-friendly session list |
| **CREATE** | `src/components/mobile-review.tsx` | Fullscreen review/diff viewer |
| **MODIFY** | `src/index.html` | Add viewport meta |
| **MODIFY** | `src/pages/layout.tsx` | Conditional mobile/desktop render |
| **MODIFY** | `src/pages/directory-layout.tsx` | Wrap with DeviceProvider |
| **MODIFY** | `src/index.css` | Mobile-specific CSS |
| **MODIFY** | `src/app.tsx` | DeviceProvider at root |

---

## Implementation Order (Overall)

1. **Phase 1** - New File ✅ COMPLETE
2. **Phase 2** - Fullscreen Editor ✅ COMPLETE  
3. **Phase 3** - Mobile Responsive UI ✅ COMPLETE
4. **Phase 4** - Mobile UX Polish & Bug Fixes ✅ COMPLETE

---

## 4. Mobile UX Polish & Bug Fixes ✅ IMPLEMENTED

**Status:** Complete  
**Date:** 2026-03-24

### 4.1 หน้า Settings บนมือถือ (Settings Page on Mobile)

**ปัญหา:** หน้า Settings เมื่อเปิดบนมือถือจะแสดง Sidebar เมนูด้านซ้ายที่ออกแบบสำหรับ Desktop กินพื้นที่ครึ่งหน้าจอ ทำให้เนื้อหา Settings หลักแคบมาก

**วิธีแก้:**
- ซ่อน sidebar เมนูด้านซ้ายเมื่อ `device.isMobile()` เป็น `true`
- เพิ่ม **Dropdown Select** ที่ด้านบนของ content area แทน เพื่อให้สลับ tab ได้
- ใช้ `useDevice()` context ตรวจสอบ device

**ไฟล์ที่แก้:** `src/pages/settings.tsx`

---

### 4.2 Project Switcher บนมือถือ (Mobile Project Switching)

**ปัญหา:** Mobile Layout ซ่อน sidebar ซึ่งมีปุ่มสลับโปรเจกต์อยู่ ทำให้บนมือถือไม่มีทางเปลี่ยนโปรเจกต์ได้เลย

**วิธีแก้ (รอบ 1 — ถูก revert):** สร้าง header bar ด้านบน — แต่กินพื้นที่จอมากเกินไป

**วิธีแก้ (รอบ 2 — Final):**
- ย้ายปุ่ม Project Switcher ไปรวมไว้ใน **header ของ Sessions tab** แทน (ประหยัดพื้นที่)
- กดที่ชื่อโปรเจกต์ (มีลูกศรชี้ลง) → เปิด `ProjectDialog` ได้ทันที
- แก้บั๊กสำคัญ: `ProjectDialog` ถูกใส่อยู่ใน `<Show when={!isMobile()}>` ทำให้บน mobile dialog ไม่ถูก render เลย → แก้โดยย้าย `<ProjectDialog>` ออกมาอยู่นอก `<Show>` เป็น sibling ของ mobile/desktop layout

**ไฟล์ที่แก้:**
- `src/pages/mobile-layout.tsx` — เพิ่มปุ่มที่ Sessions tab header, เพิ่ม `onOpenProject` prop
- `src/pages/layout.tsx` — ย้าย `<ProjectDialog>` ออกนอก `<Show>`, ส่ง `onOpenProject` ให้ `MobileLayout`

---

### 4.3 Prompt Bar บนมือถือ (Mobile Prompt Input Bar)

**ปัญหา:** ปุ่ม Agent / Model / Token ใน bottom bar ของช่อง input ถูกซ่อนออกนอกจอบนมือถือ เพราะ container ใช้ `overflow-hidden` และ layout เป็น flex-row เดียวกับ attach buttons

**วิธีแก้ (รอบ 1 — ไม่สำเร็จ):** เปลี่ยนเป็น `flex-wrap` — แต่ไม่ทำงานเพราะ `SessionInfo` อยู่ใน `flex-1 min-w-0` ที่ browser บีบรวมทุกอย่างไว้ในแถวเดียว

**วิธีแก้ (รอบ 2 — Final):**
- เปลี่ยน bottom bar เป็น `flex-col` แทน `flex-row`
- **แถวบน:** ปุ่ม attach (Bookmark, Upload, Paperclip)
- **แถวล่าง:** `SessionInfo` เต็ม 100% ความกว้าง (Agent / Model / Tokens / Send)
- ผลลัพธ์: มองเห็นและกดได้ทุกปุ่มบนมือถือ

**ไฟล์ที่แก้:**
- `src/pages/session.tsx` — restructure bottom bar เป็น `flex-col`
- `src/components/session-info.tsx` — ปรับ padding และ flex layout

---

### 4.4 สรุป Files ที่แก้ในรอบที่ 1

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/pages/settings.tsx` | ซ่อน sidebar บน mobile, เพิ่ม Dropdown tab switcher |
| `src/pages/mobile-layout.tsx` | เพิ่ม `onOpenProject` prop, เพิ่มปุ่ม project switcher ใน Sessions header |
| `src/pages/layout.tsx` | ย้าย `<ProjectDialog>` ออกนอก `<Show>` เพื่อให้ mobile เข้าถึงได้ |
| `src/pages/session.tsx` | Restructure bottom bar เป็น `flex-col` |
| `src/components/session-info.tsx` | ปรับ padding และ flex layout ให้เหมาะกับมือถือ |

---

### 4.5 Terminal & Info Panel บนมือถือ

**ปัญหา:** ปุ่ม Terminal และ Info Panel ใน session header กดได้แต่ไม่มีอะไรเกิดขึ้นบนมือถือ เพราะ Panel ทั้งสองถูก render อยู่ใน Desktop layout เท่านั้น (ภายใน `<Show when={!device.isMobile()}>`)

**การแก้ไข Terminal:**
- เพิ่ม **Mobile Terminal Overlay** โดยใช้ `<Portal>` เหมือนกับ Review Panel
- เมื่อกดปุ่ม Terminal บนมือถือ จะเปิด Fullscreen overlay ที่มี:
  - Header bar แสดงชื่อ "Terminal" พร้อมปุ่มปิด (X)
  - Tab bar สำหรับ multiple terminal sessions
  - ปุ่ม New Terminal (+)
  - xterm.js terminal content

**การแก้ไข Info Panel:**
- ซ่อนปุ่ม Info Panel บนมือถือด้วย Tailwind `hidden sm:flex` เพราะยังไม่มี overlay รองรับ (หน้าจอแคบเกินไป)
- Desktop ยังคงใช้งานได้ปกติ

**ไฟล์ที่แก้:**
- `src/pages/session.tsx` — Import `Terminal` component,เพิ่ม Mobile Terminal Overlay Portal
- `src/components/session-header.tsx` — ซ่อนปุ่ม Info Panel ด้วย `hidden sm:flex`

---

### 4.6 Rich Thinking/Processing Status (การแสดงสถานะ Thinking แบบละเอียด)

**ปัญหา:** เมื่อ AI ใช้เวลานานในการ "คิด" (Thinking) หรือติดปัญหา Quota/Rate Limit (Retry) ผู้ใช้งานจะไม่ทราบสถานะที่ชัดเจนว่าเกิดอะไรขึ้น หรือต้องรอนานเท่าไหร่

**วิธีแก้:**
- แก้ไข `MessageTimeline` ให้รับ `sessionStatus` จาก SSE (Server-Sent Events)
- เพิ่มคอมโพเนนต์ **`ProcessingIndicator`** ที่แสดงสถานะ 2 แบบ:
  1. **Thinking (Busy):** แสดง Spinner และข้อความ "Thinking..." ปกติ
  2. **Retrying (Retry):** แสดงแถบสีเหลืองแจ้งเตือน (Warning), แสดงข้อความ Error จริง (เช่น *Too Many Requests*), และแสดง **Countdown Timer** นับถอยหลังวินาทีที่จะเริ่มลองใหม่ (Retry) แบบ Real-time
- ช่วยให้ User Experience โปร่งใสขึ้น ไม่รู้สึกว่าแอปค้าง

**ไฟล์ที่แก้:**
- `src/components/message-timeline.tsx` — เพิ่ม `ProcessingIndicator` และโค้ดนับถอยหลัง
- `src/pages/session.tsx` — ส่ง `sessionStatus` และปรับปรุงสถานะ UI
- `src/index.css` — เพิ่ม CSS variables สำหรับสถานะ (Warning/Critical) และ Animation

---

### 4.7 Unified Global Toast System (ระบบแจ้งเตือนแบบรวมศูนย์)

**ปัญหา:** Server ส่งเหตุการณ์สำคัญ (เช่น *Context Limit Hit*) ผ่าน `tui.toast.show` แต่ฝั่ง Client ยังไม่ได้ดักจับเพื่อแสดงผล ทำให้ User พลาดข้อมูลสำคัญ

**วิธีแก้:**
- อัปเกรดระบบ Toast ใน `session.tsx` ให้รองรับหัวข้อ (Title) และสถานะหลายแบบ (Info, Success, Warning, Error)
- เพิ่ม Event Listener ดักฟังเหตุการณ์ `tui.toast.show` จาก Server ทั่วระบบ
- ปรับปรุง UI Toast:
  *   แสดงแถบสีตามสถานะ (เช่น Warning = เหลือง)
  *   **Sticky/Longer Duration:** ปรับให้ Error/Warning แสดงผลนานขึ้น (8 วินาที) เพื่อให้อ่านทัน
  *   **Manual Close:** เพิ่มปุ่มปิด (X) ให้ User กดปิดเองได้ทันที
- รองรับ **`tui.session.select`** ทำให้ AI สามารถสั่งเปลี่ยนหน้า Session ให้ User ได้จากฝั่ง Server

---

### 4.8 Collapsible Thinking (การดูขั้นตอนการคิด)

**ปัญหา:** ผู้ใช้งานอยากเห็น "ลำดับการคิด" (Reasoning) ของ AI ในขณะที่กำลังทำงาน เพื่อความโปร่งใสและตรวจสอบได้

**วิธีแก้:**
- เพิ่มการรองรับ **`ReasoningPart`** ในระบบแสดงผลข้อความ
- สร้างคอมโพเนนต์ **`ReasoningPartDisplay`** เป็น Accordion (กล่องพับได้) ชื่อ **"Thought process"**
- เมื่อกดขยาย จะแสดงเนื้อหาการคิดของ AI (Thinking content) แบบ Italic พร้อม Markdown support
- ช่วยให้ User เข้าใจว่า AI กำลังวางแผนหรือวิเคราะห์ข้อมูลอย่างไรอยู่

- `src/components/tool-part.tsx` — เพิ่ม `ReasoningPartDisplay` และอัปเกรด `MessageParts` พร้อมระบบ **Auto-expand**
- `src/components/message-timeline.tsx` — อัปเดตการแสดงผลส่วนท้ายของข้อความ Assistant

---

### 4.9 Real-time Thinking & Adaptive Message Synthesis (การแสดงผลการลำดับความคิดแบบทันที)

**ปัญหา:** ข้อมูลการคิด (Thinking/Reasoning) และการใช้ Tool บางครั้งไม่แสดงผลแบบ Real-time (Empty box) หรือแสดงล่าช้าเนื่องจาก Client รอคำสั่งสร้างข้อความจาก Server ก่อน

**วิธีแก้:**
- **Streaming Deltas Support:** เพิ่มการรองรับเหตุการณ์ `message.part.delta` ใน `SyncContext` เพื่อให้ข้อความค่อยๆ ไหลออกมา (Streaming) ตั้งแต่วินาทีแรกที่ AI เริ่มพิมพ์
- **Adaptive Synthesis:** เปลี่ยน Logic ในการรับข้อมูลให้สามารถ "สร้างกล่องข้อความจำลอง" (Synthesize placeholder message) ได้ทันทีที่มีข้อมูล Reasoning หรือ Tool ส่งมา แม้ว่าคำสั่งสร้างข้อความหลักจะยังมาไม่ถึงก็ตาม
- **Instant Transparency:** ทำให้ User เห็นทุกย่างก้าวที่ AI กำลังทำ โดยไม่มีอาการ "ค้าง" หรือ "กล่องว่าง" (Empty state) ระหว่างประมวลผล

**ไฟล์ที่แก้:**
- `src/context/sync.tsx` — เพิ่มการดักฟัง `message.part.delta` และ Logic การสร้างข้อความแบบจำลอง
- `src/components/tool-part.tsx` — เพิ่มระบบ **Auto-expand** ให้กางกล่อง Thought Process ออกทันทีเมื่อมีข้อมูลไหลเข้ามา