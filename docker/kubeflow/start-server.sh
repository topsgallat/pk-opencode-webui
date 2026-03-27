#!/bin/bash
set -e

# === Security: forbidden path & root checks ===
forbidden_path() {
  case "$1" in
    "/home/sgallat"*|"/Users/"*|"/root"|"/mnt/"*|"/media/"*|"/etc/"*|"/var/"*|"/tmp/host"*|"/Volumes/"*|"C:\\Users\\"*|"C:\\Windows\\"*|"D:\\"*|"E:\\"*|"F:\\"*|*sgallat*|*users*|*Documents\ and\ Settings*)
      return 0;;
    *)
      return 1;;
  esac
}
if [ "$(id -u)" = "0" ]; then
  echo "ERROR: Refusing to run as root. Please use a non-root container user."; exit 1
fi
for p in "$HOME" "$HOME_TMP"; do
  if [ -n "$p" ] && forbidden_path "$p"; then
    echo "ERROR: Detected forbidden host/user/system path in shell var: $p -- must be container-local only."; exit 1
  fi
done
# === End security checks ===

echo "=========================================="
echo "OpenCode Prefixable UI - Starting..."
echo "=========================================="

# Ensure directories exist
mkdir -p /home/jovyan/.config/opencode /home/jovyan/.local/share/opencode/storage/project

# Set up global.json with correct worktree
GLOBAL_JSON="/home/jovyan/.local/share/opencode/storage/project/global.json"

if [ -f "$GLOBAL_JSON" ]; then
    CURRENT_WORKTREE=$(grep -o '"worktree":\s*"[^"]*"' "$GLOBAL_JSON" 2>/dev/null | cut -d'"' -f4 || echo "")
    if [ "$CURRENT_WORKTREE" != "/home/jovyan" ]; then
        echo "Fixing worktree in existing global.json (was: $CURRENT_WORKTREE)"
        sed -i 's|"worktree":\s*"[^"]*"|"worktree": "/home/jovyan"|g' "$GLOBAL_JSON"
    fi
else
    echo "Creating global.json with worktree=/home/jovyan"
    cat > "$GLOBAL_JSON" <<EOF
{
  "id": "global",
  "worktree": "/home/jovyan",
  "sandboxes": [],
  "time": {
    "created": $(date +%s)000,
    "updated": $(date +%s)000
  }
}
EOF
fi

echo "Working directory: $(pwd)"
echo "NB_PREFIX: ${NB_PREFIX:-"(not set)"}"
echo "API will run on: http://127.0.0.1:4096"
echo "UI will run on: http://0.0.0.0:8888${NB_PREFIX:-/}"

# Start OpenCode API server in background
echo ""
echo "Starting OpenCode API server..."
cd /home/jovyan
opencode serve --port 4096 --hostname 127.0.0.1 &
API_PID=$!

# Wait for API to be ready
echo "Waiting for API server to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:4096/health > /dev/null 2>&1; then
        echo "API server is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: API server failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Start UI server (this blocks)
echo ""
echo "Starting UI server..."
cd /opt/opencode-ui
exec bun run serve-ui.ts
