import {
  type SetStateAction,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import type {
  MihomoConnection,
  RuntimeLogLevel,
  RuntimeOverviewState,
  RuntimeProxyGroup,
  RuntimeSnapshot,
} from "../../../shared/telemetry";
import { EChart } from "../../components/EChart";
import { ModuleShell } from "../../components/ModuleShell";
import {
  DocGlyph,
  GroupOffGlyph,
  GroupOnGlyph,
  HomeGlyph,
  NetworkGlyph,
  NodeGlyph,
  PauseGlyph,
  PlayGlyph,
  SortAscGlyph,
  SortDescGlyph,
} from "../../components/icons";
import { pushToast } from "../../components/toast";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { formatBytes, formatRate } from "../../lib/telemetry";
import { buildRuntimeConnectionsChartOption, buildRuntimeTrafficChartOption } from "./charts";
import { OverviewStatCard, Pager, renderSortMark } from "./components";
import { EMPTY_CONNECTIONS, PROXY_SEGMENT_COLORS } from "./constants";
import {
  bestDelayLabel,
  buildProxySegments,
  buildProxyTrafficData,
  buildRuntimeOverviewClosedConnections,
  buildRuntimeOverviewState,
  buildRuntimeTrafficWindow,
  compareProxyGroups,
  formatConnectionSource,
  formatDelayChip,
  formatRuntimeAge,
  getConnectionColumnValue,
  getConnectionTitle,
  getRuntimeSection,
  matchesConnectionSearch,
} from "./helpers";
import { useRuntimeNow } from "./hooks";
import type {
  ConnectionGroupKey,
  ConnectionSortDirection,
  ConnectionSortKey,
  ConnectionTab,
  RuntimeNavItem,
  RuntimeShellContext,
  StreamState,
} from "./types";
import { useRuntimeShell } from "./useRuntimeShell";


const RUNTIME_NAV_ITEMS: RuntimeNavItem[] = [
  { to: "overview", label: "总览", icon: (active) => <HomeGlyph active={active} /> },
  { to: "proxies", label: "代理", icon: (active) => <NodeGlyph active={active} /> },
  { to: "connections", label: "连接", icon: (active) => <NetworkGlyph active={active} /> },
  { to: "logs", label: "日志", icon: (active) => <DocGlyph active={active} /> },
];


export function RuntimePage() {
  const location = useLocation();
  const activeRuntimeSection = getRuntimeSection(location.pathname) ?? "overview";
  const snapshotQuery = useQuery({
    queryKey: ["runtime-snapshot"],
    queryFn: () => apiRequest<RuntimeSnapshot>("/api/runtime/snapshot"),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [overviewState, setOverviewState] = useState<RuntimeOverviewState | null>(null);
  const [logsPaused, setLogsPaused] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const reconnectTimerRef = useRef<number | null>(null);
  const logsPausedRef = useRef(logsPaused);
  const activeRuntimeSectionRef = useRef(activeRuntimeSection);
  const updateSnapshot = (updater: SetStateAction<RuntimeSnapshot | null>) => {
    startTransition(() => {
      setSnapshot(updater);
    });
  };

  useEffect(() => {
    if (snapshotQuery.data) {
      updateSnapshot(snapshotQuery.data);
      setOverviewState(buildRuntimeOverviewState(snapshotQuery.data));
    }
  }, [snapshotQuery.data]);

  useEffect(() => {
    logsPausedRef.current = logsPaused;
  }, [logsPaused]);

  useEffect(() => {
    activeRuntimeSectionRef.current = activeRuntimeSection;
  }, [activeRuntimeSection]);

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;

    const clearReconnect = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      clearReconnect();
      setStreamState((current) => (current === "connected" ? current : "connecting"));
      source = new EventSource(`/api/runtime/events?section=${activeRuntimeSection}`);

      const attach = <T,>(eventName: string, handler: (payload: T) => void) => {
        const listener = (event: MessageEvent<string>) => {
          handler(JSON.parse(event.data) as T);
          setStreamState("connected");
        };
        source?.addEventListener(eventName, listener);
        return listener;
      };

      const listeners = [
        ["snapshot", attach<RuntimeSnapshot>("snapshot", (payload) => updateSnapshot(payload))],
        ["overview", attach<RuntimeOverviewState>("overview", (payload) => setOverviewState(payload))],
        [
          "health",
          attach<RuntimeSnapshot["health"]>("health", (payload) =>
            updateSnapshot((current) => (current ? { ...current, health: payload } : current)),
          ),
        ],
        [
          "traffic",
          attach<Pick<RuntimeSnapshot, "latestTraffic" | "trafficHistory" | "totals">>("traffic", (payload) => {
            if (activeRuntimeSectionRef.current !== "overview") {
              return;
            }
            updateSnapshot((current) => (current ? { ...current, ...payload } : current));
          }),
        ],
        [
          "connections",
          attach<Pick<RuntimeSnapshot, "activeConnections" | "recentClosedConnections" | "totals" | "trafficHistory">>(
            "connections",
            (payload) => {
              if (activeRuntimeSectionRef.current !== "overview" && activeRuntimeSectionRef.current !== "connections") {
                return;
              }
              updateSnapshot((current) => (current ? { ...current, ...payload } : current));
            },
          ),
        ],
        [
          "logs",
          attach<RuntimeSnapshot["logs"]>("logs", (payload) =>
            updateSnapshot((current) => {
              if (!current || logsPausedRef.current || activeRuntimeSectionRef.current !== "logs") {
                return current;
              }
              return { ...current, logs: payload };
            }),
          ),
        ],
        [
          "proxies",
          attach<RuntimeSnapshot["proxies"]>("proxies", (payload) => {
            if (activeRuntimeSectionRef.current !== "proxies") {
              return;
            }
            updateSnapshot((current) => (current ? { ...current, proxies: payload } : current));
          }),
        ],
      ] as const;

      source.onopen = () => setStreamState("connected");
      source.onerror = () => {
        for (const [eventName, listener] of listeners) {
          source?.removeEventListener(eventName, listener as EventListener);
        }
        source?.close();
        source = null;
        if (disposed) {
          return;
        }
        setStreamState("reconnecting");
        reconnectTimerRef.current = window.setTimeout(() => {
          if (!disposed) {
            connect();
          }
        }, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnect();
      source?.close();
    };
  }, [activeRuntimeSection]);

  useEffect(() => {
    if (!snapshot?.proxies.length) {
      return;
    }
    setSelectedOptions((current) => {
      const next = { ...current };
      for (const group of snapshot.proxies) {
        if (!next[group.name]) {
          next[group.name] = group.now || group.all[0] || "";
        }
      }
      return next;
    });
  }, [snapshot?.proxies]);

  const logLevelMutation = useMutation<RuntimeSnapshot, Error, RuntimeLogLevel>({
    mutationFn: (level) =>
      apiRequest<RuntimeSnapshot>("/api/runtime/log-level", {
        method: "PUT",
        body: JSON.stringify({ level }),
      }),
    onSuccess: (data) => {
      updateSnapshot(data);
      pushToast({ tone: "success", message: "日志级别已更新。" });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  const clearLogsMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      await apiRequest("/api/runtime/logs", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      updateSnapshot((current) => (current ? { ...current, logs: [] } : current));
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  const selectorMutation = useMutation<RuntimeProxyGroup[], Error, { group: string; name: string }>({
    mutationFn: ({ group, name }) =>
      apiRequest<RuntimeProxyGroup[]>(`/api/runtime/selectors/${encodeURIComponent(group)}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (groups, variables) => {
      updateSnapshot((current) => (current ? { ...current, proxies: groups } : current));
      setSelectedOptions((current) => ({
        ...current,
        [variables.group]: variables.name,
      }));
      pushToast({ tone: "success", message: "节点已切换。" });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  const proxyDelayMutation = useMutation<RuntimeProxyGroup[], Error, string>({
    mutationFn: (group) =>
      apiRequest<RuntimeProxyGroup[]>(`/api/runtime/proxies/${encodeURIComponent(group)}/delay`, {
        method: "POST",
      }),
    onSuccess: (groups, group) => {
      updateSnapshot((current) => (current ? { ...current, proxies: groups } : current));
      pushToast({ tone: "success", message: `已完成 ${group} 节点测速。` });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  const refreshProxiesMutation = useMutation<RuntimeProxyGroup[], Error, void>({
    mutationFn: () => apiRequest<RuntimeProxyGroup[]>("/api/runtime/proxies"),
    onSuccess: (groups) => updateSnapshot((current) => (current ? { ...current, proxies: groups } : current)),
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  const streamNotice =
    streamState === "reconnecting"
      ? "实时事件流暂时断开，正在重连。"
      : streamState === "connecting"
        ? "正在建立实时事件流。"
        : null;

  const context = useMemo<RuntimeShellContext>(
    () => ({
      snapshot,
      overviewState,
      snapshotError: snapshotQuery.isError ? getErrorMessage(snapshotQuery.error) : null,
      streamState,
      streamNotice,
      selectedOptions,
      setSelectedOptions,
      logsPaused,
      setLogsPaused,
      selectorMutation,
      proxyDelayMutation,
      logLevelMutation,
      clearLogsMutation,
      refreshProxiesMutation,
    }),
    [
      clearLogsMutation,
      logLevelMutation,
      logsPaused,
      proxyDelayMutation,
      refreshProxiesMutation,
      selectedOptions,
      selectorMutation,
      snapshot,
      overviewState,
      snapshotQuery.error,
      snapshotQuery.isError,
      streamNotice,
      streamState,
    ],
  );

  return (
    <ModuleShell
      eyebrow="运行时"
      title="Mihomo 实时控制台"
      description="查看实时流量、节点切换、活动连接和运行日志。所有请求都通过当前服务转发，不直接暴露控制器。"
      navLabel="运行时导航"
      tabs={RUNTIME_NAV_ITEMS}
      outletContext={context}
      actions={
        <>
          {snapshot?.health.connected === false ? <span className="runtime-status-pill is-error">控制器离线</span> : null}
          {streamState !== "connected" ? (
            <span className="runtime-status-pill is-warn">
              {streamState === "reconnecting" ? "数据流重连中" : "数据流连接中"}
            </span>
          ) : null}
        </>
      }
      banners={
        <>
          {context.snapshotError ? (
            <div className="runtime-banner is-error">运行时快照加载失败：{context.snapshotError}</div>
          ) : null}
          {context.streamNotice ? <div className="runtime-banner">{context.streamNotice}</div> : null}
          {snapshot && !snapshot.health.telemetryActive ? (
            <div className="runtime-banner">当前遥测已关闭，页面只展示最近一次快照。</div>
          ) : null}
        </>
      }
    />
  );
}

export function RuntimeOverviewPage() {
  const { snapshot, overviewState } = useRuntimeShell();
  const nowMs = useRuntimeNow();
  const trafficWindow = useMemo(
    () =>
      buildRuntimeTrafficWindow(snapshot?.trafficHistory ?? [], nowMs, {
        up: snapshot?.latestTraffic?.up ?? 0,
        down: snapshot?.latestTraffic?.down ?? 0,
        activeConnections: snapshot?.totals.activeConnections ?? 0,
      }),
    [nowMs, snapshot?.latestTraffic?.down, snapshot?.latestTraffic?.up, snapshot?.totals.activeConnections, snapshot?.trafficHistory],
  );
  const proxyTraffic = useMemo(
    () => overviewState?.proxyTraffic ?? buildProxyTrafficData(snapshot?.activeConnections ?? []),
    [overviewState?.proxyTraffic, snapshot?.activeConnections],
  );
  const recentClosed = useMemo(
    () => overviewState?.recentClosedConnections ?? buildRuntimeOverviewClosedConnections(snapshot?.recentClosedConnections ?? []),
    [overviewState?.recentClosedConnections, snapshot?.recentClosedConnections],
  );
  const trafficChartOption = useMemo(() => buildRuntimeTrafficChartOption(trafficWindow.points, trafficWindow.domain), [trafficWindow.domain, trafficWindow.points]);
  const connectionsChartOption = useMemo(
    () => buildRuntimeConnectionsChartOption(trafficWindow.points, trafficWindow.domain),
    [trafficWindow.domain, trafficWindow.points],
  );
  const hasTrafficPoints = trafficWindow.points.length > 1;

  return (
    <div className="runtime-view">
      <div className="runtime-stat-strip">
        <OverviewStatCard label="上传速率" value={formatRate(snapshot?.latestTraffic?.up ?? 0)} />
        <OverviewStatCard label="下载速率" value={formatRate(snapshot?.latestTraffic?.down ?? 0)} />
        <OverviewStatCard label="累计上传" value={formatBytes(snapshot?.totals.uploadTotal ?? 0)} />
        <OverviewStatCard label="累计下载" value={formatBytes(snapshot?.totals.downloadTotal ?? 0)} />
        <OverviewStatCard label="活动连接" value={String(snapshot?.totals.activeConnections ?? 0)} />
      </div>

      <div className="runtime-overview-panels">
        <section className="runtime-dark-panel runtime-chart-panel">
          <div className="runtime-panel-head">
            <div>
              <h3>实时流量</h3>
              <p>最近 1 分钟的上下行速率。</p>
            </div>
          </div>
          <div className="runtime-chart-shell">
            <EChart option={trafficChartOption} style={{ height: 320, width: "100%" }} />
            {!hasTrafficPoints ? <div className="chart-empty-overlay">等待运行时流量数据</div> : null}
          </div>
        </section>

        <section className="runtime-dark-panel runtime-chart-panel">
          <div className="runtime-panel-head">
            <div>
              <h3>连接变化</h3>
              <p>最近 1 分钟的活动连接变化。</p>
            </div>
          </div>
          <div className="runtime-chart-shell">
            <EChart option={connectionsChartOption} style={{ height: 320, width: "100%" }} />
            {!hasTrafficPoints ? <div className="chart-empty-overlay">等待连接变化数据</div> : null}
          </div>
        </section>
      </div>

      <div className="runtime-overview-panels runtime-overview-panels-secondary">
        <section className="runtime-dark-panel">
          <div className="runtime-panel-head">
            <div>
              <h3>代理排行</h3>
              <p>按当前活动连接即时汇总。</p>
            </div>
          </div>
          <div className="runtime-ranked-list">
            {proxyTraffic.map((item, index) => (
              <div className="runtime-ranked-item" key={item.label}>
                <div className="runtime-ranked-meta">
                  <strong>{item.label}</strong>
                  <span>{item.connections} 个连接</span>
                </div>
                <div className="runtime-ranked-bar">
                  <div
                    className="runtime-ranked-bar-fill"
                    style={{
                      width: `${Math.max(8, (item.value / Math.max(proxyTraffic[0]?.value ?? 1, 1)) * 100)}%`,
                      background: index % 2 === 0 ? "linear-gradient(90deg, #ff8d5c, #ffd29a)" : "linear-gradient(90deg, #2a95ff, #82c7ff)",
                    }}
                  />
                </div>
                <span className="runtime-ranked-value">{formatBytes(item.value)}</span>
              </div>
            ))}
            {!proxyTraffic.length ? <div className="runtime-empty">当前没有活动连接流量。</div> : null}
          </div>
        </section>

        <section className="runtime-dark-panel">
          <div className="runtime-panel-head">
            <div>
              <h3>最近关闭</h3>
              <p>切换节点后观察回流和重建连接。</p>
            </div>
          </div>
          <div className="runtime-compact-list">
            {recentClosed.map((connection) => (
              <div className="runtime-compact-item" key={connection.id}>
                <div>
                  <strong>{connection.title}</strong>
                  <div className="runtime-muted">
                    {connection.rule || "MATCH"} · {connection.chain || "DIRECT"}
                  </div>
                </div>
                <div className="runtime-compact-meta">
                  <span>{formatBytes(connection.totalBytes)}</span>
                  <span>{formatRuntimeAge(connection.start)}</span>
                </div>
              </div>
            ))}
            {!recentClosed.length ? <div className="runtime-empty">暂无最近关闭连接。</div> : null}
          </div>
        </section>
      </div>

      <footer className="runtime-endpoint-footer">
        <span>{snapshot?.health.controllerUrl || "控制器不可用"}</span>
      </footer>
    </div>
  );
}

export function RuntimeProxiesPage() {
  const { snapshot, selectedOptions, setSelectedOptions, selectorMutation, proxyDelayMutation } = useRuntimeShell();
  const [searchValue, setSearchValue] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "groups" | "nodes">("all");
  const [expandedGroupName, setExpandedGroupName] = useState<string | null>(null);
  const [optionPageSize, setOptionPageSize] = useState<Record<string, number>>({});
  const deferredSearchValue = useDeferredValue(searchValue);

  const filteredGroups = useMemo(() => {
    if (!snapshot?.proxies.length) {
      return [];
    }
    const keyword = deferredSearchValue.trim().toLowerCase();
    const shouldMatchGroups = searchScope === "all" || searchScope === "groups";
    const shouldMatchNodes = searchScope === "all" || searchScope === "nodes";

    return snapshot.proxies
      .map((group) => ({
        ...group,
        filteredOptions: group.options.filter((option) =>
          !keyword || !shouldMatchNodes
            ? true
            : [option.name, option.type, option.delay ?? "", option.alive ?? ""].join(" ").toLowerCase().includes(keyword),
        ),
      }))
      .filter((group) => {
        if (!keyword) {
          return true;
        }
        const groupMatch = shouldMatchGroups
          ? [group.name, group.type, group.now, ...group.all].join(" ").toLowerCase().includes(keyword)
          : false;
        const optionMatch = shouldMatchNodes ? group.filteredOptions.length > 0 : false;
        return groupMatch || optionMatch;
      })
      .sort(compareProxyGroups);
  }, [deferredSearchValue, searchScope, snapshot?.proxies]);

  useEffect(() => {
    if (!filteredGroups.length) {
      setExpandedGroupName(null);
      return;
    }

    if (expandedGroupName && !filteredGroups.some((group) => group.name === expandedGroupName)) {
      setExpandedGroupName(null);
    }
  }, [expandedGroupName, filteredGroups]);

  return (
    <div className="runtime-view">
      <div className="runtime-proxy-toolbar">
        <label className="runtime-inline-search" htmlFor="runtime-proxy-search">
          <select
            aria-label="搜索范围"
            className="runtime-inline-search-scope"
            id="runtime-proxy-search-scope"
            onChange={(event) => setSearchScope(event.target.value as "all" | "groups" | "nodes")}
            value={searchScope}
          >
            <option value="all">全部</option>
            <option value="groups">分组</option>
            <option value="nodes">节点</option>
          </select>
          <input
            className="runtime-inline-search-input"
            id="runtime-proxy-search"
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={searchScope === "groups" ? "搜索分组" : searchScope === "nodes" ? "搜索节点" : "搜索分组或节点"}
            value={searchValue}
          />
        </label>
      </div>

      <div className="runtime-proxy-grid-dark">
        {filteredGroups.map((group) => {
          const pending = selectorMutation.isPending && selectorMutation.variables?.group === group.name;
          const chosen = selectedOptions[group.name] ?? group.now;
          const visibleOptions = group.filteredOptions.length ? group.filteredOptions : group.options;
          const pageSize = optionPageSize[group.name] ?? 18;
          const optionSlice = visibleOptions.slice(0, pageSize);
          const segments = buildProxySegments(group);
          const expanded = expandedGroupName === group.name;
          const testingDelay = proxyDelayMutation.isPending && proxyDelayMutation.variables === group.name;

          return (
            <article className={`runtime-proxy-shell ${expanded ? "is-expanded" : ""}`} key={group.name}>
              <div className="runtime-proxy-summary-row">
                <button
                  className="runtime-proxy-summary"
                  onClick={() => setExpandedGroupName((current) => (current === group.name ? null : group.name))}
                  type="button"
                >
                  <div className="runtime-proxy-summary-copy">
                    <div className="runtime-proxy-summary-head">
                      <h3>{group.name}</h3>
                      <span>{group.options.length}</span>
                    </div>
                    <p>
                      {group.type || "Selector"} :: {group.now || "Not selected"}
                    </p>
                  </div>
                  <div className="runtime-proxy-summary-actions">
                    <span className="runtime-gauge-chip">{bestDelayLabel(group)}</span>
                    <span className="runtime-expand-mark">{expanded ? "▾" : "▸"}</span>
                  </div>
                </button>
                <button
                  className="runtime-proxy-speed-button"
                  disabled={testingDelay || !group.options.length}
                  onClick={() => proxyDelayMutation.mutate(group.name)}
                  type="button"
                >
                  {testingDelay ? "测速中" : "节点测速"}
                </button>
              </div>

              <div className="runtime-delay-track">
                {segments.map((segment, index) => (
                  <div
                    className="runtime-delay-segment"
                    key={`${group.name}-${index}`}
                    style={{
                      background: PROXY_SEGMENT_COLORS[index % PROXY_SEGMENT_COLORS.length],
                      width: `${segment.percent}%`,
                    }}
                  />
                ))}
              </div>

              {expanded ? (
                <div className="runtime-option-zone">
                  <div className="runtime-option-grid-dark">
                    {optionSlice.map((option) => {
                      const isCurrent = option.name === group.now;
                      const isSelected = option.name === chosen;
                      return (
                        <button
                          aria-pressed={isSelected}
                          className={`runtime-option-tile ${isSelected ? "is-selected" : ""} ${isCurrent ? "is-current" : ""}`}
                          key={`${group.name}-${option.name}`}
                          onClick={() =>
                            setSelectedOptions((current) => ({
                              ...current,
                              [group.name]: option.name,
                            }))
                          }
                          type="button"
                        >
                          <span>{option.name}</span>
                          <small>{formatDelayChip(option.delay, option.alive)}</small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="runtime-option-footer">
                    {optionSlice.length < visibleOptions.length ? (
                      <button
                        className="runtime-filter-chip"
                        onClick={() =>
                          setOptionPageSize((current) => ({
                            ...current,
                            [group.name]: Math.min(visibleOptions.length, pageSize + 18),
                          }))
                        }
                        type="button"
                      >
                        显示更多
                      </button>
                    ) : null}
                    <div className="runtime-option-footer-actions">
                      <span className="runtime-choice-pill">Selected :: {chosen || "-"}</span>
                      <button
                        className="runtime-cta-button"
                        disabled={pending || chosen === group.now}
                        onClick={() => selectorMutation.mutate({ group: group.name, name: chosen })}
                        type="button"
                      >
                        {pending ? "Switching..." : "Switch"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}

        {!filteredGroups.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的策略组。</div> : null}
      </div>
    </div>
  );
}

export function RuntimeConnectionsPage() {
  const { snapshot } = useRuntimeShell();
  const [tab, setTab] = useState<ConnectionTab>("active");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortBy, setSortBy] = useState<ConnectionSortKey>("recent");
  const [sortDirection, setSortDirection] = useState<ConnectionSortDirection>("desc");
  const [groupBy, setGroupBy] = useState<ConnectionGroupKey>("none");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchValue, setSearchValue] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [connectionsPaused, setConnectionsPaused] = useState(false);
  const [frozenConnections, setFrozenConnections] = useState<{
    active: MihomoConnection[];
    closed: MihomoConnection[];
  }>({ active: [], closed: [] });
  const deferredSearch = useDeferredValue(searchValue);
  const liveActiveConnections = snapshot?.activeConnections ?? EMPTY_CONNECTIONS;
  const liveClosedConnections = snapshot?.recentClosedConnections ?? EMPTY_CONNECTIONS;
  const allConnections = useMemo(
    () =>
      connectionsPaused
        ? [...frozenConnections.active, ...frozenConnections.closed]
        : [...liveActiveConnections, ...liveClosedConnections],
    [connectionsPaused, frozenConnections.active, frozenConnections.closed, liveActiveConnections, liveClosedConnections],
  );
  const source = useMemo(
    () =>
      connectionsPaused
        ? tab === "active"
          ? frozenConnections.active
          : frozenConnections.closed
        : tab === "active"
          ? liveActiveConnections
          : liveClosedConnections,
    [connectionsPaused, frozenConnections.active, frozenConnections.closed, liveActiveConnections, liveClosedConnections, tab],
  );
  const uniqueSourceIPs = useMemo(
    () => [...new Set(allConnections.map((connection) => formatConnectionSource(connection)))].filter(Boolean).sort((left, right) => left.localeCompare(right)),
    [allConnections],
  );
  const filteredConnections = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    const list = source
      .filter((connection) => (!sourceFilter ? true : formatConnectionSource(connection) === sourceFilter))
      .filter((connection) => (!keyword ? true : matchesConnectionSearch(connection, keyword)))
      .sort((left, right) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        if (sortBy === "download") return (left.download - right.download) * direction;
        if (sortBy === "upload") return (left.upload - right.upload) * direction;
        if (sortBy === "recent") {
          return (new Date(left.start || 0).getTime() - new Date(right.start || 0).getTime()) * direction;
        }
        const leftValue = getConnectionColumnValue(left, sortBy);
        const rightValue = getConnectionColumnValue(right, sortBy);
        return leftValue.localeCompare(rightValue, "zh-CN", { numeric: true, sensitivity: "base" }) * direction;
      });
    return list;
  }, [deferredSearch, sortBy, sortDirection, source, sourceFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredConnections.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredConnections.slice(start, start + pageSize);
  }, [filteredConnections, page, pageSize]);
  const groupedRows = useMemo(() => {
    if (groupBy === "none") {
      return pageItems.map((connection) => ({ type: "data" as const, connection, depth: 0 }));
    }

    const groups = new Map<string, MihomoConnection[]>();
    for (const connection of filteredConnections) {
      const key = getConnectionColumnValue(connection, groupBy) || "未分类";
      const group = groups.get(key);
      if (group) {
        group.push(connection);
      } else {
        groups.set(key, [connection]);
      }
    }

    const rows: Array<
      | { type: "group"; key: string; connections: MihomoConnection[]; depth: number }
      | { type: "data"; connection: MihomoConnection; depth: number }
    > = [];
    for (const [key, connections] of groups) {
      rows.push({ type: "group", key, connections, depth: 0 });
      if (expandedGroups[key]) {
        for (const connection of connections) {
          rows.push({ type: "data", connection, depth: 1 });
        }
      }
    }
    return rows;
  }, [expandedGroups, filteredConnections, groupBy, pageItems]);
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, groupBy, pageSize, sortBy, sortDirection, sourceFilter, tab]);

  const setConnectionSort = (nextSortBy: ConnectionSortKey) => {
    if (sortBy === nextSortBy) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection(nextSortBy === "recent" || nextSortBy === "download" || nextSortBy === "upload" ? "desc" : "asc");
  };
  const toggleConnectionGrouping = (nextGroupBy: ConnectionGroupKey) => {
    setExpandedGroups({});
    setGroupBy((current) => (current === nextGroupBy ? "none" : nextGroupBy));
  };

  return (
    <div className="runtime-view">
      <div className="runtime-mxc-toolbar">
        <div className="runtime-mxc-toolbar-row">
          <div className="runtime-tab-strip">
            <button className={`runtime-tab-button ${tab === "active" ? "is-active" : ""}`} onClick={() => setTab("active")} type="button">
              活动中
              <span>{connectionsPaused ? frozenConnections.active.length : liveActiveConnections.length}</span>
            </button>
            <button className={`runtime-tab-button ${tab === "closed" ? "is-active" : ""}`} onClick={() => setTab("closed")} type="button">
              已关闭
              <span>{connectionsPaused ? frozenConnections.closed.length : liveClosedConnections.length}</span>
            </button>
          </div>

          <select className="runtime-mxc-select runtime-mxc-select-compact" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="">全部来源</option>
            {uniqueSourceIPs.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <div className="runtime-mxc-sort-pack">
            <select className="runtime-mxc-select runtime-mxc-select-compact" value={sortBy} onChange={(event) => setConnectionSort(event.target.value as ConnectionSortKey)}>
              <option value="recent">最近</option>
              <option value="type">类型</option>
              <option value="source">来源 IP</option>
              <option value="host">主机</option>
              <option value="rule">规则</option>
              <option value="chain">链路</option>
              <option value="download">下载</option>
              <option value="upload">上传</option>
            </select>
            <button
              aria-label={sortDirection === "desc" ? "切换为升序" : "切换为降序"}
              className="runtime-mxc-icon-button"
              onClick={() => setSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
              title={sortDirection === "desc" ? "切换为升序" : "切换为降序"}
              type="button"
            >
              {sortDirection === "desc" ? <SortDescGlyph active /> : <SortAscGlyph active />}
            </button>
          </div>

          <div className="runtime-mxc-search-block">
            <input
              className="runtime-mxc-search-input"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索"
              value={searchValue}
            />

            <button
              aria-label={connectionsPaused ? "恢复连接列表更新" : "暂停连接列表更新"}
              className={`runtime-mxc-icon-button ${connectionsPaused ? "is-warning" : ""}`}
              onClick={() => {
                if (!connectionsPaused) {
                  setFrozenConnections({
                    active: liveActiveConnections,
                    closed: liveClosedConnections,
                  });
                } else {
                  setFrozenConnections({
                    active: EMPTY_CONNECTIONS,
                    closed: EMPTY_CONNECTIONS,
                  });
                }
                setConnectionsPaused((current) => !current);
              }}
              title={connectionsPaused ? "恢复连接列表更新" : "暂停连接列表更新"}
              type="button"
            >
              {connectionsPaused ? <PlayGlyph active /> : <PauseGlyph active />}
            </button>
          </div>
        </div>
      </div>

      <div className="runtime-dark-panel runtime-table-panel">
        <div className="runtime-table-wrap">
          <table className="runtime-table runtime-mxc-table">
            <thead>
              <tr>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("type")} type="button">类型</button><button className={`runtime-mxc-group-button ${groupBy === "type" ? "is-active" : ""}`} onClick={() => toggleConnectionGrouping("type")} type="button">{groupBy === "type" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</button>{renderSortMark(sortBy === "type", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("source")} type="button">来源 IP</button><button className={`runtime-mxc-group-button ${groupBy === "source" ? "is-active" : ""}`} onClick={() => toggleConnectionGrouping("source")} type="button">{groupBy === "source" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</button>{renderSortMark(sortBy === "source", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("host")} type="button">主机</button><button className={`runtime-mxc-group-button ${groupBy === "host" ? "is-active" : ""}`} onClick={() => toggleConnectionGrouping("host")} type="button">{groupBy === "host" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</button>{renderSortMark(sortBy === "host", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("rule")} type="button">规则</button><button className={`runtime-mxc-group-button ${groupBy === "rule" ? "is-active" : ""}`} onClick={() => toggleConnectionGrouping("rule")} type="button">{groupBy === "rule" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</button>{renderSortMark(sortBy === "rule", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("chain")} type="button">链路</button><button className={`runtime-mxc-group-button ${groupBy === "chain" ? "is-active" : ""}`} onClick={() => toggleConnectionGrouping("chain")} type="button">{groupBy === "chain" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</button>{renderSortMark(sortBy === "chain", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("download")} type="button">下载</button>{renderSortMark(sortBy === "download", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("upload")} type="button">上传</button>{renderSortMark(sortBy === "upload", sortDirection)}</div></th>
                <th><div className="runtime-mxc-th"><button className="runtime-table-sort-button" onClick={() => setConnectionSort("recent")} type="button">时间</button>{renderSortMark(sortBy === "recent", sortDirection)}</div></th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((row) =>
                row.type === "group" ? (
                  <tr className="runtime-mxc-group-row" key={`group-${row.key}`} onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))}>
                    <td className="runtime-mxc-group-cell" colSpan={8}>
                      <div className="runtime-mxc-group-inner">
                        <span className="runtime-mxc-group-icon">{expandedGroups[row.key] ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</span>
                        <strong>{row.key}</strong>
                        <span>({row.connections.length})</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr className="runtime-mxc-data-row" key={row.connection.id}>
                    <td>{`${row.connection.metadata.type || "-"}(${row.connection.metadata.network || "-"})`}</td>
                    <td>{formatConnectionSource(row.connection)}</td>
                    <td>{getConnectionTitle(row.connection)}</td>
                    <td>{row.connection.rulePayload ? `${row.connection.rule} :: ${row.connection.rulePayload}` : row.connection.rule || "-"}</td>
                    <td>{row.connection.chains.join(" :: ") || "DIRECT"}</td>
                    <td>{formatBytes(row.connection.download)}</td>
                    <td>{formatBytes(row.connection.upload)}</td>
                    <td>{formatRuntimeAge(row.connection.start)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {!groupedRows.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的连接。</div> : null}
        </div>

        <div className="runtime-mobile-list runtime-connection-mobile-list">
          {groupedRows.map((row) =>
            row.type === "group" ? (
              <button
                className="runtime-mobile-group"
                key={`mobile-group-${row.key}`}
                onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))}
                type="button"
              >
                <span className="runtime-mxc-group-icon">{expandedGroups[row.key] ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</span>
                <strong>{row.key}</strong>
                <span>{row.connections.length}</span>
              </button>
            ) : (
              <article className={`runtime-mobile-card ${row.depth > 0 ? "is-nested" : ""}`} key={`mobile-${row.connection.id}`}>
                <div className="runtime-mobile-card-head">
                  <div>
                    <strong>{getConnectionTitle(row.connection)}</strong>
                    <span>{`${row.connection.metadata.type || "-"}(${row.connection.metadata.network || "-"})`}</span>
                  </div>
                  <span className="runtime-mobile-age">{formatRuntimeAge(row.connection.start)}</span>
                </div>
                <div className="runtime-mobile-meta-grid">
                  <span>来源</span>
                  <strong>{formatConnectionSource(row.connection)}</strong>
                  <span>规则</span>
                  <strong>{row.connection.rulePayload ? `${row.connection.rule} · ${row.connection.rulePayload}` : row.connection.rule || "-"}</strong>
                  <span>链路</span>
                  <strong>{row.connection.chains.join(" · ") || "DIRECT"}</strong>
                </div>
                <div className="runtime-mobile-traffic">
                  <span>↓ {formatBytes(row.connection.download)}</span>
                  <span>↑ {formatBytes(row.connection.upload)}</span>
                </div>
              </article>
            ),
          )}
          {!groupedRows.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的连接。</div> : null}
        </div>

        <div className="runtime-table-footer">
          <Pager
            page={page}
            setPage={setPage}
            totalItems={filteredConnections.length}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
          />
        </div>
      </div>
    </div>
  );
}
