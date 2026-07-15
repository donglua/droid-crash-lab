import type { Issue } from "../../../shared/contracts.js";

export function IssueList({ issues, selectedId, onSelect }: { readonly issues: readonly Issue[]; readonly selectedId?: string; readonly onSelect: (id: string) => void }) {
  return (
    <section className="panel issue-panel" aria-labelledby="issues-title">
      <div className="panel-heading"><h3 id="issues-title">问题报告</h3><span className="count-badge">{issues.length}</span></div>
      {issues.length === 0 ? <p className="empty-copy">尚未发现崩溃、ANR、Native Crash 或 OOM。</p> : (
        <div className="issue-list">
          {issues.map((issue) => (
            <button type="button" className={selectedId === issue.id ? "issue-row is-selected" : "issue-row"} key={issue.id} onClick={() => onSelect(issue.id)}>
              <span className={`issue-type is-${issue.type}`}>{issue.type.toUpperCase()}</span>
              <span className="issue-copy"><strong>{issue.summary}</strong><small>{issue.processName}</small></span>
              <span className="issue-meta"><span>出现 {issue.occurrenceCount} 次</span><span>原始日志 {issue.rawLogStartLine}–{issue.rawLogEndLine} 行</span></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
