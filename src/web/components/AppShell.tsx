import { AlertTriangle, Bug, FlaskConical, History, Settings } from "lucide-react";
import type { ReactNode } from "react";

type AppShellProps = {
  readonly adbAvailable: boolean;
  readonly deviceLabel: string;
  readonly children: ReactNode;
};

const NAVIGATION = [
  { label: "当前测试", icon: FlaskConical },
  { label: "问题报告", icon: Bug },
  { label: "测试历史", icon: History },
  { label: "设置", icon: Settings },
] as const;

export function AppShell({ adbAvailable, deviceLabel, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="product-mark" aria-hidden="true">D</span>
          <h1>DroidCrashLab</h1>
        </div>
        <div className="topbar-status">
          <span className={adbAvailable ? "status-dot is-success" : "status-dot is-danger"} />
          <span>{adbAvailable ? "ADB 已就绪" : "ADB 不可用"}</span>
          <span className="topbar-divider" aria-hidden="true" />
          <span role="status">{deviceLabel}</span>
        </div>
      </header>
      <aside className="sidebar">
        <nav aria-label="主导航">
          {NAVIGATION.map(({ label, icon: Icon }, index) => (
            <button className={index === 0 ? "nav-item is-active" : "nav-item"} type="button" key={label}>
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="safety-note">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>仅使用测试账号，避免真实交易、支付和删除操作。</p>
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
