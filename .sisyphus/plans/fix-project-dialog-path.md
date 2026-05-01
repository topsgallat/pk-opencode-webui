# Fix: Project Dialog path handling for remote servers

## TL;DR
> **Summary**: Fix `toRemoteListPath()` to correctly list user's home directory instead of root when user types `~` or empty input in project picker on remote server
> **Deliverables**: Fixed path handling in project-dialog.tsx
> **Effort**: Small
> **Parallel**: NO
> **Critical Path**: Edit toRemoteListPath → Build → Test

## Context
After fixing server target URL detection, the project dialog now correctly routes requests to remote server. However typing `~` or starting with empty input shows root directories instead of user's home directory contents.

### Root Cause
`toRemoteListPath()` returns `"."` when directory equals home, which causes the file.list API to list root instead of home directory.

### API Behavior
- `GET /file?path=.` → lists root (`/`)
- `GET /file?path=home/sgallat` → lists `/home/sgallat` contents ✅

### Current Code (line 75-81)
```typescript
function toRemoteListPath(directory: string, home: string) {
  const key = trimTrailing(directory)
  const hn = trimTrailing(home)
  if (!key || key === "/" || key === hn) return "."
  if (key.startsWith(hn + "/")) return key.slice(hn.length + 1)
  return key
}
```

### Expected Fix
When user types `~` (which equals home), pass the home path without leading slash to the API.

## Fix Implementation

### File: app-prefixable/src/components/project-dialog.tsx

Change `toRemoteListPath()`:

```typescript
function toRemoteListPath(directory: string, home: string) {
  const key = trimTrailing(directory)
  const hn = trimTrailing(home)
  // Don't return "." - pass the actual path to the backend to list correct directory
  // When key equals home or is empty, use home path without leading slash
  if (!key || key === hn) return hn.slice(1)  // e.g., "/home/sgallat" -> "home/sgallat"
  if (key.startsWith(hn + "/")) return key.slice(hn.length + 1)
  // For absolute paths like "/", use empty string to list root
  if (key === "/") return ""
  return key
}
```

## Verification Steps

### Manual Test
1. Navigate to 8090 UI
2. Settings → Servers → Set "Remote 4096" as default
3. Open Project dialog
4. Type `~` → should show `/home/sgallat/` contents
5. Type `/home/sgallat/` → should show same contents
6. Type `/` → shows root directories

### Expected Results
| Input | Expected |
|-------|----------|
| `~` | AppData, .bun, .config, etc. (home dirs) |
| `/home/sgallat/` | Same as above |
| `/` | boot, data, dev, etc. (root dirs) |

## Commit
- Message: `fix: correct home directory listing in project dialog for remote servers`
- Files: `app-prefixable/src/components/project-dialog.tsx`