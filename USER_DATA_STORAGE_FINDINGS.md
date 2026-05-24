# User Data Storage Mechanisms in pk-opencode-webui

## Overview
This document summarizes all mechanisms for storing user data found in the pk-opencode-webui repository, a SolidJS frontend web UI for OpenCode that runs in Kubeflow Notebooks.

## Persistence Mechanisms Found

### 1. localStorage (Primary Client-Side Persistence)
Used extensively throughout the frontend (app-prefixable/src/) for storing:

**Authentication Data:**
- `app-prefixable/src/utils/server-auth.ts` - SERVER_AUTH_KEY (server credentials, API keys)
- `app-prefixable/src/context/server.tsx` - SERVERS_STORAGE_KEY (server configurations)
- `app-prefixable/src/app.tsx` - opencode.lastSession.* (last session data)

**UI State & Preferences:**
- `app-prefixable/src/components/terminal.tsx` - terminal theme persistence
- `app-prefixable/src/context/theme.tsx` - theme preference (light/dark/system)
- `app-prefixable/src/context/layout.tsx` - layout state (sidebar, pinned sessions)
- `app-prefixable/src/components/mobile-todo-tray.tsx` - hiding todo items state
- `app-prefixable/src/utils/notify.ts` - notification toggle states
- `app-prefixable/src/context/permission.tsx` - auto-accept permission state
- `app-prefixable/src/utils/sound.ts` - sound settings configuration

**User-Generated Content:**
- `app-prefixable/src/context/saved-prompts.tsx` - saved prompt library
- `app-prefixable/src/context/recent-projects.tsx` - recent projects list
- `app-prefixable/src/pages/home-layout.tsx` - project lists
- `app-prefixable/src/components/command-palette.tsx` - custom project names
- `app-prefixable/src/pages/session.tsx` - session selections and last session

**Configuration Data:**
- `app-prefixable/src/utils/extended-api.ts` - provider accounts
- `app-prefixable/src/utils/servers.ts` - server configurations
- `app-prefixable/src/context/providers.tsx` - AI model selections
- `app-prefixable/src/context/server.tsx` - server storage migration

### 2. sessionStorage (Session-Only Persistence)
Used for temporary data that doesn't need to persist across sessions:

- `app-prefixable/src/pages/layout.tsx` - "opencode.serverSwitchHome" flag
- `app-prefixable/src/pages/mobile-layout.tsx` - similar server switch usage
- `app-prefixable/src/pages/session.tsx` - SERVER_SWITCH_HOME_KEY handling, prompt storage/restoration
- `app-prefixable/e2e/queue-flow.spec.ts` - test code

### 3. Cookies
Used for authentication in backend proxy services:

- `shared/proxy-auth-session.ts` - parsing cookies for authentication
- `shared/provider-auth-session.ts` - parsing cookies for authentication

### 4. File System Writes
Used for saving user data to the filesystem:

**Extended API Functions:**
- `shared/extended-api.ts` - writeFile function for saving config via extended API
- `app-prefixable/src/pages/settings.tsx` - writeFile function usage for saving files
- `app-prefixable/src/components/file-viewer.tsx` - writeFile function usage for saving files

**Temporary File Creation:**
- `shared/anthropic-pricing.ts` - writeFile for temporary data
- `shared/openai-pricing.ts` - writeFile for temporary data
- `shared/copilot-model-multipliers.ts` - writeFile for temporary data

**Test & Patch Scripts:**
- `patch_app.js` - fs.writeFileSync for patching source
- `patch_settings.js` - fs.writeFileSync for patching source
- `tests/playwright/*.spec.ts` - fs.writeFileSync for test reports

### 5. SolidJS Store (Client-State Management)
References to solid-js store (not persistence, but client-side state management):
- Found in various context files (sync, events, config, etc.)

## What Was NOT Found
- No usage of IndexedDB or indexedDB
- No direct document.cookie manipulation in frontend code
- No database connections or persistent database storage

## Security Considerations
The most sensitive data stored includes authentication credentials (API keys, server passwords) which are kept in localStorage, making them:
- Accessible to any JavaScript running on the page
- Potentially vulnerable to XSS attacks
- Visible in browser developer tools

## Recommendations
1. Review localStorage usage for sensitive data in:
   - `app-prefixable/src/utils/server-auth.ts` (SERVER_AUTH_KEY)
   - `app-prefixable/src/context/server.tsx` (SERVERS_STORAGE_KEY)
   - `app-prefixable/src/app.tsx` (opencode.lastSession.*)

2. Consider more secure storage for credentials:
   - Using httpOnly cookies for authentication tokens
   - Implementing encryption for sensitive data in localStorage
   - Evaluating whether client-side persistence of credentials is necessary

3. For file persistence via writeFile, ensure proper validation and sanitization
4. Review test/patch scripts that write to filesystem for production security
5. Consider explicit user consent mechanisms for data persistence where appropriate

## Files Containing Persistence Mechanisms
(Partial list - see detailed findings above)
- app-prefixable/src/app.tsx
- app-prefixable/src/components/terminal.tsx
- app-prefixable/src/components/mobile-todo-tray.tsx
- app-prefixable/src/components/command-palette.tsx
- app-prefixable/src/context/saved-prompts.tsx
- app-prefixable/src/utils/extended-api.ts
- app-prefixable/src/utils/sound.ts
- app-prefixable/src/context/providers.tsx
- app-prefixable/src/utils/storage.ts
- app-prefixable/src/utils/notify.ts
- app-prefixable/src/context/permission.tsx
- app-prefixable/src/context/theme.tsx
- app-prefixable/src/utils/server-auth.ts
- app-prefixable/src/context/layout.tsx
- app-prefixable/src/context/recent-projects.tsx
- app-prefixable/src/pages/layout.tsx
- app-prefixable/src/pages/session.tsx
- app-prefixable/src/pages/settings.tsx
- app-prefixable/src/pages/home-layout.tsx
- app-prefixable/src/context/server.tsx
- app-prefixable/src/pages/mobile-layout.tsx
- app-prefixable/src/utils/servers.ts
- app-prefixable/src/components/file-viewer.tsx
- shared/proxy-auth-session.ts
- shared/provider-auth-session.ts
- shared/extended-api.ts
- shared/anthropic-pricing.ts
- shared/openai-pricing.ts
- shared/copilot-model-multipliers.ts