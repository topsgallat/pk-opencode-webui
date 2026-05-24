const fs = require('fs');
const code = fs.readFileSync('app-prefixable/src/pages/settings.tsx', 'utf8');

// 1. Add imports for server auth
let newCode = code.replace(
  /import {[^}]+ServerConfig,\n} from "\.\.\/utils\/servers"/,
  `$&
import {
  getServerAuth,
  setServerAuth,
  removeServerAuth,
  clearServerAuthRevalidation,
} from "../utils/server-auth"`
);

// 2. Add signals
newCode = newCode.replace(
  /const \[serverUrlInput, setServerUrlInput\] = createSignal\(""\)/,
  `const [serverUrlInput, setServerUrlInput] = createSignal("")
  const [serverUsernameInput, setServerUsernameInput] = createSignal("")
  const [serverPasswordInput, setServerPasswordInput] = createSignal("")`
);

// 3. Update openAddServerDialog
newCode = newCode.replace(
  /setServerUrlInput\(""\)\n    setServerError\(null\)/,
  `setServerUrlInput("")
    setServerUsernameInput("")
    setServerPasswordInput("")
    setServerError(null)`
);

// 4. Update openEditServerDialog
newCode = newCode.replace(
  /setServerUrlInput\(server\.url\)\n    setServerError\(null\)/,
  `setServerUrlInput(server.url)
    const auth = getServerAuth(server.id)
    setServerUsernameInput(auth?.username || "")
    setServerPasswordInput(auth?.password || "")
    setServerError(null)`
);

// 5. Update closeServerDialog
newCode = newCode.replace(
  /setServerUrlInput\(""\)\n    setServerError\(null\)/,
  `setServerUrlInput("")
    setServerUsernameInput("")
    setServerPasswordInput("")
    setServerError(null)`
);

// 6. Update probe URL logic to pass auth header if password provided
// actually "Add UI messaging hook points for protected probe responses (reachable/auth-required vs unreachable)"
// The probe check currently doesn't pass credentials, it just hits /api/ext/probe-server.
// wait, probe-server checks the host's /health. It doesn't pass credentials right now.
// I will skip changing the probe endpoint right now, but maybe I will handle the response `probe.status === 401`.
newCode = newCode.replace(
  /const probe: { ok: boolean; error\?: string } = await fetch/,
  `const probe: { ok: boolean; status?: number; error?: string } = await fetch`
);
newCode = newCode.replace(
  /if \(\!probe\.ok\) {\n\s+setServerWarn\(\`Server may be unreachable from this host: \$\{probe\.error \?\? "no response"\}\. Added anyway\.\`\)\n\s+\}/,
  `if (!probe.ok) {
        if (probe.status === 401 || probe.status === 403) {
          setServerWarn("Server is reachable but requires authentication. Credentials saved.")
        } else {
          setServerWarn(\`Server may be unreachable from this host: \${probe.error ?? "no response"}. Added anyway.\`)
        }
      }`
);

// 7. Save credentials in saveServerDialog
newCode = newCode.replace(
  /const server: ServerConfig = {\n\s+id: editingServer\(\)\?.id \?\? generateServerId\(\),\n\s+name,\n\s+url: cleanUrl,\n\s+isDefault: editingServer\(\)\?.isDefault \?\? servers\(\)\.length === 0,\n\s+}/,
  `const server: ServerConfig = {
      id: editingServer()?.id ?? generateServerId(),
      name,
      url: cleanUrl,
      isDefault: editingServer()?.isDefault ?? servers().length === 0,
    }

    const pwd = serverPasswordInput()
    if (pwd) {
      setServerAuth(server.id, {
        username: serverUsernameInput().trim() || "opencode",
        password: pwd,
        needsRevalidation: false
      })
      clearServerAuthRevalidation(server.id)
    } else {
      removeServerAuth(server.id)
    }`
);

// 8. Add inputs to the UI
newCode = newCode.replace(
  /<p class="text-xs mt-1" style={{ color: "var\(--text-weak\)" }}>\n\s+The base URL of your OpenCode backend\n\s+<\/p>\n\s+<\/div>\n\s+<\/div>/,
  `<p class="text-xs mt-1" style={{ color: "var(--text-weak)" }}>
                      The base URL of your OpenCode backend
                    </p>
                  </div>
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                        Username (optional)
                      </label>
                      <input
                        type="text"
                        value={serverUsernameInput()}
                        onInput={(e) => setServerUsernameInput(e.currentTarget.value)}
                        placeholder="opencode"
                        class="w-full px-3 py-2 rounded-md text-sm"
                        style={{
                          background: "var(--background-base)",
                          border: "1px solid var(--border-base)",
                          color: "var(--text-base)",
                        }}
                      />
                    </div>
                    <div class="flex-1">
                      <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                        Password
                      </label>
                      <input
                        type="password"
                        value={serverPasswordInput()}
                        onInput={(e) => setServerPasswordInput(e.currentTarget.value)}
                        placeholder="Leave blank for no auth"
                        class="w-full px-3 py-2 rounded-md text-sm"
                        style={{
                          background: "var(--background-base)",
                          border: "1px solid var(--border-base)",
                          color: "var(--text-base)",
                        }}
                      />
                    </div>
                  </div>
                </div>`
);

fs.writeFileSync('app-prefixable/src/pages/settings.tsx', newCode);
console.log('patched');
