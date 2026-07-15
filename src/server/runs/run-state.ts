import type { RunState } from "../../shared/contracts.js";

const TERMINAL_STATES = new Set<RunState>(["completed", "failed", "interrupted"]);
const TRANSITIONS = {
  idle: ["preparing"],
  preparing: ["installing", "failed", "interrupted"],
  installing: ["launching", "failed", "interrupted"],
  launching: ["running", "failed", "interrupted"],
  running: ["stopping", "completed", "interrupted"],
  stopping: ["completed", "interrupted"],
  completed: [],
  failed: [],
  interrupted: [],
} as const satisfies Record<RunState, readonly RunState[]>;

export type RunTransitionResult =
  | { readonly ok: true; readonly state: RunState }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "terminal_state"; readonly state: RunState }
        | { readonly kind: "invalid_transition"; readonly from: RunState; readonly to: RunState };
    };

/** Mutable state machine: transition control is its documented purpose. */
export class RunStateMachine {
  private state: RunState;

  constructor(initial: RunState = "idle") {
    this.state = initial;
  }

  static from(state: RunState): RunStateMachine {
    return new RunStateMachine(state);
  }

  get current(): RunState {
    return this.state;
  }

  transition(next: RunState): RunTransitionResult {
    if (TERMINAL_STATES.has(this.state)) {
      return { ok: false, error: { kind: "terminal_state", state: this.state } };
    }
    if (!TRANSITIONS[this.state].some((allowed) => allowed === next)) {
      return { ok: false, error: { kind: "invalid_transition", from: this.state, to: next } };
    }
    this.state = next;
    return { ok: true, state: next };
  }
}
