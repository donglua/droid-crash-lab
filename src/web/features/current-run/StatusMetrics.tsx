import type { MonkeyProgress, RunState } from "../../../shared/contracts.js";

export function StatusMetrics({ state, elapsed, issueCount, progress }: { readonly state: RunState; readonly elapsed: string; readonly issueCount: number; readonly progress?: MonkeyProgress }) {
  return (
    <section className="metrics" aria-label="运行指标">
      <Metric label="运行状态" value={stateLabel(state)} />
      <Metric label="运行时长" value={elapsed} />
      <Metric label="问题数量" value={String(issueCount)} {...(issueCount > 0 ? { tone: "danger" as const } : {})} />
      <Metric label="Monkey 进度" value={progress === undefined ? "—" : `${progress.completedEvents} / ${progress.totalEvents}`} />
    </section>
  );
}

function Metric({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: "danger" }) {
  return <div className={`metric${tone === undefined ? "" : ` is-${tone}`}`}><span>{label}</span><strong>{value}</strong></div>;
}

function stateLabel(state: RunState): string {
  const labels: Record<RunState, string> = {
    idle: "待机", preparing: "准备中", installing: "安装中", launching: "启动中", running: "运行中", stopping: "停止中", completed: "已完成", failed: "失败", interrupted: "已中断",
  };
  return labels[state];
}
