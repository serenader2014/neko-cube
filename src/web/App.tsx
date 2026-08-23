import { lazy, Suspense, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ToastViewport } from "./components/toast";
import { SidebarNavIcon } from "./components/icons";
import { useSetupGate } from "./pages/setup/hooks";

const ConfigPage = lazy(() => import("./pages/ConfigPage").then(({ ConfigPage }) => ({ default: ConfigPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then(({ DashboardPage }) => ({ default: DashboardPage })));
const SourcesPage = lazy(() => import("./pages/SourcesPage").then(({ SourcesPage }) => ({ default: SourcesPage })));
const RulesPage = lazy(() => import("./pages/rules/RulesPage").then(({ RulesPage }) => ({ default: RulesPage })));
const GroupsPage = lazy(() => import("./pages/groups/GroupsPage").then(({ GroupsPage }) => ({ default: GroupsPage })));
const ClashTargetPage = lazy(() => import("./pages/ClashTargetPage").then(({ ClashTargetPage }) => ({ default: ClashTargetPage })));
const DeviceProfilesPage = lazy(() => import("./pages/DeviceProfilesPage").then(({ DeviceProfilesPage }) => ({ default: DeviceProfilesPage })));
const RuntimePage = lazy(() => import("./pages/runtime/RuntimePage").then(({ RuntimePage }) => ({ default: RuntimePage })));
const RuntimeOverviewPage = lazy(() => import("./pages/runtime/RuntimePage").then(({ RuntimeOverviewPage }) => ({ default: RuntimeOverviewPage })));
const RuntimeProxiesPage = lazy(() => import("./pages/runtime/RuntimePage").then(({ RuntimeProxiesPage }) => ({ default: RuntimeProxiesPage })));
export const loadRuntimeConnectionsPage = () =>
  import("./pages/runtime/RuntimeConnectionsPage").then(({ RuntimeConnectionsPage }) => ({ default: RuntimeConnectionsPage }));
const RuntimeConnectionsPage = lazy(loadRuntimeConnectionsPage);
const RuntimeLogsPage = lazy(() => import("./pages/runtime/RuntimeLogsPage").then(({ RuntimeLogsPage }) => ({ default: RuntimeLogsPage })));
const AnalyticsPage = lazy(() => import("./pages/analytics/AnalyticsPage").then(({ AnalyticsPage }) => ({ default: AnalyticsPage })));
const AnalyticsOverviewPage = lazy(() => import("./pages/analytics/AnalyticsOverviewPage").then(({ AnalyticsOverviewPage }) => ({ default: AnalyticsOverviewPage })));
const AnalyticsDimensionPage = lazy(() => import("./pages/analytics/AnalyticsDimensionPage").then(({ AnalyticsDimensionPage }) => ({ default: AnalyticsDimensionPage })));
const AnalyticsProbePage = lazy(() => import("./pages/analytics/AnalyticsProbePage").then(({ AnalyticsProbePage }) => ({ default: AnalyticsProbePage })));
const SetupPage = lazy(() => import("./pages/setup/SetupPage").then(({ SetupPage }) => ({ default: SetupPage })));

const navItems = [
  { to: "/runtime", label: "实时控制台", icon: "runtime" },
  { to: "/analytics", label: "流量分析", icon: "analytics" },
  { to: "/config", label: "订阅与配置", icon: "config" },
] as const;

export function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 960px)").matches : false,
  );
  const location = useLocation();
  const isSetupRoute = location.pathname.startsWith("/setup");
  useSetupGate();

  const closeMobileNav = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setIsSidebarCollapsed(true);
    }
  };

  return (
    <div className={`app-shell ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${isSetupRoute ? "is-setup-route" : ""}`}>
      <aside className="sidebar">
        <button
          aria-label={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-pressed={isSidebarCollapsed}
          className="sidebar-toggle"
          aria-controls="primary-navigation"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          type="button"
        >
          <svg aria-hidden="true" className="sidebar-toggle-icon" viewBox="0 0 24 24">
            <path d={isSidebarCollapsed ? "M5 7h14M5 12h14M5 17h14" : "M7 7l10 10M17 7 7 17"} />
          </svg>
        </button>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <p className="eyebrow">本地代理配置与运行</p>
            <img alt="NekoCube" className="sidebar-brand-logo" src="/assets/nekocube-logo.png" />
          </div>
          <p className="lede">聚合订阅、编辑规则、生成 Mihomo 配置，并直接写回本地实例。</p>
        </div>
        <nav className="nav-list" id="primary-navigation">
          {navItems.map((item) => (
            <NavLink
              aria-label={item.label}
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
              onClick={closeMobileNav}
            >
              <span className="nav-link-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              <span className="nav-link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Suspense fallback={<div className="route-loading" role="status">加载中…</div>}>
          <Routes>
            <Route path="/" element={<Navigate replace to="/runtime" />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/rumtime/logs" element={<Navigate replace to="/runtime/logs" />} />
            <Route path="/config" element={<ConfigPage />}>
              <Route index element={<Navigate replace to="overview" />} />
              <Route path="overview" element={<DashboardPage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="groups" element={<GroupsPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="target" element={<ClashTargetPage />} />
              <Route path="devices" element={<DeviceProfilesPage />} />
            </Route>
            <Route path="/runtime" element={<RuntimePage />}>
              <Route index element={<Navigate replace to="overview" />} />
              <Route path="overview" element={<RuntimeOverviewPage />} />
              <Route path="proxies" element={<RuntimeProxiesPage />} />
              <Route path="connections" element={<RuntimeConnectionsPage />} />
              <Route path="logs" element={<RuntimeLogsPage />} />
            </Route>
            <Route path="/analytics" element={<AnalyticsPage />}>
              <Route index element={<Navigate replace to="overview" />} />
              <Route path="overview" element={<AnalyticsOverviewPage />} />
              <Route path="rules" element={<AnalyticsDimensionPage dimension="rules" />} />
              <Route path="domains" element={<AnalyticsDimensionPage dimension="domains" />} />
              <Route path="regions" element={<AnalyticsDimensionPage dimension="regions" />} />
              <Route path="proxies" element={<AnalyticsDimensionPage dimension="proxies" />} />
              <Route path="probes" element={<AnalyticsProbePage />} />
              <Route path="devices" element={<AnalyticsDimensionPage dimension="devices" />} />
            </Route>
          </Routes>
        </Suspense>
      </main>
      <ToastViewport />
    </div>
  );
}
