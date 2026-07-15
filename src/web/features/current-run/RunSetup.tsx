import { useState } from "react";
import { Download, Play, Rocket, Square, Upload } from "lucide-react";
import type { RunConfig } from "../../../shared/contracts.js";

type ApkDisplay = {
  readonly applicationId: string;
  readonly versionName: string;
  readonly versionCode: string;
};

type RunSetupProps = {
  readonly canOperate: boolean;
  readonly apk?: ApkDisplay;
  readonly running: boolean;
  readonly operationStatus?: string;
  readonly onFileSelect?: (file: File) => void;
  readonly onInstall: () => void;
  readonly onLaunch: () => void;
  readonly onStart: (config: RunConfig) => void;
  readonly onStop: () => void;
};

export function RunSetup({ canOperate, apk, running, operationStatus, onFileSelect, onInstall, onLaunch, onStart, onStop }: RunSetupProps) {
  const [mode, setMode] = useState<RunConfig["mode"]>("manual");
  const [eventCount, setEventCount] = useState(10_000);
  const [throttleMs, setThrottleMs] = useState(350);
  const [seed, setSeed] = useState(currentDateSeed());
  const config: RunConfig = mode === "manual"
    ? { mode: "manual" }
    : { mode: "monkey", eventCount, throttleMs, seed };

  return (
    <section className="panel" aria-labelledby="run-setup-title">
      <div className="panel-heading"><h3 id="run-setup-title">测试准备</h3></div>
      <div className="run-setup-grid">
        <label className="field-label" htmlFor="apk-file">
          APK 文件
          <span className="file-control"><Upload size={17} aria-hidden="true" />选择本地 APK</span>
          <input id="apk-file" type="file" accept=".apk,application/vnd.android.package-archive" disabled={!canOperate || running} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) onFileSelect?.(file);
          }} />
        </label>
        <div className="apk-summary" aria-live="polite">
          {apk === undefined ? (
            <p>尚未检查 APK 元数据</p>
          ) : (
            <><strong>{apk.applicationId}</strong><span>{apk.versionName} ({apk.versionCode})</span></>
          )}
        </div>
        <fieldset className="mode-fieldset" disabled={running}>
          <legend>测试模式</legend>
          <div className="segmented-control">
            <label><input type="radio" name="mode" checked={mode === "manual"} onChange={() => setMode("manual")} />人工巡检</label>
            <label><input type="radio" name="mode" checked={mode === "monkey"} onChange={() => setMode("monkey")} />Monkey</label>
          </div>
        </fieldset>
        {mode === "monkey" ? (
          <div className="monkey-fields">
            <NumberField label="事件数" value={eventCount} min={1} max={1_000_000} onChange={setEventCount} />
            <NumberField label="节流毫秒" value={throttleMs} min={0} max={10_000} onChange={setThrottleMs} />
            <NumberField label="随机种子" value={seed} min={-2_147_483_648} max={2_147_483_647} onChange={setSeed} />
          </div>
        ) : null}
        <div className="action-row">
          {running ? (
            <button className="button is-danger" type="button" onClick={onStop}><Square size={16} aria-hidden="true" />停止测试</button>
          ) : (
            <>
              <button className="button is-secondary" type="button" disabled={!canOperate || apk === undefined} onClick={onInstall}><Download size={16} aria-hidden="true" />覆盖安装</button>
              <button className="button is-secondary" type="button" disabled={!canOperate || apk === undefined} onClick={onLaunch}><Rocket size={16} aria-hidden="true" />启动应用</button>
              <button className="button" type="button" disabled={!canOperate || apk === undefined} onClick={() => onStart(config)}><Play size={16} aria-hidden="true" />开始测试</button>
            </>
          )}
        </div>
        {operationStatus === undefined ? null : <p className="operation-status" role="status">{operationStatus}</p>}
      </div>
    </section>
  );
}

function NumberField({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }) {
  return <label className="field-label">{label}<input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}

function currentDateSeed(): number {
  const now = new Date();
  return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`);
}
