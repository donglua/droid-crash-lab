import { describe, expect, it } from "vitest";
import { RunStateMachine } from "./run-state.js";

describe("RunStateMachine", () => {
  it("accepts the complete successful lifecycle", () => {
    const machine = new RunStateMachine();

    for (const state of [
      "preparing",
      "installing",
      "launching",
      "running",
      "stopping",
      "completed",
    ] as const) {
      expect(machine.transition(state)).toEqual({ ok: true, state });
    }

    expect(machine.current).toBe("completed");
  });

  it("allows preparation failures and running interruptions", () => {
    const preparation = new RunStateMachine();
    preparation.transition("preparing");
    expect(preparation.transition("failed")).toEqual({ ok: true, state: "failed" });

    const running = new RunStateMachine();
    running.transition("preparing");
    running.transition("installing");
    running.transition("launching");
    running.transition("running");
    expect(running.transition("interrupted")).toEqual({ ok: true, state: "interrupted" });
  });

  it("rejects illegal transitions without changing state", () => {
    const machine = new RunStateMachine();

    expect(machine.transition("running")).toEqual({
      ok: false,
      error: { kind: "invalid_transition", from: "idle", to: "running" },
    });
    expect(machine.current).toBe("idle");
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "rejects transitions from terminal state %s",
    (terminal) => {
      const machine = RunStateMachine.from(terminal);

      expect(machine.transition("stopping")).toEqual({
        ok: false,
        error: { kind: "terminal_state", state: terminal },
      });
      expect(machine.current).toBe(terminal);
    },
  );
});
