import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { MihomoConnection } from "@shared/telemetry";
import { GroupOffGlyph, GroupOnGlyph, PauseGlyph, PlayGlyph, SortAscGlyph, SortDescGlyph } from "../../components/icons";
import { formatBytes } from "../../lib/telemetry";
import { Pager, renderSortMark } from "./components";
import { EMPTY_CONNECTIONS } from "./constants";
import {
  buildConnectionQuickRuleSeed,
  formatConnectionSource,
  formatRuntimeAge,
  getConnectionColumnValue,
  getConnectionTitle,
  matchesConnectionSearch,
} from "./helpers";
import { QuickRuleModal } from "./QuickRuleModal";
import type {
  ConnectionGroupKey,
  ConnectionSortDirection,
  ConnectionSortKey,
  ConnectionTab,
  QuickRuleSeed,
} from "./types";
import { useRuntimeShell } from "./useRuntimeShell";

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
  const [quickRuleSeed, setQuickRuleSeed] = useState<QuickRuleSeed | null>(null);
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
    return source
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
            <input className="runtime-mxc-search-input" onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索" value={searchValue} />
            <button
              aria-label={connectionsPaused ? "恢复连接列表更新" : "暂停连接列表更新"}
              className={`runtime-mxc-icon-button ${connectionsPaused ? "is-warning" : ""}`}
              onClick={() => {
                setFrozenConnections(
                  connectionsPaused
                    ? { active: EMPTY_CONNECTIONS, closed: EMPTY_CONNECTIONS }
                    : { active: liveActiveConnections, closed: liveClosedConnections },
                );
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
          <table className="runtime-table runtime-mxc-table runtime-connection-table">
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
                <th className="runtime-action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((row) =>
                row.type === "group" ? (
                  <tr className="runtime-mxc-group-row" key={`group-${row.key}`} onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))}>
                    <td className="runtime-mxc-group-cell" colSpan={9}>
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
                    <td className="runtime-action-cell">
                      <button className="runtime-row-action-button" onClick={() => setQuickRuleSeed(buildConnectionQuickRuleSeed(row.connection))} type="button">
                        加规则
                      </button>
                    </td>
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
              <button className="runtime-mobile-group" key={`mobile-group-${row.key}`} onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))} type="button">
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
                <div className="runtime-mobile-card-footer">
                  <div className="runtime-mobile-traffic">
                    <span>↓ {formatBytes(row.connection.download)}</span>
                    <span>↑ {formatBytes(row.connection.upload)}</span>
                  </div>
                  <button className="runtime-row-action-button" onClick={() => setQuickRuleSeed(buildConnectionQuickRuleSeed(row.connection))} type="button">
                    加规则
                  </button>
                </div>
              </article>
            ),
          )}
          {!groupedRows.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的连接。</div> : null}
        </div>

        <div className="runtime-table-footer">
          <Pager page={page} setPage={setPage} totalItems={filteredConnections.length} totalPages={totalPages} pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      </div>

      <QuickRuleModal onClose={() => setQuickRuleSeed(null)} seed={quickRuleSeed} />
    </div>
  );
}
