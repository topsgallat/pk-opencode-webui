# Add GitHub CLI to Dockerfile

## TL;DR
> **Summary**: Add `gh` CLI binary installation to the Dockerfile runtime stage.
> **Deliverables**: Modified `docker/Dockerfile` with gh CLI install step.
> **Effort**: Quick
> **Parallel**: NO - single task
> **Critical Path**: Add gh install RUN step to Dockerfile

## Context
### Original Request
เพิ่ม `gh` CLI ลง Dockerfile เพื่อให้ container มี GitHub CLI ใช้งานได้

### Environment Findings
- `docker/Dockerfile` runtime stage (Stage 2) ใช้ `ubuntu:24.04`
- ติดตั้ง `curl` แล้ว (line 41) — ใช้ download binary ได้เลย
- `USER opencode` อยู่ line 124 — ต้อง install ก่อนหน้านั้น (ยังเป็น root)
- มี pattern เดjàสำหรับ download binary: OpenCode CLI (line 69-71), Bun (line 61-63), s6-overlay (line 75-81)

### Root Cause
`gh` ไม่ได้ติดตั้งใน image — `apt` list ไม่ได้รวม `gh` ไว้

## Work Objectives
### Core Objective
เพิ่ม gh CLI binary ลง Dockerfile runtime stage

### Definition of Done
- [ ] `docker build` ผ่าน
- [ ] Container内有 `gh --version` ทำงานได้
- [ ] ไฟล์ที่แก้มีเฉพาะ `docker/Dockerfile`

## Must NOT Have
- ไม่แก้ไฟล์อื่นนอกจาก Dockerfile
- ไม่เพิ่ม SSH config, ssh-agent, หรืออะไรที่เกี่ยวกับ SSH
- ไม่ install ผ่าน apt (download binary โดยตรง)

## TODOs

- [ ] 1. Add gh CLI binary installation to Dockerfile

  **What to do**:
  - เพิ่ม RUN step ใน Runtime stage (Stage 2) หลัง system packages install (line 49) หรือก่อน `USER opencode` (line 124)
  - ตำแหน่งที่เหมาะสม: หลัง Node.js install (line 55) ก่อน Playwright (line 57) — หรือจะหลัง s6-overlay ก็ได้
  - ใช้ pattern เดียวกับ OpenCode CLI install (line 69-71):
    ```dockerfile
    # Install GitHub CLI
    RUN curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz -o /tmp/gh.tar.gz && \
        tar -xzf /tmp/gh.tar.gz -C /tmp && \
        mv /tmp/gh_*/bin/gh /usr/local/bin/gh && \
        chmod +x /usr/local/bin/gh && \
        rm -rf /tmp/gh*
    ```
  - ต้องรองรับทั้ง amd64 และ arm64 (ใช้ `dpkg --print-architecture` หรือ `uname -m` เหมือน s6-overlay pattern line 75-78)

  **Must NOT do**:
  - Do NOT install via apt
  - Do NOT add to builder stage — ต้องเป็น runtime stage

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: none | Blocked By: none

  **References**:
  - `docker/Dockerfile:69-71` — OpenCode CLI install pattern (download + extract + mv + cleanup)
  - `docker/Dockerfile:75-81` — Architecture detection pattern (s6-overlay)
  - `docker/Dockerfile:38-49` — System packages install (where gh step should go after)

  **Acceptance Criteria**:
  - [ ] `docker/Dockerfile` มี gh install step
  - [ ] `docker build -f docker/Dockerfile -t opencode-web .` passes
  - [ ] `docker run opencode-web gh --version` outputs version string

  **Commit**: YES | Message: `feat(docker): add GitHub CLI to image`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Verify Dockerfile builds — oracle
- [ ] F2. Verify gh CLI is accessible in image — unspecified-high

## Commit Strategy
Single commit: `feat(docker): add GitHub CLI to image`

## Success Criteria
1. `docker/Dockerfile` มี RUN step สำหรับ gh install
2. Build image แล้ว `gh --version` ทำงานได้
