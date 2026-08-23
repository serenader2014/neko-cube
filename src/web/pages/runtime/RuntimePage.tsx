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
  RuntimeLogLevel,
  RuntimeOverviewState,
  RuntimeProxyGroup,
  RuntimeSnapshot,
} from "../../../shared/telemetry";
import { EChart } from "../../components/EChart";
import { ModuleShell } from "../../components/ModuleShell";
import {
  DocGlyph,
  HomeGlyph,
  NetworkGlyph,
  NodeGlyph,
} from "../../components/icons";
import { pushToast } from "../../components/toast";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { formatBytes, formatRate } from "../../lib/telemetry";
import { buildRuntimeConnectionsChartOption, buildRuntimeTrafficChartOption } from "./charts";
import { OverviewStatCard } from "./components";
import { PROXY_SEGMENT_COLORS } from "./constants";
import {
  bestDelayLabel,
  buildProxySegments,
  buildProxyTrafficData,
  buildRuntimeOverviewClosedConnections,
  buildRuntimeOverviewState,
  buildRuntimeTrafficWindow,
  compareProxyGroups,
  formatDelayChip,
  formatRuntimeAge,
  getRuntimeSection,
} from "./helpers";
import { useRuntimeNow } from "./hooks";
import type {
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
