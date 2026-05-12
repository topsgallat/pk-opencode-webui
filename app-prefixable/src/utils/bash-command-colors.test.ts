import { describe, expect, test } from "bun:test";
import { getBashCommandColors } from "./bash-command-colors";

describe("getBashCommandColors", () => {
  test("keeps pending commands neutral", () => {
    expect(getBashCommandColors({ status: "pending" })).toEqual({
      background: "var(--background-base)",
      color: "var(--text-strong)",
    });
  });

  test("keeps running commands neutral", () => {
    expect(getBashCommandColors({ status: "running" })).toEqual({
      background: "var(--background-base)",
      color: "var(--text-strong)",
    });
  });

  test("uses success colors for completed commands with exit code 0", () => {
    expect(getBashCommandColors({ status: "completed", metadata: { exitCode: 0 } })).toEqual({
      background: "var(--status-success-dim)",
      color: "var(--status-success-text)",
    });
  });

  test("uses danger colors for completed commands with non-zero exit code", () => {
    expect(getBashCommandColors({ status: "completed", metadata: { exitCode: 1 } })).toEqual({
      background: "var(--status-danger-dim)",
      color: "var(--status-danger-text)",
    });
  });

  test("uses danger colors for error state", () => {
    expect(getBashCommandColors({ status: "error" })).toEqual({
      background: "var(--status-danger-dim)",
      color: "var(--status-danger-text)",
    });
  });

  test("falls back to neutral colors when result is unknown", () => {
    expect(getBashCommandColors({ status: "completed", metadata: {} })).toEqual({
      background: "var(--background-base)",
      color: "var(--text-strong)",
    });
  });

  test("supports string exit codes from metadata", () => {
    expect(getBashCommandColors({ status: "completed", metadata: { exitCode: "1" } })).toEqual({
      background: "var(--status-danger-dim)",
      color: "var(--status-danger-text)",
    });
  });

  test("keeps running commands neutral even with exit code metadata", () => {
    expect(getBashCommandColors({ status: "running", metadata: { exitCode: 0 } })).toEqual({
      background: "var(--background-base)",
      color: "var(--text-strong)",
    });
  });
});
