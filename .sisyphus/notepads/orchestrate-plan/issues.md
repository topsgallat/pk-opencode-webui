Issues log

- BUG: UI becomes unresponsive when submitting a prompt and waiting for agent response. Console shows many "[Sync] Event: message.part.delta" entries. Need to locate producer/consumer and prevent main-thread blocking.

- Revert: detected unintended file changes from prior subagent and restored working tree to keep only intended edits (extended-api.ts and learnings.md append).
