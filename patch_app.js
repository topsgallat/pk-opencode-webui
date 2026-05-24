const fs = require('fs');
const code = fs.readFileSync('app-prefixable/src/app.tsx', 'utf8');

// 1. Add imports
let newCode = code.replace(
  /import \{ GlobalEventsProvider \} from "\.\/context\/global-events"/,
  `import { GlobalEventsProvider } from "./context/global-events"
import { ServerAuthUIProvider } from "./context/server-auth-ui"
import { ServerAuthPromptManager } from "./components/server-auth-prompt"`
);

// 2. Wrap AppRoutes with ServerAuthUIProvider and add ServerAuthPromptManager inside ServerScopedApp
newCode = newCode.replace(
  /<CommandProvider>\s*<AppRoutes \/>\s*<\/CommandProvider>/,
  `<ServerAuthUIProvider>
            <CommandProvider>
              <AppRoutes />
              <ServerAuthPromptManager />
            </CommandProvider>
          </ServerAuthUIProvider>`
);

fs.writeFileSync('app-prefixable/src/app.tsx', newCode);
console.log('patched');
