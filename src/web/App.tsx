import { useEffect, useState } from "react";
import type { DevicesResponse, EnvironmentResponse, RunSummary } from "../shared/contracts.js";
import { apiClient } from "./api/client.js";
import { AppShell } from "./components/AppShell.js";
import { IssueList } from "./features/current-run/IssueList.js";
import { LogConsole } from "./features/current-run/LogConsole.js";
import { RunSetup } from "./features/current-run/RunSetup.js";
import { StatusMetrics } from "./features/current-run/StatusMetrics.js";
import { RunHistory } from "./features/history/RunHistory.js";

export function App() {
  const [environment, setEnvironment] = useState<EnvironmentResponse | undefined>();
  const [devices, setDevices] = useState<DevicesResponse>({ devices: [] });
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeView, setActiveView] = useState("当前测试");
  const [history, setHistory] = useState<readonly RunSummary[]>([]);

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
  return (
    <AppShell adbAvailable={environment?.adb.available === true} deviceLabel={deviceLabel} activeView={activeView} onNavigate={setActiveView}>
      {activeView === "测试历史" ? (
        <><section className="page-heading"><div><h2>测试历史</h2><p>查看已保存的运行摘要并下载完整归档。</p></div></section><RunHistory runs={history} /></>
      ) : (
      <>
      <section className="page-heading">
        <div>
          <h2>当前测试</h2>
          <p>选择设备与 APK，启动人工巡检或 Monkey 压力测试。</p>
        </div>
      </section>
      {loadFailed ? <p className="load-error" role="alert">无法读取本地服务状态，请确认服务已启动。</p> : null}
      <div className="dashboard-grid">
        <RunSetup canOperate={selected !== undefined} running={false} onStart={() => undefined} onStop={() => undefined} />
        <StatusMetrics state="idle" elapsed="00:00" issueCount={0} />
        <div className="content-split">
          <IssueList issues={[]} onSelect={() => undefined} />
          <LogConsole lines={[]} />
        </div>
      </div>
      </>
      )}
    </AppShell>
  );
}
