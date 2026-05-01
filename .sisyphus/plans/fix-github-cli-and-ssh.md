# Add gh CLI to Dockerfile + SSH Agent Auto-Start

## TL;DR
> **Summary**: Install `gh` CLI in Dockerfile runtime stage and create SSH agent auto-start script so git/gh work inside the container.
> **Deliverables**: Modified `docker/Dockerfile` with gh CLI + SSH init script, updated `docker/README.md` docs.
> **Effort**: Quick
> **Parallel**: YES — 2 tasks (Dockerfile gh install, SSH init script) can be parallel
> **Critical Path**: Dockerfile gh install → SSH init script → docs update

## Context
### Original Request
ผู้ใช้รายงานว่าใน container มีปัญหา 2 อย่าง:
1. `gh: command not found` — GitHub CLI ไม่ได้ติดตั้งใน image
2. SSH key หาไม่เจอ — `ssh -T git@github.com` ได้ `Permission denied (publickey)`

### Environment Findings
- Dockerfile runtime stage ใช้ `ubuntu:24.04`
- `gh` ไม่ได้ติดตั้ง (ไม่มีใน apt install list)
- `openssh-client` ติดตั้งแล้ว (Dockerfile line 43)
- SSH agent ไม่ได้ start อัตโนมัติใน container
- Container รันเป็น user `opencode` (non-root) หลัง `USER opencode`

### Root Causes
1. **gh not found**: ไม่ได้ใส่ลงใน Dockerfile
2. **SSH key หาไม่เจอ**: SSH agent ไม่ได้ start — ใน container ไม่มี systemd/session manager ที่ start ssh-agent ให้

### SSH Architecture Decision
SSH keys **ไม่ควร** bake ลง image เพราะ:
- Keys เป็น user-specific และต้องหมุนเวียนได้
- Container images ควร stateless
- Key ที่ mount จาก host อาจเปลี่ยนได้

**วิธีแก้**:
- สร้าง `ssh-agent` init script ที่ start agent + load key อัตโนมัติเมื่อมี key อยู่ใน `~/.ssh/`
- User แค่ mount SSH keys เข้า container (via volume mount หรือ docker cp) แล้ว script จะจัดการส่วนที่เหลือ

## Work Objectives
### Core Objective
1. ติดตั้ง `gh` CLI ลง image ผ่าน Dockerfile
2. สร้าง SSH agent auto-start mechanism ที่ทำงานได้เมื่อ user mount SSH key เข้า container

### Deliverables
- `docker/Dockerfile` — เพิ่ม gh CLI install + SSH init script
- `docker/scripts/ssh-agent-init.sh` — script สำหรับ start ssh-agent + load keys

### Definition of Done
- [ ] `docker build` ผ่านโดยไม่ error
- [ ] Container内有 `gh --version` ทำงานได้
- [ ] เมื่อ mount SSH key เข้า `~/.ssh/id_rsa` และรัน `source ~/.bashrc` แล้ว `ssh-add -l` แสดง key
- [ ] README มี docs อธิบายวิธี mount SSH key

## Must NOT Have
- ไม่ bake SSH keys ลง image
- ไม่ใช้ apt สำหรับ gh (อาจไม่มีใน repo) — ใช้ binary download แทน
- ไม่แก้ user code ของ app

## Execution Strategy
Wave 1: Dockerfile gh install + SSH init script (parallel)
Wave 2: Update README docs

## TODOs

- [ ] 1. Add gh CLI installation to Dockerfile

  **What to do**:
  - ใน Runtime stage (Stage 2, หลัง `FROM ubuntu:24.04`), เพิ่ม gh binary install
  - ใช้วิธี download binary จาก GitHub releases (เหมือน pattern ของ OpenCode CLI ใน Dockerfile line 69-71)
  - ตำแหน่งที่ใส่: หลัง `openssh-client` install (line 48) หรือหลัง Node.js install
  - Code pattern:
    ```dockerfile
    # Install GitHub CLI
    RUN curl -fsSL "https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz" -o /tmp/gh.tar.gz && \
        tar -xzf /tmp/gh.tar.gz -C /tmp && \
        mv /tmp/gh_*/bin/gh /usr/local/bin/gh && \
        chmod +x /usr/local/bin/gh && \
        rm -rf /tmp/gh*
    ```

  **Must NOT do**:
  - Do NOT install via `apt install gh` (Ubuntu repo อาจไม่มีในบาง version)
  - Do NOT run as root after `USER opencode` — ต้อง install ก่อน `USER opencode`

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: none | Blocked By: none

  **References**:
  - Dockerfile: `docker/Dockerfile:65-71` — pattern การ download binary (OpenCode CLI)
  - gh releases: https://github.com/cli/cli/releases

  **Acceptance Criteria**:
  - [ ] Dockerfile มี gh install step
  - [ ] `gh --version` ทำงานได้เมื่อ build image

  **Commit**: YES | `feat(docker): add GitHub CLI to image`

- [ ] 2. Create SSH agent auto-start init script

  **What to do**:
  - สร้างไฟล์ `docker/scripts/ssh-agent-init.sh` ที่:
    1. ตรวจสอบว่า ssh-agent รันอยู่หรือยัง
    2. ถ้ายัง — start ssh-agent
    3. ถ้ามี key อยู่ใน `~/.ssh/id_rsa`, `~/.ssh/id_ed25519` ฯลฯ — add เข้า agent
    4. Export `SSH_AUTH_SOCK` และ `SSH_AGENT_PID` ให้ shell อื่นๆ ใช้ได้

  - Script content:
    ```bash
    #!/bin/bash
    # SSH Agent Auto-Start
    # Starts ssh-agent and loads SSH keys if available.
    # Source this file: source /usr/local/bin/ssh-agent-init.sh

    # Skip if already have an agent
    if [ -n "$SSH_AUTH_SOCK" ] && ssh-add -l >/dev/null 2>&1; then
        return 0 2>/dev/null || true
    fi

    # Kill stale agent if any
    if [ -n "$SSH_AGENT_PID" ] && ! kill -0 "$SSH_AGENT_PID" 2>/dev/null; then
        unset SSH_AUTH_SOCK SSH_AGENT_PID
    fi

    # Start new agent if needed
    if [ -z "$SSH_AUTH_SOCK" ]; then
        eval "$(ssh-agent -s)" > /dev/null 2>&1
    fi

    # Load available keys (no passphrase expected)
    for key in ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa; do
        if [ -f "$key" ]; then
            ssh-add "$key" 2>/dev/null
        fi
    done
    ```
  - สร้าง `~/.ssh/config` ใน Dockerfile:
    ```
    Host github.com
        HostName github.com
        User git
        IdentitiesOnly yes
    ```
  - เพิ่ม `RUN` ใน Dockerfile เพื่อ:
    - สร้าง `~/.ssh/` directory (หลัง `USER opencode` ใช้ `/bin/sh -c`)
    - สร้าง SSH config
    - Copy script ไป `/usr/local/bin/ssh-agent-init.sh`
    - เพิ่ม `source /usr/local/bin/ssh-agent-init.sh` ลง `~/.bashrc`

  **Must NOT do**:
  - Do NOT expect passphrase — SSH keys ใน container มักไม่มี passphrase
  - Do NOT generate new keys — แค่ load ที่มีอยู่
  - Do NOT fail hard ถ้าไม่มี key — script ต้อง graceful

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: none | Blocked By: none

  **References**:
  - Dockerfile: `docker/Dockerfile:87-96` — user creation pattern
  - Dockerfile: `docker/Dockerfile:113-114` — directory creation pattern

  **Acceptance Criteria**:
  - [ ] `docker/scripts/ssh-agent-init.sh` exists
  - [ ] Dockerfile includes script copy + bashrc integration + SSH config
  - [ ] Script runs without error even when no keys present
  - [ ] Script loads keys when `~/.ssh/id_rsa` exists

  **QA Scenarios**:
  ```
  Scenario: script runs with no keys
    Tool: interactive_bash
    Steps: สร้าง script แล้วรัน `bash /usr/local/bin/ssh-agent-init.sh`
    Expected: exit 0, no errors, ssh-agent started แต่ไม่มี key

  Scenario: script loads RSA key
    Tool: interactive_bash
    Steps: cp test key เข้า ~/.ssh/id_rsa แล้ว source script แล้ว `ssh-add -l`
    Expected: แสดง fingerprint ของ key
  ```

  **Commit**: YES | `feat(docker): add SSH agent auto-start script`

- [ ] 3. Update docker/README.md with SSH + gh usage docs

  **What to do**:
  - เพิ่ม section "Using Git and GitHub from Inside the Container" ใน `docker/README.md`
  - เนื้อหาครอบคลุม:
    1. **Mounting SSH Keys**: วิธี mount SSH key จาก host เข้า container
       ```bash
       # Option 1: Volume mount (recommended)
       docker run -v ~/.ssh:/home/opencode/.ssh:ro ...
       ```
    2. **SSH Agent Auto-Start**: อธิบายว่า `ssh-agent-init.sh` จะ load key อัตโนมัติ
    3. **gh CLI**: บอกว่า `gh` ติดตั้งมาแล้ว ใช้ได้เลย
       ```bash
       gh auth status
       gh issue list
       ```
    4. **First-time gh auth**: ถ้ายังไม่ได้ auth ให้ใช้ `gh auth login`

  **Must NOT do**:
  - Do NOT แนะนำให้ copy key ลง image
  - Do NOT แนะนำให้ใช้ `ssh-keygen` ใน container

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: 1, 2

  **References**:
  - `docker/README.md` — existing docs structure

  **Acceptance Criteria**:
  - [ ] `docker/README.md` มี section ใหม่เรื่อง SSH keys + gh CLI
  - [ ] มีตัวอย่าง docker run command ที่ mount SSH keys

  **Commit**: YES | `docs(docker): add SSH keys and gh CLI usage guide`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Verify Dockerfile builds without errors — oracle
- [ ] F2. Verify gh CLI is accessible in built image — unspecified-high
- [ ] F3. Verify SSH agent script runs (with and without keys) — unspecified-high

## Commit Strategy
3 commits (one per task), push together after all done:
1. `feat(docker): add GitHub CLI to image`
2. `feat(docker): add SSH agent auto-start script`
3. `docs(docker): add SSH keys and gh CLI usage guide`

## Success Criteria
1. `docker build -f docker/Dockerfile -t opencode-web .` passes
2. `docker run opencode-web gh --version` outputs version
3. When SSH key is mounted at `~/.ssh/id_rsa`, `ssh-add -l` shows key after shell init
4. `docker/README.md` documents the workflow
