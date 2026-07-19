import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AnalyticsDetailResponse,
  AnalyticsDimension,
  AnalyticsListItem,
  AnalyticsRuleFlowResponse,
} from "../../../shared/telemetry";
import { EChart } from "../../components/EChart";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { formatBytes } from "../../lib/telemetry";
import { AnalyticsRankStats, AnalyticsSplitBar } from "./AnalyticsCards";
import { AnalyticsDomainStatsTable, AnalyticsIpStatsTable, AnalyticsRegionSummaryTable } from "./AnalyticsTables";
import {
  buildAnalyticsBarChartOption,
  buildAnalyticsDonutChartOption,
  buildAnalyticsRuleFlowOption,
  buildAnalyticsWorldMapOption,
} from "./charts";
import {
  ANALYTICS_COLORS,
  DEFAULT_FLOW_VIEWPORT,
  DIMENSION_DESCRIPTIONS,
  DIMENSION_LABELS,
  FLOW_PAN_STEP,
  FLOW_ZOOM_STEP,
  HIDE_DIMENSION_INTRO,
} from "./constants";
import {
  appendSearchParam,
  buildDetailEndpoint,
  buildTableTitle,
  countryCodeToFlagEmoji,
  getItemCountryCode,
  getItemTotalBytes,
  getRegionHeatColor,
  isMappableRegionItem,
  panFlowViewport,
  percentage,
  sortAnalyticsItems,
  zoomFlowViewport,
} from "./helpers";
import { useContainerWidth, useWorldMapRegistration } from "./hooks";
import { useAnalyticsShell } from "./useAnalyticsShell";
import type { DetailMode, FlowViewport, SortMode } from "./types";

export function AnalyticsDimensionPage({ dimension }: { dimension: AnalyticsDimension }) {
  const { buildSearch, rangeLabel, querySource } = useAnalyticsShell();
  const barsCardRef = useRef<HTMLDivElement | null>(null);
  const ruleFlowShellRef = useRef<HTMLDivElement | null>(null);
  const regionMapShellRef = useRef<HTMLDivElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("traffic");
  const [topLimit, setTopLimit] = useState(20);
  const [detailMode, setDetailMode] = useState<DetailMode>("domains");
  const [flowMode, setFlowMode] = useState<"focus" | "panorama">("focus");
  const [flowSourceIp, setFlowSourceIp] = useState("");
  const [flowViewport, setFlowViewport] = useState<FlowViewport>(DEFAULT_FLOW_VIEWPORT);
  const [showAllRegions, setShowAllRegions] = useState(false);
  const search = buildSearch(100);
  const ruleFlowSearch = useMemo(() => appendSearchParam(search, "sourceIp", flowSourceIp), [flowSourceIp, search]);
  const barsCardWidth = useContainerWidth(barsCardRef);
  const ruleFlowShellWidth = useContainerWidth(ruleFlowShellRef);
  const isCompactRuleFlow = ruleFlowShellWidth > 0 && ruleFlowShellWidth < 560;
  const regionMapShellWidth = useContainerWidth(regionMapShellRef);
  const isCompactRegionMap = regionMapShellWidth > 0 && regionMapShellWidth < 560;
  const worldMapReady = useWorldMapRegistration(dimension === "regions");

  const listEndpoint = useMemo(() => {
    if (dimension === "domains" && detailMode === "ips") {
      return `/api/analytics/ip-addresses${search}`;
    }
    return `/api/analytics/${dimension}${search}`;
  }, [detailMode, dimension, search]);

  const listQuery = useQuery({
    queryKey: ["analytics-dimension", dimension, detailMode, search],
    queryFn: () => apiRequest<{ querySource: string; items: AnalyticsListItem[] }>(listEndpoint),
  });

  const detailEndpoint = useMemo(
    () => buildDetailEndpoint(dimension, selectedKey, detailMode, search),
    [detailMode, dimension, search, selectedKey],
  );

  const detailQuery = useQuery({
    queryKey: ["analytics-detail", dimension, selectedKey, detailMode, search],
    queryFn: () => apiRequest<AnalyticsDetailResponse>(detailEndpoint!),
    enabled: Boolean(detailEndpoint),
  });

  const ruleFlowSourcesQuery = useQuery({
    queryKey: ["analytics-rule-flow-sources", search],
    queryFn: () => apiRequest<AnalyticsRuleFlowResponse>(`/api/analytics/rules/flow${search}`),
    enabled: dimension === "rules",
  });

  const ruleFlowQuery = useQuery({
    queryKey: ["analytics-rule-flow", ruleFlowSearch],
    queryFn: () => apiRequest<AnalyticsRuleFlowResponse>(`/api/analytics/rules/flow${ruleFlowSearch}`),
    enabled: dimension === "rules" && Boolean(flowSourceIp),
  });

  const filteredItems = useMemo(() => {
    return sortAnalyticsItems(listQuery.data?.items ?? [], sortMode);
  }, [listQuery.data?.items, sortMode]);

  const filteredDetailItems = useMemo(() => {
    return sortAnalyticsItems(detailQuery.data?.items ?? [], sortMode);
  }, [detailQuery.data?.items, sortMode]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !filteredItems.some((item) => item.key === selectedKey)) {
      setSelectedKey(filteredItems[0]?.key ?? null);
    }
  }, [filteredItems, selectedKey]);

  const selectedItem = filteredItems.find((item) => item.key === selectedKey) ?? null;
  const hasDetailSelection = dimension !== "regions" && Boolean(selectedKey) && Boolean(detailQuery.data?.items?.length);
  const currentItems = hasDetailSelection ? filteredDetailItems : filteredItems;
  const topChartCount = barsCardWidth >= 560 ? Math.min(topLimit, 18) : Math.min(topLimit, 12);
  const focusItems = (dimension === "domains" || dimension === "regions" ? filteredItems : currentItems).slice(0, topChartCount);

  const donutItems = filteredItems.slice(0, 6);
  const regionDetailItems = showAllRegions ? filteredItems : filteredItems.slice(0, 20);
  const hasMappableRegions = useMemo(() => filteredItems.some(isMappableRegionItem), [filteredItems]);
  const filteredItemsMaxTotal = useMemo(
    () => filteredItems.reduce((max, item) => Math.max(max, getItemTotalBytes(item)), 1),
    [filteredItems],
  );
  const donutChartOption = useMemo(() => buildAnalyticsDonutChartOption(donutItems), [donutItems]);
  const barsChartOption = useMemo(
    () => buildAnalyticsBarChartOption(focusItems.slice(0, topLimit), dimension === "regions" ? "region" : detailMode),
    [detailMode, dimension, focusItems, topLimit],
  );
  const barsChartHeight = Math.min(360, Math.max(104, focusItems.length * 34 + 44));
  const worldMapOption = useMemo(
    () => buildAnalyticsWorldMapOption(filteredItems, worldMapReady, isCompactRegionMap),
    [filteredItems, isCompactRegionMap, worldMapReady],
  );
  const detailTitle =
    dimension === "rules"
      ? "关联域名"
      : dimension === "proxies"
        ? "关联域名"
        : dimension === "devices"
          ? "关联域名"
          : dimension === "regions"
            ? "地区详情"
            : detailMode === "ips"
              ? "热门 IP 地址"
              : "热门域名";

  const firstError = [listQuery.error, detailQuery.error].filter(Boolean).map((error) => getErrorMessage(error))[0];
  const ruleFlowSourceIps = useMemo(() => {
    const sourceNodes = ruleFlowSourcesQuery.data?.nodes.filter((node) => node.nodeType === "source") ?? [];
    return sourceNodes
      .map((node) => ({ ip: node.label, total: node.uploadBytes + node.downloadBytes }))
      .sort((left, right) => right.total - left.total);
  }, [ruleFlowSourcesQuery.data?.nodes]);
  useEffect(() => {
    if (flowSourceIp && ruleFlowSourceIps.length > 0 && !ruleFlowSourceIps.some((source) => source.ip === flowSourceIp)) {
      setFlowSourceIp("");
    }
  }, [flowSourceIp, ruleFlowSourceIps]);
  const ruleFlowData = flowSourceIp ? ruleFlowQuery.data : ruleFlowSourcesQuery.data;
  const ruleFlowOption = useMemo(
    () => buildAnalyticsRuleFlowOption(ruleFlowData, selectedKey, flowMode, flowViewport, isCompactRuleFlow),
    [flowMode, flowViewport, isCompactRuleFlow, ruleFlowData, selectedKey],
  );

  if (dimension === "domains") {
    return (
      <AnalyticsDomainsPageContent
        detailMode={detailMode}
        firstError={firstError}
        items={filteredItems}
        rangeLabel={rangeLabel}
        search={search}
        setDetailMode={setDetailMode}
        topLimit={topLimit}
        setTopLimit={setTopLimit}
      />
    );
  }

  return (
    <div className={`analytics-view analytics-dimension-${dimension}`}>
      {firstError ? <div className="runtime-banner is-error">分析数据加载失败：{firstError}</div> : null}

      {HIDE_DIMENSION_INTRO.has(dimension) ? null : (
        <section className="panel analytics-dimension-head">
          <div>
            <p className="eyebrow">{DIMENSION_LABELS[dimension]}</p>
            <h3>{DIMENSION_LABELS[dimension]}分析</h3>
            <p className="muted">{DIMENSION_DESCRIPTIONS[dimension]}</p>
          </div>
          <div className="analytics-dimension-head-actions">
            <span className="runtime-choice-pill">{rangeLabel}</span>
            <span className="runtime-choice-pill">{querySource}</span>
            <span className="runtime-choice-pill">{filteredItems.length} 项</span>
          </div>
        </section>
      )}

      {dimension !== "regions" ? (
        <div className="analytics-hero-triple">
          <section className="panel analytics-donut-card">
            <div className="analytics-card-head">
              <div>
                <p className="eyebrow">{DIMENSION_LABELS[dimension]}</p>
                <h4>流量占比</h4>
              </div>
            </div>
            <div className="analytics-donut-shell">
              <EChart option={donutChartOption} style={{ height: 216, width: "100%" }} />
              <div className="analytics-donut-caption">前 {Math.min(4, donutItems.length || 4)}</div>
            </div>
            <div className="analytics-mini-ranks">
              {donutItems.slice(0, 4).map((item, index) => (
                <button
                  className={`analytics-mini-rank ${selectedKey === item.key ? "is-active" : ""}`}
                  key={item.key}
                  onClick={() => setSelectedKey(item.key)}
                  type="button"
                >
                  <span className="analytics-rank-badge">{index + 1}</span>
                  <span className="analytics-mini-rank-label">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel analytics-list-card">
            <div className="analytics-card-head">
              <div>
                <p className="eyebrow">{DIMENSION_LABELS[dimension]}</p>
                <h4>{DIMENSION_LABELS[dimension]}排行</h4>
              </div>
              <div className="analytics-segmented analytics-top-limit">
                {[10, 20, 50, 100].map((value) => (
                  <button
                    className={topLimit === value ? "is-active" : ""}
                    key={value}
                    onClick={() => setTopLimit(value)}
                    type="button"
                  >
                    前 {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="analytics-ranked-stack">
              {filteredItems.slice(0, 8).map((item, index) => (
                <button
                  className={`analytics-ranked-card ${selectedKey === item.key ? "is-active" : ""}`}
                  key={item.key}
                  onClick={() => setSelectedKey(item.key)}
                  type="button"
                >
                  <div className="analytics-ranked-main">
                    <span className="analytics-rank-badge">{index + 1}</span>
                    <strong>{item.label}</strong>
                    <div className="analytics-ranked-metrics">
                      <span>{formatBytes(item.downloadBytes + item.uploadBytes)}</span>
                      <small>{percentage(item.downloadBytes + item.uploadBytes, filteredItems).toFixed(1)}%</small>
                    </div>
                  </div>
                  <AnalyticsSplitBar item={item} total={filteredItemsMaxTotal} />
                  <AnalyticsRankStats item={item} items={filteredItems} />
                </button>
              ))}
              {!filteredItems.length ? <div className="empty-state compact-empty-state">当前范围内还没有可分析的数据。</div> : null}
            </div>
          </section>

          <section className="panel analytics-bars-card" ref={barsCardRef}>
            <div className="analytics-card-head">
              <div>
                <p className="eyebrow">{detailTitle}</p>
                <h4>{detailMode === "ips" ? "热门 IP 地址" : "热门域名"}</h4>
              </div>
              {selectedItem && dimension !== "domains" ? (
                <span className="analytics-context-label">{selectedItem.label}</span>
              ) : null}
            </div>
            <div className="analytics-bar-shell">
              <EChart option={barsChartOption} style={{ height: barsChartHeight, width: "100%" }} />
            </div>
          </section>
        </div>
      ) : null}

      {dimension === "regions" ? (
        <>
          <section className="panel analytics-region-stage">
            <div className="analytics-card-head">
              <div>
                <p className="eyebrow">地区</p>
                <h4>全球地区流量</h4>
                <p className="muted">保留世界分布图、热度图例和地区详情区，便于快速查看不同地区的流量占比。</p>
              </div>
            </div>
            <div className="analytics-region-map-shell" ref={regionMapShellRef}>
              <div className="analytics-region-map">
                {worldMapReady && hasMappableRegions ? (
                  <>
                    <EChart option={worldMapOption} style={{ height: isCompactRegionMap ? 320 : 540, width: "100%" }} />
                    <div className="analytics-map-hover-hint">ⓘ 点按或悬停地区查看详情</div>
                  </>
                ) : (
                  <div className="empty-state compact-empty-state analytics-map-empty-state">
                    {worldMapReady ? "当前没有可映射到国家/地区的数据，通常是 MMDB 未命中或数据都落到 Unknown。" : "地图资源加载中…"}
                  </div>
                )}
              </div>
              <div className="analytics-region-legend">
                <div className="analytics-region-scale">
                  <span>流量：</span>
                  <span>低</span>
                  <div className="analytics-region-scale-bar" />
                  <span>高</span>
                </div>
                <div className="analytics-region-legend-items">
                  {filteredItems.slice(0, 5).map((item, index) => (
                    <button
                      className={`analytics-region-legend-item ${selectedKey === item.key ? "is-active" : ""}`}
                      key={item.key}
                      onClick={() => setSelectedKey(item.key)}
                      type="button"
                    >
                      <span
                        className="analytics-region-legend-dot"
                        style={{ backgroundColor: getRegionHeatColor(index) }}
                      />
                      <span>{item.label}</span>
                      <strong>{formatBytes(item.downloadBytes + item.uploadBytes)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel analytics-region-details-panel">
            <div className="analytics-card-head">
              <div>
                <p className="eyebrow">按地区汇总</p>
                <h4>地区详情</h4>
                <p className="muted">显示 {regionDetailItems.length} / {filteredItems.length} 个地区</p>
              </div>
              {filteredItems.length > 20 ? (
                <button className="button-secondary analytics-region-toggle" onClick={() => setShowAllRegions((current) => !current)} type="button">
                  {showAllRegions ? "收起" : "查看全部"}
                </button>
              ) : null}
            </div>
            <div className="analytics-region-grid">
              {regionDetailItems.map((item, index) => {
                const percent = percentage(item.downloadBytes + item.uploadBytes, filteredItems);
                const countryCode = getItemCountryCode(item);
                return (
                  <button
                    className={`analytics-region-card ${selectedKey === item.key ? "is-active" : ""}`}
                    key={item.key}
                    onClick={() => setSelectedKey(item.key)}
                    type="button"
                  >
                    <div className="analytics-region-card-head">
                      <div className="analytics-region-title">
                        <span className="analytics-region-flag">{countryCodeToFlagEmoji(countryCode)}</span>
                        <strong>{item.label}</strong>
                      </div>
                      <span>{percent.toFixed(1)}%</span>
                    </div>
                    <div className="analytics-region-total">{formatBytes(item.downloadBytes + item.uploadBytes)}</div>
                    <div className="analytics-region-bar">
                      <span style={{ width: `${Math.max(percent, 3)}%`, backgroundColor: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }} />
                    </div>
                    <div className="analytics-region-card-meta">
                      <span>↓ {formatBytes(item.downloadBytes)}</span>
                      <span>↑ {formatBytes(item.uploadBytes)}</span>
                      <span>{item.connectionCount} 个连接</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : dimension === "rules" ? (
        <section className="panel analytics-flow-panel">
          <div className="analytics-card-head">
            <div>
              <p className="eyebrow">规则链路</p>
              <h4>规则链路视图</h4>
            </div>
            <div className="analytics-segmented">
              <button className={flowMode === "focus" ? "is-active" : ""} onClick={() => setFlowMode("focus")} type="button">
                聚焦
              </button>
              <button className={flowMode === "panorama" ? "is-active" : ""} onClick={() => setFlowMode("panorama")} type="button">
                全景
              </button>
            </div>
          </div>
          <div className="analytics-rule-flow-shell" ref={ruleFlowShellRef}>
            <div className="analytics-rule-flow-chart-scroll">
              <EChart option={ruleFlowOption} style={{ height: isCompactRuleFlow ? 520 : 560, width: "100%" }} />
            </div>
            <div className="analytics-flow-filter">
              <div className="analytics-flow-filter-label">
                <span>来源 IP</span>
                <strong>{flowSourceIp || "全部 IP"}</strong>
              </div>
              <select value={flowSourceIp} onChange={(event) => setFlowSourceIp(event.target.value)} aria-label="筛选规则链路来源 IP">
                <option value="">全部 IP</option>
                {ruleFlowSourceIps.map((source) => (
                  <option key={source.ip} value={source.ip}>
                    {source.ip} · {formatBytes(source.total)}
                  </option>
                ))}
              </select>
            </div>
            <div className="analytics-flow-controls" aria-label="规则链路图控制">
              <div className="analytics-flow-control-group">
                <button onClick={() => setFlowViewport((current) => zoomFlowViewport(current, FLOW_ZOOM_STEP))} type="button" aria-label="放大规则链路图">
                  +
                </button>
                <button onClick={() => setFlowViewport((current) => zoomFlowViewport(current, -FLOW_ZOOM_STEP))} type="button" aria-label="缩小规则链路图">
                  -
                </button>
                <span>{Math.round(flowViewport.zoom * 100)}%</span>
              </div>
              <div className="analytics-flow-control-group">
                <button onClick={() => setFlowViewport((current) => panFlowViewport(current, -FLOW_PAN_STEP, 0))} type="button" aria-label="向左移动规则链路图">
                  ←
                </button>
                <button onClick={() => setFlowViewport((current) => panFlowViewport(current, 0, -FLOW_PAN_STEP))} type="button" aria-label="向上移动规则链路图">
                  ↑
                </button>
                <button onClick={() => setFlowViewport((current) => panFlowViewport(current, 0, FLOW_PAN_STEP))} type="button" aria-label="向下移动规则链路图">
                  ↓
                </button>
                <button onClick={() => setFlowViewport((current) => panFlowViewport(current, FLOW_PAN_STEP, 0))} type="button" aria-label="向右移动规则链路图">
                  →
                </button>
              </div>
              <button className="analytics-flow-reset" onClick={() => setFlowViewport(DEFAULT_FLOW_VIEWPORT)} type="button">
                重置
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {dimension !== "regions" ? (
        <>
          <div className="analytics-table-switcher">
            <div className="analytics-segmented">
              <button className={detailMode === "domains" ? "is-active" : ""} onClick={() => setDetailMode("domains")} type="button">
                域名
              </button>
              <button className={detailMode === "ips" ? "is-active" : ""} onClick={() => setDetailMode("ips")} type="button">
                IP 地址
              </button>
            </div>
          </div>
          {detailMode === "domains" ? (
            <AnalyticsDomainStatsTable
              contextDimension={dimension}
              contextItem={selectedItem}
              items={currentItems}
              rangeSearch={search}
              title={buildTableTitle(dimension, detailMode, selectedItem)}
            />
          ) : (
            <AnalyticsIpStatsTable
              contextDimension={dimension}
              contextItem={selectedItem}
              items={currentItems}
              rangeSearch={search}
              title={buildTableTitle(dimension, detailMode, selectedItem)}
            />
          )}
        </>
      ) : (
        <AnalyticsRegionSummaryTable
          items={regionDetailItems}
          title="地区详情"
          totalItems={filteredItems.length}
          expanded={showAllRegions}
          onToggleExpanded={filteredItems.length > 20 ? () => setShowAllRegions((current) => !current) : undefined}
        />
      )}
    </div>
  );
}

function AnalyticsDomainsPageContent({
  detailMode,
  firstError,
  items,
  rangeLabel,
  search,
  setDetailMode,
  topLimit,
  setTopLimit,
}: {
  detailMode: DetailMode;
  firstError: string | undefined;
  items: AnalyticsListItem[];
  rangeLabel: string;
  search: string;
  setDetailMode: Dispatch<SetStateAction<DetailMode>>;
  topLimit: number;
  setTopLimit: Dispatch<SetStateAction<number>>;
}) {
  const topItems = useMemo(() => items.slice(0, topLimit), [items, topLimit]);
  const barsChartOption = useMemo(() => buildAnalyticsBarChartOption(topItems, detailMode), [detailMode, topItems]);

  return (
    <div className="analytics-view">
      {firstError ? <div className="runtime-banner is-error">分析数据加载失败：{firstError}</div> : null}

      <section className="panel analytics-domains-hero">
        <div className="analytics-card-head">
          <div>
            <p className="eyebrow">{detailMode === "domains" ? "按流量排序的热门域名" : "按流量排序的热门 IP 地址"}</p>
            <h4>{detailMode === "domains" ? "热门域名流量排行" : "热门目标 IP 流量排行"}</h4>
          </div>
          <div className="analytics-hero-meta">
            <span className="runtime-choice-pill">{rangeLabel}</span>
            <div className="analytics-segmented analytics-top-limit">
              {[10, 20, 50, 100].map((value) => (
                <button className={topLimit === value ? "is-active" : ""} key={value} onClick={() => setTopLimit(value)} type="button">
                  前 {value}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="analytics-hero-chart">
          <EChart option={barsChartOption} style={{ height: 420, width: "100%" }} />
        </div>
      </section>

      <div className="analytics-table-switcher">
        <div className="analytics-segmented">
          <button className={detailMode === "domains" ? "is-active" : ""} onClick={() => setDetailMode("domains")} type="button">
            域名
          </button>
          <button className={detailMode === "ips" ? "is-active" : ""} onClick={() => setDetailMode("ips")} type="button">
            IP 地址
          </button>
        </div>
      </div>

      {detailMode === "domains" ? (
        <AnalyticsDomainStatsTable contextDimension="domains" contextItem={null} items={items} rangeSearch={search} title="热门域名" />
      ) : (
        <AnalyticsIpStatsTable contextDimension="domains" contextItem={null} items={items} rangeSearch={search} title="热门 IP 地址" />
      )}
    </div>
  );
}
