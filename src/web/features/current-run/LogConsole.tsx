import { useMemo, useRef, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import type { LogLevel } from "../../../shared/contracts.js";

export type DisplayLogLine = { readonly lineNumber: number; readonly level: LogLevel; readonly line: string };
type Filter = "all" | "error" | "warn" | "info";

export function LogConsole({ lines }: { readonly lines: readonly DisplayLogLine[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => lines.slice(-5_000).filter((line) => matches(line, filter, query)), [lines, filter, query]);

  return (
    <section className="panel log-panel" aria-labelledby="logs-title">
      <div className="panel-heading"><h3 id="logs-title">实时日志</h3><span className="log-count">保留最近 {Math.min(lines.length, 5_000)} 行</span></div>
      <div className="log-toolbar">
        <div className="filter-group" aria-label="日志级别">
          {(["all", "error", "warn", "info"] as const).map((value) => <button type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{filterLabel(value)}</button>)}
        </div>
        <label className="log-search"><Search size={15} aria-hidden="true" /><span className="sr-only">搜索日志</span><input aria-label="搜索日志" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索日志" /></label>
        <button className="pause-button" type="button" onClick={() => setPaused((value) => !value)}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{paused ? "恢复滚动" : "暂停滚动"}</button>
      </div>
      <div className="log-viewport" ref={viewport} aria-live={paused ? "off" : "polite"}>
        {visible.length === 0 ? <p>没有匹配的日志</p> : visible.map((line) => <div className={`log-line is-${line.level}`} key={line.lineNumber}><span>{line.lineNumber}</span><code>{line.line}</code></div>)}
      </div>
    </section>
  );
}

function matches(line: DisplayLogLine, filter: Filter, query: string): boolean {
  const levelMatches = filter === "all" || (filter === "error" ? line.level === "error" || line.level === "fatal" : filter === "warn" ? line.level === "warn" : line.level === "info" || line.level === "debug" || line.level === "verbose");
  return levelMatches && line.line.toLowerCase().includes(query.trim().toLowerCase());
}

function filterLabel(filter: Filter): string { return { all: "全部", error: "错误", warn: "警告", info: "信息" }[filter]; }
