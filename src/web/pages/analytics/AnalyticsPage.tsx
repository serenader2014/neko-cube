import { type ReactNode, useMemo, useState } from "react";
import type { TelemetryQuerySource } from "../../../shared/telemetry";
import { ModuleShell } from "../../components/ModuleShell";
import {
  AnalyticsDevicesGlyph,
  AnalyticsOverviewGlyph,
  AnalyticsRulesGlyph,
  DomainsGlyph,
  NetworkGlyph,
  ProxiesGlyph,
  RegionsGlyph,
} from "../../components/icons";
import { buildAnalyticsSearch } from "../../lib/telemetry";
import { getDefaultEnd, getDefaultStart } from "./helpers";
import type { AnalyticsNavRoute, AnalyticsShellContext, Preset } from "./types";

const NAV_ITEMS: Array<{
  to: AnalyticsNavRoute;
  label: string;
  icon: (active: boolean) => ReactNode;
}> = [
  { to: "overview", label: "总览", icon: (active) => <AnalyticsOverviewGlyph active={active} /> },
  { to: "rules", label: "规则", icon: (active) => <AnalyticsRulesGlyph active={active} /> },
  { to: "domains", label: "域名", icon: (active) => <DomainsGlyph active={active} /> },
  { to: "regions", label: "地区", icon: (active) => <RegionsGlyph active={active} /> },
  { to: "proxies", label: "代理", icon: (active) => <ProxiesGlyph active={active} /> },
  { to: "probes", label: "延迟", icon: (active) => <NetworkGlyph active={active} /> },
  { to: "devices", label: "设备", icon: (active) => <AnalyticsDevicesGlyph active={active} /> },
];

export function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customStart, setCustomStart] = useState(getDefaultStart());
  const [customEnd, setCustomEnd] = useState(getDefaultEnd());
  const [querySource, setQuerySource] = useState<TelemetryQuerySource>("auto");

  const buildSearch = useMemo(
    () => (limit = 20) =>
      buildAnalyticsSearch({
        preset,
        start: preset === "custom" ? customStart : undefined,
        end: preset === "custom" ? customEnd : undefined,
        limit,
        querySource,
      }),
    [customEnd, customStart, preset, querySource],
  );

  const rangeLabel = preset === "custom" ? `${customStart.replace("T", " ")} ~ ${customEnd.replace("T", " ")}` : preset;
  const context = useMemo<AnalyticsShellContext>(
    () => ({
      preset,
      setPreset,
      customStart,
      setCustomStart,
      customEnd,
      setCustomEnd,
      querySource,
      setQuerySource,
      buildSearch,
      rangeLabel,
    }),
    [buildSearch, customEnd, customStart, preset, querySource, rangeLabel],
  );

  return (
    <ModuleShell
      eyebrow="流量分析"
      title="Mihomo 历史流量分析"
      description="提供总览、规则、域名、地区、代理和设备六个分析页，交互节奏和运行时一致，颜色与当前项目保持统一。"
      navLabel="流量分析导航"
      tabs={NAV_ITEMS}
      pageClassName="analytics-workspace-page"
      copyClassName="analytics-shell-copy"
      actionsClassName="analytics-shell-actions"
      screenClassName="analytics-screen"
      outletContext={context}
      actions={
        <>
          <div className="analytics-range-pills" role="tablist" aria-label="分析时间范围">
            {(["1h", "24h", "7d", "custom"] as const).map((item) => (
              <button
                aria-selected={preset === item}
                className={`analytics-pill-button ${preset === item ? "is-active" : ""}`}
                key={item}
                onClick={() => setPreset(item)}
                type="button"
              >
                {item === "custom" ? "自定义" : item}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="analytics-custom-range">
              <input aria-label="自定义开始时间" type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              <input aria-label="自定义结束时间" type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </div>
          ) : null}
        </>
      }
    />
  );
}
