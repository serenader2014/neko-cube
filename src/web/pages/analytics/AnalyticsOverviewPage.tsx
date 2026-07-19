import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsListItem, AnalyticsSummary, AnalyticsTrendPoint } from "../../../shared/telemetry";
import { EChart } from "../../components/EChart";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { formatBytes, formatCount } from "../../lib/telemetry";
import { AnalyticsLeaderboardCard, AnalyticsMetricCard } from "./AnalyticsCards";
import { buildAnalyticsTrendChartOption } from "./charts";
import { useAnalyticsShell } from "./useAnalyticsShell";
import type { SortMode } from "./types";

export function AnalyticsOverviewPage() {
  const { buildSearch } = useAnalyticsShell();
  const [domainSort, setDomainSort] = useState<SortMode>("traffic");
  const [proxySort, setProxySort] = useState<SortMode>("traffic");
  const [regionSort, setRegionSort] = useState<SortMode>("traffic");
  const search = buildSearch(100);
  const summaryQuery = useQuery({
    queryKey: ["analytics-summary", search],
    queryFn: () => apiRequest<AnalyticsSummary>(`/api/analytics/summary${search}`),
  });
  const trendQuery = useQuery({
    queryKey: ["analytics-trend", search],
    queryFn: () => apiRequest<{ querySource: string; points: AnalyticsTrendPoint[] }>(`/api/analytics/trend${search}`),
  });
  const domainsQuery = useQuery({
    queryKey: ["analytics-overview", "domains", search],
    queryFn: () => apiRequest<{ querySource: string; items: AnalyticsListItem[] }>(`/api/analytics/domains${search}`),
  });
  const proxiesQuery = useQuery({
    queryKey: ["analytics-overview", "proxies", search],
    queryFn: () => apiRequest<{ querySource: string; items: AnalyticsListItem[] }>(`/api/analytics/proxies${search}`),
  });
  const rulesQuery = useQuery({
    queryKey: ["analytics-overview", "rules", search],
    queryFn: () => apiRequest<{ querySource: string; items: AnalyticsListItem[] }>(`/api/analytics/rules${search}`),
  });
  const regionsQuery = useQuery({
    queryKey: ["analytics-overview", "regions", search],
    queryFn: () => apiRequest<{ querySource: string; items: AnalyticsListItem[] }>(`/api/analytics/regions${search}`),
  });

  const firstError = [
    summaryQuery.error,
    trendQuery.error,
    domainsQuery.error,
    proxiesQuery.error,
    rulesQuery.error,
    regionsQuery.error,
  ]
    .filter(Boolean)
    .map((error) => getErrorMessage(error))[0];
  const trendChartOption = useMemo(
    () => buildAnalyticsTrendChartOption(trendQuery.data?.points ?? []),
    [trendQuery.data?.points],
  );

  return (
    <div className="analytics-view">
      {firstError ? <div className="runtime-banner is-error">分析数据加载失败：{firstError}</div> : null}

      <div className="analytics-stat-grid">
        <AnalyticsMetricCard label="总下载" value={formatBytes(summaryQuery.data?.downloadBytes ?? 0)} tone="download" />
        <AnalyticsMetricCard label="总上传" value={formatBytes(summaryQuery.data?.uploadBytes ?? 0)} tone="upload" />
        <AnalyticsMetricCard
          label="总流量"
          value={formatBytes((summaryQuery.data?.downloadBytes ?? 0) + (summaryQuery.data?.uploadBytes ?? 0))}
          tone="traffic"
        />
        <AnalyticsMetricCard label="连接数" value={formatCount(summaryQuery.data?.connectionCount ?? 0)} tone="connections" />
        <AnalyticsMetricCard label="域名数" value={formatCount(domainsQuery.data?.items.length ?? 0)} tone="domains" />
        <AnalyticsMetricCard label="规则数" value={formatCount(rulesQuery.data?.items.length ?? 0)} tone="rules" />
      </div>

      <section className="panel analytics-hero-panel">
        <div className="analytics-hero-head">
          <div>
            <p className="eyebrow">流量趋势</p>
            <h3>总流量趋势</h3>
            <p className="muted">按当前时间范围自动切换统计粒度，沿用后端现有的 1 分钟 / 5 分钟 / 1 小时策略。</p>
          </div>
          <div className="analytics-hero-meta">
            <span className="analytics-stat-inline analytics-stat-inline-download">↓ {formatBytes(summaryQuery.data?.downloadBytes ?? 0)}</span>
            <span className="analytics-stat-inline analytics-stat-inline-upload">↑ {formatBytes(summaryQuery.data?.uploadBytes ?? 0)}</span>
          </div>
        </div>
        <div className="analytics-hero-chart">
          <EChart option={trendChartOption} style={{ height: 320, width: "100%" }} />
          {trendQuery.data?.points.length ? null : <div className="chart-empty-overlay">当前时间范围内还没有趋势数据</div>}
        </div>
      </section>

      <div className="analytics-top-grid">
        <AnalyticsLeaderboardCard
          title="热门域名"
          items={domainsQuery.data?.items ?? []}
          label="域名热度"
          route="domains"
          sortMode={domainSort}
          onSortChange={setDomainSort}
        />
        <AnalyticsLeaderboardCard
          title="热门代理"
          items={proxiesQuery.data?.items ?? []}
          label="代理承载"
          route="proxies"
          sortMode={proxySort}
          onSortChange={setProxySort}
        />
        <AnalyticsLeaderboardCard
          title="热门地区"
          items={regionsQuery.data?.items ?? []}
          label="地区分布"
          route="regions"
          sortMode={regionSort}
          onSortChange={setRegionSort}
        />
      </div>
    </div>
  );
}
