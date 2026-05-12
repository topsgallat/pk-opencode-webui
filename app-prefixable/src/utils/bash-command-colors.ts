import type { ToolState } from "../sdk/client";

type BashToolState = {
  status: ToolState["status"];
  metadata?: Record<string, unknown>;
};

type BashCommandColors = {
  background: string;
  color: string;
};

function getExitCode(state: BashToolState): number | undefined {
  const raw = state.metadata?.exitCode;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function getBashCommandColors(state: BashToolState): BashCommandColors {
  const exitCode = getExitCode(state);
  if (state.status === "error") {
    return {
      background: "var(--status-danger-dim)",
      color: "var(--status-danger-text)",
    };
  }

  if (state.status === "completed") {
    if (exitCode === 0) {
      return {
        background: "var(--status-success-dim)",
        color: "var(--status-success-text)",
      };
    }

    if (exitCode != null) {
      return {
        background: "var(--status-danger-dim)",
        color: "var(--status-danger-text)",
      };
    }
  }

  return {
    background: "var(--background-base)",
    color: "var(--text-strong)",
  };
}
