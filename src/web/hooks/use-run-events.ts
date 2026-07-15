import { useEffect, useState } from "react";
import type { RunEvent } from "../../shared/contracts.js";

export type RunEventConnection = "idle" | "connecting" | "open" | "closed";

export function useRunEvents(runId: string | undefined) {
  const [events, setEvents] = useState<readonly RunEvent[]>([]);
  const [connection, setConnection] = useState<RunEventConnection>("idle");

  useEffect(() => {
    setEvents([]);
    if (runId === undefined) {
      setConnection("idle");
      return;
    }
    if (typeof EventSource === "undefined") {
      setConnection("closed");
      return;
    }
    setConnection("connecting");
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection("connecting");
    for (const type of ["state", "progress", "log", "issue", "device", "error"] as const) {
      source.addEventListener(type, (message) => {
        if (!(message instanceof MessageEvent) || typeof message.data !== "string") return;
        const parsed: unknown = JSON.parse(message.data);
        if (!isRunEvent(parsed)) return;
        setEvents((current) => mergeEvent(current, parsed));
      });
    }
    return () => {
      source.close();
      setConnection("closed");
    };
  }, [runId]);

  return { events, connection };
}

function mergeEvent(current: readonly RunEvent[], event: RunEvent): readonly RunEvent[] {
  const withoutDuplicate = current.filter((candidate) => candidate.id !== event.id);
  return [...withoutDuplicate, event].sort((left, right) => left.id - right.id);
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== "object" || value === null) return false;
  return "id" in value && typeof value.id === "number" && "type" in value && typeof value.type === "string";
}
