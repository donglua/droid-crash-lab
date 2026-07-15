import { useEffect, useState } from "react";
import type { DevicesResponse, EnvironmentResponse } from "../shared/contracts.js";
import { apiClient } from "./api/client.js";
import { AppShell } from "./components/AppShell.js";

export function App() {
  const [environment, setEnvironment] = useState<EnvironmentResponse | undefined>();
  const [devices, setDevices] = useState<DevicesResponse>({ devices: [] });
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([apiClient.environment(), apiClient.devices()])
      .then(([nextEnvironment, nextDevices]) => {
        if (!active) return;
        setEnvironment(nextEnvironment);
        setDevices(nextDevices);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => { active = false; };
  }, []);

  const selected = devices.devices.find((device) => device.serial === devices.selectedSerial);
  const deviceLabel = selected?.model ?? selected?.serial ?? "未连接设备";
  return (
    <AppShell adbAvailable={environment?.adb.available === true} deviceLabel={deviceLabel}>
      <section className="page-heading">
        <div>
          <h2>当前测试</h2>
          <p>选择设备与 APK，启动人工巡检或 Monkey 压力测试。</p>
        </div>
      </section>
      {loadFailed ? <p className="load-error" role="alert">无法读取本地服务状态，请确认服务已启动。</p> : null}
      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="setup-title">
          <div className="panel-heading"><h3 id="setup-title">测试准备</h3></div>
          <div className="setup-row">
            <label className="field-label">APK 文件<span className="file-placeholder">尚未选择 APK</span></label>
            <button className="button" type="button" disabled={selected === undefined}>开始测试</button>
          </div>
        </section>
        <section className="metrics" aria-label="运行指标">
          <div className="metric"><span>运行状态</span><strong>待机</strong></div>
          <div className="metric"><span>运行时长</span><strong>00:00</strong></div>
          <div className="metric"><span>问题数量</span><strong>0</strong></div>
          <div className="metric"><span>Monkey 进度</span><strong>—</strong></div>
        </section>
        <section className="panel">
          <div className="panel-heading"><h3>实时结果</h3></div>
          <p className="empty-copy">测试启动后，此处将显示崩溃问题和实时日志。</p>
        </section>
      </div>
    </AppShell>
  );
}
