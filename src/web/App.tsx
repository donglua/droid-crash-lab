import { useEffect, useState } from "react";
import type { ApkInfo, DevicesResponse, EnvironmentResponse, Issue, RawLogLine, RunConfig, RunEvent, RunSummary } from "../shared/contracts.js";
import { apiClient } from "./api/client.js";
import { AppShell } from "./components/AppShell.js";
import { IssueList } from "./features/current-run/IssueList.js";
import { LogConsole } from "./features/current-run/LogConsole.js";
import { RunSetup } from "./features/current-run/RunSetup.js";
import { StatusMetrics } from "./features/current-run/StatusMetrics.js";
import { RunHistory } from "./features/history/RunHistory.js";
import { useRunEvents } from "./hooks/use-run-events.js";

export function App() {
  const [environment, setEnvironment] = useState<EnvironmentResponse | undefined>();
  const [devices, setDevices] = useState<DevicesResponse>({ devices: [] });
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeView, setActiveView] = useState("当前测试");
  const [history, setHistory] = useState<readonly RunSummary[]>([]);
  const [apk, setApk] = useState<ApkInfo | undefined>();
  const [run, setRun] = useState<RunSummary | undefined>();
  const [reportIssues, setReportIssues] = useState<readonly Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>();
  const [selectedLogs, setSelectedLogs] = useState<readonly RawLogLine[]>([]);
  const [operationStatus, setOperationStatus] = useState<string | undefined>();
  const { events } = useRunEvents(run?.state === "running" || run?.state === "stopping" ? run.id : undefined);

  useEffect(() => {
    let active = true;
    void Promise.all([apiClient.environment(), apiClient.devices(), apiClient.runs()])
      .then(([nextEnvironment, nextDevices, nextRuns]) => {
        if (!active) return;
        setEnvironment(nextEnvironment);
        setDevices(nextDevices);
        setHistory(nextRuns.runs);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => { active = false; };
  }, []);

  const selected = devices.devices.find((device) => device.serial === devices.selectedSerial);
  const deviceLabel = selected?.model ?? selected?.serial ?? "未连接设备";
  const eventState = latest(events, "state");
  const progress = latest(events, "progress")?.progress ?? run?.monkeyProgress;
  const issues = latestIssues(events);
  const logs = events.filter((event): event is Extract<RunEvent, { readonly type: "log" }> => event.type === "log");
  const state = eventState?.state ?? run?.state ?? "idle";

  const inspect = async (file: File): Promise<void> => {
    try { setApk(await apiClient.inspectApk(file)); setOperationStatus(undefined); setLoadFailed(false); }
    catch { setLoadFailed(true); }
  };
  const install = async (): Promise<void> => {
    if (apk === undefined || selected === undefined) return;
    try { await apiClient.installApk(apk.token, selected.serial); setOperationStatus("安装完成"); setLoadFailed(false); }
    catch { setLoadFailed(true); }
  };
  const launch = async (): Promise<void> => {
    if (apk === undefined || selected === undefined) return;
    try { await apiClient.launchApp(apk.token, selected.serial); setOperationStatus("应用已启动"); setLoadFailed(false); }
    catch { setLoadFailed(true); }
  };
  const start = async (config: RunConfig): Promise<void> => {
    if (apk === undefined || selected === undefined) return;
    try { setRun(await apiClient.startRun({ apkToken: apk.token, deviceSerial: selected.serial, config })); setLoadFailed(false); }
    catch { setLoadFailed(true); }
  };
  const stop = async (): Promise<void> => {
    if (run === undefined) return;
    try {
      const completed = await apiClient.stopRun(run.id);
      setRun(completed);
      setHistory((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
    } catch { setLoadFailed(true); }
  };
  const navigate = (view: string): void => {
    setActiveView(view);
    if (view !== "问题报告") return;
    const target = run ?? history.find((item) => item.issueCount > 0);
    if (target === undefined) { setReportIssues([]); return; }
    void apiClient.runDetails(target.id).then((details) => {
      setRun(details.run);
      setReportIssues(details.issues);
    }).catch(() => setLoadFailed(true));
  };
  const selectIssue = (issue: Issue): void => {
    if (run === undefined) return;
    setSelectedIssueId(issue.id);
    void apiClient.logRange(run.id, issue.rawLogStartLine, issue.rawLogEndLine)
      .then((range) => setSelectedLogs(range.lines))
      .catch(() => setLoadFailed(true));
  };
  return (
    <AppShell adbAvailable={environment?.adb.available === true} deviceLabel={deviceLabel} activeView={activeView} onNavigate={navigate}>
      {activeView === "测试历史" ? <HistoryView history={history} /> : activeView === "问题报告" ? (
        <><section className="page-heading"><div><h2>问题报告</h2><p>查看最近测试发现的问题及对应原始日志。</p></div></section><div className="content-split"><IssueList issues={reportIssues} {...(selectedIssueId === undefined ? {} : { selectedId: selectedIssueId })} onSelect={(id) => { const issue = reportIssues.find((item) => item.id === id); if (issue !== undefined) selectIssue(issue); }} /><LogConsole lines={selectedLogs.map((line) => ({ ...line, level: logLevel(line.line) }))} /></div></>
      ) : activeView === "设置" ? <SettingsView environment={environment} /> : (
      <>
      <section className="page-heading">
        <div>
          <h2>当前测试</h2>
          <p>选择设备与 APK，启动人工巡检或 Monkey 压力测试。</p>
        </div>
      </section>
      {loadFailed ? <p className="load-error" role="alert">无法读取本地服务状态，请确认服务已启动。</p> : null}
      <div className="dashboard-grid">
        <RunSetup canOperate={selected !== undefined} {...(apk === undefined ? {} : { apk })} {...(operationStatus === undefined ? {} : { operationStatus })} running={state === "running" || state === "stopping"} onFileSelect={(file) => void inspect(file)} onInstall={() => void install()} onLaunch={() => void launch()} onStart={(config) => void start(config)} onStop={() => void stop()} />
        <StatusMetrics state={state} elapsed="00:00" issueCount={issues.length} {...(progress === undefined ? {} : { progress })} />
        <div className="content-split">
          <IssueList issues={issues} {...(selectedIssueId === undefined ? {} : { selectedId: selectedIssueId })} onSelect={(id) => { const issue = issues.find((item) => item.id === id); if (issue !== undefined) selectIssue(issue); }} />
          <LogConsole lines={logs} />
        </div>
      </div>
      </>
      )}
    </AppShell>
  );
}

function HistoryView({ history }: { readonly history: readonly RunSummary[] }) {
  return <><section className="page-heading"><div><h2>测试历史</h2><p>查看已保存的运行摘要并下载完整归档。</p></div></section><RunHistory runs={history} /></>;
}

function SettingsView({ environment }: { readonly environment: EnvironmentResponse | undefined }) {
  return <><section className="page-heading"><div><h2>设置</h2><p>本地服务与 Android SDK 能力状态。</p></div></section><section className="panel settings-list"><SettingRow label="服务地址" value={window.location.host} /><SettingRow label="ADB" value={environment?.adb.path ?? "不可用"} /><SettingRow label="apkanalyzer" value={environment?.apkanalyzer.path ?? "不可用"} /><SettingRow label="数据目录" value="~/.droid-crash-lab/" /></section></>;
}

function SettingRow({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="settings-row"><span>{label}</span><code>{value}</code></div>;
}

function logLevel(line: string): Extract<RunEvent, { readonly type: "log" }>["level"] {
  if (/\b(?:F|E)\b|FATAL|Exception|Error/u.test(line)) return "error";
  if (/\bW\b|WARN/u.test(line)) return "warn";
  return "info";
}

function latest<T extends RunEvent["type"]>(events: readonly RunEvent[], type: T): Extract<RunEvent, { readonly type: T }> | undefined {
  return events.findLast((event): event is Extract<RunEvent, { readonly type: T }> => event.type === type);
}

function latestIssues(events: readonly RunEvent[]): readonly Issue[] {
  const byFingerprint = new Map<string, Issue>();
  for (const event of events) if (event.type === "issue") byFingerprint.set(event.issue.fingerprint, event.issue);
  return [...byFingerprint.values()];
}
