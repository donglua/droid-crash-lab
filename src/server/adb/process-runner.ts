import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

const DEFAULT_TERMINATION_GRACE_MS = 1_000;

export class ProcessSpawnError extends Error {
  override readonly name = "ProcessSpawnError";
  readonly args: readonly string[];

  constructor(
    readonly executable: string,
    args: readonly string[],
    options: ErrorOptions,
  ) {
    super(`Failed to start ${executable}`, options);
    this.args = [...args];
  }
}

export type ProcessResult =
  | {
      readonly kind: "exited";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: "signaled";
      readonly signal: NodeJS.Signals;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: "aborted";
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: "spawn_error";
      readonly error: ProcessSpawnError;
      readonly stdout: string;
      readonly stderr: string;
    };

export type StreamProcessOptions = {
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly terminationGraceMs?: number;
  readonly captureOutput?: boolean;
};

export type StreamingProcess = {
  readonly pid: number | undefined;
  readonly completion: Promise<ProcessResult>;
  readonly stop: () => boolean;
};

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: Pick<StreamProcessOptions, "signal"> = {},
): Promise<ProcessResult> {
  return streamProcess(executable, args, {
    ...options,
    captureOutput: true,
  }).completion;
}

export function streamProcess(
  executable: string,
  args: readonly string[],
  options: StreamProcessOptions = {},
): StreamingProcess {
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(executable, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    return {
      pid: undefined,
      completion: Promise.resolve({
        kind: "spawn_error",
        error: new ProcessSpawnError(executable, args, { cause }),
        stdout: "",
        stderr: "",
      }),
      stop: () => false,
    };
  }
  let stdout = "";
  let stderr = "";
  let settled = false;
  let stopRequested = false;
  let aborted = false;
  let terminalStatus:
    | {
        readonly exitCode: number | null;
        readonly signal: NodeJS.Signals | null;
      }
    | undefined;
  let forceKillTimer: NodeJS.Timeout | undefined;
  let removeAbortListener = (): void => undefined;
  let terminate = (): void => undefined;

  const completion = new Promise<ProcessResult>((resolveCompletion) => {
    const settle = (result: ProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      removeAbortListener();
      resolveCompletion(result);
    };

    terminate = (): void => {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
      forceKillTimer.unref();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (options.captureOutput === true) {
        stdout += chunk;
      }
      options.onStdout?.(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (options.captureOutput === true) {
        stderr += chunk;
      }
      options.onStderr?.(chunk);
    });
    child.once("error", (cause) => {
      settle({
        kind: "spawn_error",
        error: new ProcessSpawnError(executable, args, { cause }),
        stdout,
        stderr,
      });
    });
    child.once("exit", (exitCode, signal) => {
      terminalStatus = { exitCode, signal };
    });
    child.once("close", (exitCode, signal) => {
      const status = terminalStatus ?? { exitCode, signal };
      if (aborted) {
        settle({ kind: "aborted", stdout, stderr });
      } else if (status.exitCode !== null) {
        settle({ kind: "exited", exitCode: status.exitCode, stdout, stderr });
      } else if (status.signal !== null) {
        settle({ kind: "signaled", signal: status.signal, stdout, stderr });
      }
    });

    const abort = (): void => {
      if (settled || aborted || terminalStatus !== undefined) {
        return;
      }
      aborted = true;
      stopRequested = true;
      terminate();
    };
    if (options.signal !== undefined) {
      options.signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = (): void =>
        options.signal?.removeEventListener("abort", abort);
      if (options.signal.aborted) {
        abort();
      }
    }
  });

  return {
    pid: child.pid,
    completion,
    stop: (): boolean => {
      if (settled || stopRequested || terminalStatus !== undefined) {
        return false;
      }
      stopRequested = true;
      terminate();
      return true;
    },
  };
}
