import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppSettings } from "@shared/types";
import type {
  ProxyProbeRecentSample,
  ProxyProbeRecentSamplesResponse,
  ProxyProbeSettings,
  ProxyProbeSummaryItem,
  ProxyProbeSummaryResponse,
  ProxyProbeTrendResponse,
} from "../../../shared/probes";
import { EChart } from "../../components/EChart";
import { StatusSwitch } from "../../components/StatusSwitch";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { formatCount, formatDateTime } from "../../lib/telemetry";
import { AnalyticsMetricCard } from "./AnalyticsCards";
import { buildProxyProbeSmokeChartOption } from "./charts";
import { useContainerWidth } from "./hooks";
import type { ProxyProbeSmokeSeriesKey, ProxyProbeSmokeSeriesVisibility, ProxyProbeSmokeXAxisMode } from "./types";
import { useAnalyticsShell } from "./useAnalyticsShell";

const DEFAULT_SMOKE_SERIES_VISIBILITY: ProxyProbeSmokeSeriesVisibility = {
  median: true,
  smoke: true,
  jitterBand: true,
  fullRange: true,
  loss: true,
};

const SMOKE_LEGEND_ITEMS: Array<{
  key: ProxyProbeSmokeSeriesKey;
  label: string;
  swatchClassName: string;
}> = [
  { key: "median", label: "中位延迟线", swatchClassName: "is-line" },
  { key: "smoke", label: "单次样本烟雾", swatchClassName: "is-smoke" },
  { key: "jitterBand", label: "中位到 90 分位范围", swatchClassName: "is-band" },
  { key: "fullRange", label: "最小到最大范围", swatchClassName: "is-range" },
  { key: "loss", label: "失败样本", swatchClassName: "is-loss" },
];

function appendQuery(search: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function formatDelay(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

function formatPercent(value: number | null | undefined) {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function localDateKey(value: string | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getSmokeXAxisMode(rangeStart: string | undefined, rangeEnd: string | undefined): ProxyProbeSmokeXAxisMode {
  const startKey = localDateKey(rangeStart);
  const endKey = localDateKey(rangeEnd);
  return startKey && endKey && startKey !== endKey ? "dateTime" : "time";
}

function formatProbeError(error: string | null | undefined) {
  if (!error) {
    return "-";
  }
  try {
    const parsed = JSON.parse(error) as unknown;
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  } catch {
    return error;
  }
  return error;
}

export function AnalyticsProbePage() {
  const { buildSearch } = useAnalyticsShell();
  const [searchValue, setSearchValue] = useState("");
  const [selectedProxy, setSelectedProxy] = useState<string | null>(null);
  const [expandedProxy, setExpandedProxy] = useState<string | null>(null);
  const [smokeSeriesVisibility, setSmokeSeriesVisibility] = useState<ProxyProbeSmokeSeriesVisibility>(DEFAULT_SMOKE_SERIES_VISIBILITY);
  const [focusYAxis, setFocusYAxis] = useState(true);
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const chartWidth = useContainerWidth(chartShellRef);
  const compactChart = chartWidth > 0 && chartWidth < 560;
  const summarySearch = useMemo(() => appendQuery(buildSearch(500), { q: searchValue.trim() || undefined }), [buildSearch, searchValue]);
  const trendSearch = useMemo(() => buildSearch(500), [buildSearch]);

  const summaryQuery = useQuery({
    queryKey: ["proxy-probes", "summary", summarySearch],
    queryFn: () => apiRequest<ProxyProbeSummaryResponse>(`/api/proxy-probes/summary${summarySearch}`),
  });
  const probeSettingsQuery = useQuery({
    queryKey: ["proxy-probes", "settings"],
    queryFn: () => apiRequest<ProxyProbeSettings>("/api/proxy-probes/settings"),
  });
  const appSettingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiRequest<AppSettings>("/api/app-settings"),
  });
  const items = useMemo(() => summaryQuery.data?.items ?? [], [summaryQuery.data?.items]);

  useEffect(() => {
    if (!items.length) {
      setSelectedProxy(null);
      setExpandedProxy(null);
      return;
    }
    if (!selectedProxy || !items.some((item) => item.proxyName === selectedProxy)) {
      setSelectedProxy(items[0]!.proxyName);
    }
    if (expandedProxy && !items.some((item) => item.proxyName === expandedProxy)) {
      setExpandedProxy(null);
    }
  }, [expandedProxy, items, selectedProxy]);

  const selectedItem = useMemo(
    () => items.find((item) => item.proxyName === selectedProxy) ?? items[0] ?? null,
    [items, selectedProxy],
  );

  const trendQuery = useQuery({
    queryKey: ["proxy-probes", "trend", selectedItem?.proxyName, trendSearch],
    queryFn: () =>
      apiRequest<ProxyProbeTrendResponse>(
        `/api/proxy-probes/proxies/${encodeURIComponent(selectedItem!.proxyName)}/trend${trendSearch}`,
      ),
    enabled: Boolean(selectedItem?.proxyName),
  });
  const recentSamplesQuery = useQuery({
    queryKey: ["proxy-probes", "samples", expandedProxy],
    queryFn: () =>
      apiRequest<ProxyProbeRecentSamplesResponse>(
        `/api/proxy-probes/proxies/${encodeURIComponent(expandedProxy!)}/samples?limit=20`,
      ),
    enabled: Boolean(expandedProxy),
  });

  const firstError = [summaryQuery.error, trendQuery.error]
    .filter(Boolean)
    .map((error) => getErrorMessage(error))[0];
  const overview = summaryQuery.data?.overview;
  const trendPoints = useMemo(() => trendQuery.data?.points ?? [], [trendQuery.data?.points]);
  const smokeXAxisMode = getSmokeXAxisMode(
    trendQuery.data?.rangeStart ?? summaryQuery.data?.rangeStart,
    trendQuery.data?.rangeEnd ?? summaryQuery.data?.rangeEnd,
  );
  const chartOption = useMemo(
    () => buildProxyProbeSmokeChartOption(trendPoints, smokeSeriesVisibility, smokeXAxisMode, focusYAxis, compactChart),
    [compactChart, focusYAxis, smokeSeriesVisibility, smokeXAxisMode, trendPoints],
  );
  const chartUpdateOptions = useMemo(() => ({ lazyUpdate: true, replaceMerge: ["series"] }), []);
  const configuredProbeUrl = probeSettingsQuery.data?.probeUrl.trim() ?? "";
  const effectiveProbeUrl = configuredProbeUrl || appSettingsQuery.data?.defaultHealthcheckUrl || "-";
  const probeUrlLabel = configuredProbeUrl ? "测速地址" : "测速地址（默认）";
  const toggleExpandedProxy = (proxyName: string) => {
    setExpandedProxy((current) => (current === proxyName ? null : proxyName));
  };

  return (
    <div className="analytics-view analytics-probe-view">
      {firstError ? <div className="runtime-banner is-error">延迟探测数据加载失败：{firstError}</div> : null}

      <div className="analytics-stat-grid">
        <AnalyticsMetricCard label="监控节点" value={formatCount(overview?.monitoredCount ?? 0)} tone="domains" />
        <AnalyticsMetricCard label="平均中位延迟" value={formatDelay(overview?.avgP50DelayMs)} tone="traffic" />
        <AnalyticsMetricCard label="平均 90 分位" value={formatDelay(overview?.avgP90DelayMs)} tone="upload" />
        <AnalyticsMetricCard label="平均抖动" value={formatDelay(overview?.avgJitterMs)} tone="rules" />
        <AnalyticsMetricCard label="成功率" value={formatPercent(overview?.successRate)} tone="connections" />
        <AnalyticsMetricCard label="样本数" value={formatCount(overview?.sampleCount ?? 0)} tone="download" />
      </div>

      <section className="panel analytics-probe-chart-panel">
        <div className="analytics-hero-head">
          <div>
            <p className="eyebrow">抖动视图</p>
            <h3>{selectedItem?.proxyName ?? "未选择节点"}</h3>
            <p className="analytics-probe-url-line">
              <span>{probeUrlLabel}</span>
              <code title={effectiveProbeUrl}>{effectiveProbeUrl}</code>
            </p>
            <p className="muted">
              中位延迟 {formatDelay(selectedItem?.p50DelayMs)} · 抖动 {formatDelay(selectedItem?.jitterMs)} · 失败率{" "}
              {formatPercent(selectedItem?.lossRate)}
            </p>
          </div>
          <div className="analytics-hero-meta">
            <select
              aria-label="选择抖动视图节点"
              className="analytics-control-select analytics-probe-node-select"
              disabled={!items.length}
              onChange={(event) => setSelectedProxy(event.target.value || null)}
              value={selectedItem?.proxyName ?? ""}
            >
              {items.length ? null : <option value="">暂无节点</option>}
              {items.map((item) => (
                <option key={item.proxyName} value={item.proxyName}>
                  {item.proxyName}
                </option>
              ))}
            </select>
            <span className="analytics-stat-inline">90 分位 {formatDelay(selectedItem?.p90DelayMs)}</span>
            <span className="analytics-stat-inline analytics-stat-inline-download">最后 {formatDateTime(selectedItem?.lastTestedAt)}</span>
          </div>
        </div>
        <div className="analytics-hero-chart analytics-probe-chart-shell" ref={chartShellRef}>
          <EChart option={chartOption} style={{ height: compactChart ? 380 : 340, width: "100%" }} updateOptions={chartUpdateOptions} />
          {trendPoints.length ? null : <div className="chart-empty-overlay">当前时间范围内还没有延迟样本</div>}
        </div>
        <div className="analytics-probe-smoke-control-row">
          <div className="analytics-probe-smoke-legend">
            {SMOKE_LEGEND_ITEMS.map((item) => {
              const active = smokeSeriesVisibility[item.key];
              return (
                <button
                  aria-pressed={active}
                  className={`analytics-probe-smoke-legend-item ${active ? "is-active" : "is-muted"}`}
                  key={item.key}
                  onClick={() =>
                    setSmokeSeriesVisibility((current) => ({
                      ...current,
                      [item.key]: !current[item.key],
                    }))
                  }
                  title={`${active ? "隐藏" : "显示"}${item.label}`}
                  type="button"
                >
                  <i aria-hidden="true" className={`analytics-probe-smoke-swatch ${item.swatchClassName}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="analytics-probe-axis-toggle">
            <span>聚焦Y轴</span>
            <StatusSwitch
              checked={focusYAxis}
              offLabel="关闭"
              onChange={setFocusYAxis}
              onLabel="开启"
              title={focusYAxis ? "关闭后从 0ms 到完整最大值显示" : "开启后聚焦主体延迟范围"}
            />
          </div>
        </div>
        <div className="analytics-probe-smoke-stats">
          <span>当前中位延迟：{formatDelay(selectedItem?.p50DelayMs)}</span>
          <span>当前 90 分位：{formatDelay(selectedItem?.p90DelayMs)}</span>
          <span>标准差抖动：{formatDelay(selectedItem?.jitterMs)}</span>
          <span>失败率：{formatPercent(selectedItem?.lossRate)}</span>
        </div>
        <div className="analytics-probe-chart-note">
          <strong>怎么读：</strong>
          橙色主线越低表示常态延迟越低；橙色范围是中位到 90 分位，表示大部分成功样本的主要波动。
          烟雾点越深越大，表示这个延迟附近聚集的单次样本越多；灰色范围是同一时间段内的最小到最大延迟，容易被少数极慢样本拉高。
          底部红色柱表示有失败样本。
          “聚焦Y轴”开启时，Y 轴会聚焦橙色主线、橙色范围和烟雾点的主体值，不一定从 0 开始；关闭后按 0 到完整最大值显示。
          聚焦时灰色极端值可能在顶部或底部被截断，悬浮提示仍会显示真实最小值和最大值。
          高延迟但范围很薄通常是“慢但稳定”，主线不高但灰色或烟雾突然变厚通常是“偶发抖动明显”。
        </div>
      </section>

      <section className="panel analytics-data-table-card analytics-probe-table-card">
        <div className="analytics-table-card-head">
          <div>
            <p className="eyebrow">探测节点</p>
            <h4>节点稳定性</h4>
          </div>
          <div className="analytics-table-tools">
            <input
              className="analytics-table-search"
              placeholder="搜索节点"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </div>
        </div>
        <div className="analytics-data-table-wrap analytics-probe-table-wrap">
          <table className="analytics-data-table analytics-probe-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>最新</th>
                <th>中位</th>
                <th>90 分位</th>
                <th>抖动</th>
                <th>丢包</th>
                <th>样本</th>
                <th>最后错误</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expanded = item.proxyName === expandedProxy;
                return (
                  <Fragment key={item.proxyName}>
                    <ProbeTableRow
                      expanded={expanded}
                      item={item}
                      selected={item.proxyName === selectedItem?.proxyName}
                      onToggle={() => toggleExpandedProxy(item.proxyName)}
                    />
                    {expanded ? (
                      <ProbeSamplesRow
                        error={recentSamplesQuery.error}
                        isLoading={recentSamplesQuery.isLoading}
                        samples={recentSamplesQuery.data?.items ?? []}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!items.length ? <div className="runtime-empty runtime-empty-large">当前范围内还没有节点延迟样本。</div> : null}
        </div>
        <div className="analytics-probe-mobile-list">
          {items.map((item) => (
            <article
              className={`analytics-probe-mobile-card ${item.proxyName === selectedItem?.proxyName ? "is-active" : ""} ${
                item.proxyName === expandedProxy ? "is-expanded" : ""
              }`}
              key={`mobile-${item.proxyName}`}
              role="button"
              tabIndex={0}
              onClick={() => toggleExpandedProxy(item.proxyName)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                toggleExpandedProxy(item.proxyName);
              }}
            >
              <strong>{item.proxyName}</strong>
              <span>{item.proxyType || "proxy"}</span>
              <div>
                <small>中位 {formatDelay(item.p50DelayMs)}</small>
                <small>90 分位 {formatDelay(item.p90DelayMs)}</small>
                <small>抖动 {formatDelay(item.jitterMs)}</small>
                <small>丢包 {formatPercent(item.lossRate)}</small>
              </div>
              {item.lastError ? <em>{formatProbeError(item.lastError)}</em> : null}
              {item.proxyName === expandedProxy ? (
                <ProbeSamplesList
                  error={recentSamplesQuery.error}
                  isLoading={recentSamplesQuery.isLoading}
                  samples={recentSamplesQuery.data?.items ?? []}
                />
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProbeTableRow({
  expanded,
  item,
  onToggle,
  selected,
}: {
  expanded: boolean;
  item: ProxyProbeSummaryItem;
  onToggle: () => void;
  selected: boolean;
}) {
  return (
    <tr className={`${selected ? "is-expanded" : ""} ${expanded ? "is-samples-expanded" : ""}`}>
      <td>
        <button
          aria-expanded={expanded}
          className="analytics-probe-node-button"
          onClick={onToggle}
          type="button"
        >
          <strong>{item.proxyName}</strong>
          <span>{item.proxyType || "proxy"} · {formatDateTime(item.lastTestedAt)}</span>
        </button>
      </td>
      <td>{formatDelay(item.latestDelayMs)}</td>
      <td>{formatDelay(item.p50DelayMs)}</td>
      <td>{formatDelay(item.p90DelayMs)}</td>
      <td className={item.jitterMs && item.jitterMs > 80 ? "analytics-probe-hot" : ""}>{formatDelay(item.jitterMs)}</td>
      <td className={item.lossRate > 0 ? "analytics-probe-loss" : ""}>{formatPercent(item.lossRate)}</td>
      <td>{formatCount(item.sampleCount)}</td>
      <td>
        <span className="analytics-probe-error">{formatProbeError(item.lastError)}</span>
      </td>
    </tr>
  );
}

function ProbeSamplesRow({
  error,
  isLoading,
  samples,
}: {
  error: unknown;
  isLoading: boolean;
  samples: ProxyProbeRecentSample[];
}) {
  return (
    <tr className="analytics-probe-samples-row">
      <td colSpan={8}>
        <ProbeSamplesList error={error} isLoading={isLoading} samples={samples} />
      </td>
    </tr>
  );
}

function ProbeSamplesList({
  error,
  isLoading,
  samples,
}: {
  error: unknown;
  isLoading: boolean;
  samples: ProxyProbeRecentSample[];
}) {
  if (isLoading) {
    return <div className="analytics-probe-samples-panel" onClick={(event) => event.stopPropagation()}>正在加载最近测速记录...</div>;
  }
  if (error) {
    return (
      <div className="analytics-probe-samples-panel is-error" onClick={(event) => event.stopPropagation()}>
        最近测速记录加载失败：{getErrorMessage(error)}
      </div>
    );
  }
  return (
    <div className="analytics-probe-samples-panel" onClick={(event) => event.stopPropagation()}>
      <div className="analytics-probe-samples-head">
        <strong>最近测速</strong>
        <span>{samples.length ? `最近 ${samples.length} 条原始样本` : "暂无原始样本"}</span>
      </div>
      {samples.length ? (
        <div className="analytics-probe-samples-list">
          {samples.map((sample, index) => (
            <div className={`analytics-probe-sample-item ${sample.success ? "is-success" : "is-failure"}`} key={`${sample.roundId}-${sample.testedAt}-${index}`}>
              <span>{formatDateTime(sample.testedAt)}</span>
              <strong>{sample.success ? formatDelay(sample.delayMs) : "失败"}</strong>
              <em>{sample.success ? "成功" : formatProbeError(sample.error)}</em>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
