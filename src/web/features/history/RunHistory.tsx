import { Download } from "lucide-react";
import type { RunSummary } from "../../../shared/contracts.js";

export function RunHistory({ runs }: { readonly runs: readonly RunSummary[] }) {
  const ordered = [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  if (ordered.length === 0) {
    return <section className="history-empty"><h3>还没有测试历史</h3><p>完成一轮人工巡检或 Monkey 测试后，结果会保存在这里。</p></section>;
  }
  return (
    <section className="history-list" aria-label="测试历史">
      {ordered.map((run) => (
        <article className="history-row" key={run.id}>
          <div className="history-main"><strong>{run.apk.applicationId}</strong><code>{run.id}</code></div>
          <HistoryValue label="版本" value={`${run.apk.versionName} (${run.apk.versionCode})`} />
          <HistoryValue label="设备" value={run.device.model ?? run.device.serial} />
          <HistoryValue label="模式" value={run.config.mode === "manual" ? "人工巡检" : "Monkey"} />
          <HistoryValue label="状态" value={stateLabel(run.state)} />
          <HistoryValue label="问题" value={String(run.issueCount)} />
          <a className="archive-link" href={`/api/runs/${run.id}/archive`}><Download size={15} aria-hidden="true" />下载归档</a>
        </article>
      ))}
    </section>
  );
}

function HistoryValue({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="history-value"><span>{label}</span><strong>{value}</strong></div>;
}

function stateLabel(state: RunSummary["state"]): string {
  return { idle: "待机", preparing: "准备中", installing: "安装中", launching: "启动中", running: "运行中", stopping: "停止中", completed: "完成", failed: "失败", interrupted: "中断" }[state];
}
