import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { RuntimeLogEntry, RuntimeLogLevel } from "../../../shared/telemetry";
import { ClearGlyph, GroupOffGlyph, GroupOnGlyph, PauseGlyph, PlayGlyph, SortAscGlyph, SortDescGlyph } from "../../components/icons";
import { Pager, renderSortMark } from "./components";
import { EMPTY_LOGS } from "./constants";
import { buildLogQuickRuleSeed, extractLogType, getLogNumericId } from "./helpers";
import { QuickRuleModal } from "./QuickRuleModal";
import type { LogGroupKey, LogSortDirection, LogSortKey, QuickRuleSeed } from "./types";
import { useRuntimeShell } from "./useRuntimeShell";

export function RuntimeLogsPage() {
  const { snapshot, logsPaused, setLogsPaused, logLevelMutation, clearLogsMutation } = useRuntimeShell();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<LogSortKey>("seq");
  const [sortDirection, setSortDirection] = useState<LogSortDirection>("desc");
  const [groupBy, setGroupBy] = useState<LogGroupKey>("none");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [quickRuleSeed, setQuickRuleSeed] = useState<QuickRuleSeed | null>(null);
  const deferredFilter = useDeferredValue(filter);

  const filteredLogs = useMemo(() => {
    const sourceLogs = snapshot?.logs ?? EMPTY_LOGS;
    const keyword = deferredFilter.trim().toLowerCase();
    if (!sourceLogs.length) {
      return EMPTY_LOGS;
    }
    const items = !keyword
      ? sourceLogs
      : sourceLogs.filter((log) => [log.type, extractLogType(log.payload), log.payload].join(" ").toLowerCase().includes(keyword));
    const sorted = [...items].sort((left, right) => {
      let comparison = 0;
      if (sortKey === "seq") {
        comparison = getLogNumericId(left.id) - getLogNumericId(right.id);
      } else if (sortKey === "level") {
        comparison = left.type.localeCompare(right.type, "zh-CN", { numeric: true, sensitivity: "base" });
      } else {
        comparison = extractLogType(left.payload).localeCompare(extractLogType(right.payload), "zh-CN", { numeric: true, sensitivity: "base" });
      }
      return sortDirection === "desc" ? -comparison : comparison;
    });
    return sorted;
  }, [deferredFilter, snapshot?.logs, sortDirection, sortKey]);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, page, pageSize]);
  const rowModel = useMemo(() => {
    if (groupBy === "none") {
      return pageItems.map((log) => ({ type: "data" as const, log }));
    }

    const groups = new Map<string, RuntimeLogEntry[]>();
    for (const log of filteredLogs) {
      const key = groupBy === "level" ? log.type : extractLogType(log.payload) || "未分类";
      const group = groups.get(key);
      if (group) {
        group.push(log);
      } else {
        groups.set(key, [log]);
      }
    }

    const rows: Array<{ type: "group"; key: string; logs: RuntimeLogEntry[] } | { type: "data"; log: RuntimeLogEntry }> = [];
    for (const [key, logs] of groups) {
      rows.push({ type: "group", key, logs });
      if (expandedGroups[key]) {
        for (const log of logs) {
          rows.push({ type: "data", log });
        }
      }
    }
    return rows;
  }, [expandedGroups, filteredLogs, groupBy, pageItems]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [deferredFilter, groupBy, pageSize, sortDirection, sortKey]);

  return (
    <div className="runtime-view">
      <div className="runtime-mxc-toolbar">
        <div className="runtime-mxc-toolbar-row runtime-mxc-toolbar-row-logs">
          <div className="runtime-mxc-search-block runtime-mxc-search-block-wide">
            <input
              className="runtime-mxc-search-input"
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              placeholder="搜索"
              value={filter}
            />
          </div>
          <div className="runtime-mxc-icon-pack">
            <button
              aria-label={logsPaused ? "恢复日志更新" : "暂停日志更新"}
              className={`runtime-mxc-icon-button ${logsPaused ? "is-warning" : ""}`}
              onClick={() => setLogsPaused((current) => !current)}
              title={logsPaused ? "恢复日志更新" : "暂停日志更新"}
              type="button"
            >
              {logsPaused ? <PlayGlyph active /> : <PauseGlyph active />}
            </button>
            <button
              aria-label={sortDirection === "desc" ? "切换为升序" : "切换为降序"}
              className="runtime-mxc-icon-button"
              onClick={() => setSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
              title={sortDirection === "desc" ? "切换为升序" : "切换为降序"}
              type="button"
            >
              {sortDirection === "desc" ? <SortDescGlyph active /> : <SortAscGlyph active />}
            </button>
            <button aria-label="清空日志" className="runtime-mxc-icon-button" onClick={() => clearLogsMutation.mutate()} title="清空日志" type="button">
              <ClearGlyph active />
            </button>
          </div>
          <div className="runtime-mxc-log-controls">
            <select className="runtime-mxc-select runtime-mxc-select-compact" value={snapshot?.logLevel ?? "info"} onChange={(event) => logLevelMutation.mutate(event.target.value as RuntimeLogLevel)}>
              <option value="debug">调试</option>
              <option value="info">信息</option>
              <option value="warning">警告</option>
              <option value="error">错误</option>
              <option value="silent">静默</option>
            </select>
            <select className="runtime-mxc-select runtime-mxc-select-compact" value={sortKey} onChange={(event) => setSortKey(event.target.value as LogSortKey)}>
              <option value="seq">最近</option>
              <option value="level">级别</option>
              <option value="type">类型</option>
            </select>
          </div>
        </div>
      </div>

      <div className="runtime-dark-panel runtime-table-panel">
        <div className="runtime-table-wrap">
          <table className="runtime-table runtime-mxc-table runtime-log-table">
            <thead>
              <tr>
                <th>
                  <div className="runtime-mxc-th">
                    <button className="runtime-table-sort-button" onClick={() => setSortKey("level")} type="button">级别</button>
                    <button className={`runtime-mxc-group-button ${groupBy === "level" ? "is-active" : ""}`} onClick={() => {
                      setExpandedGroups({});
                      setGroupBy((current) => (current === "level" ? "none" : "level"));
                    }} type="button">
                      {groupBy === "level" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}
                    </button>
                    {renderSortMark(sortKey === "level", sortDirection)}
                  </div>
                </th>
                <th>
                  <div className="runtime-mxc-th">
                    <button className="runtime-table-sort-button" onClick={() => setSortKey("type")} type="button">类型</button>
                    <button className={`runtime-mxc-group-button ${groupBy === "type" ? "is-active" : ""}`} onClick={() => {
                      setExpandedGroups({});
                      setGroupBy((current) => (current === "type" ? "none" : "type"));
                    }} type="button">
                      {groupBy === "type" ? <GroupOffGlyph active /> : <GroupOnGlyph active />}
                    </button>
                    {renderSortMark(sortKey === "type", sortDirection)}
                  </div>
                </th>
                <th>内容</th>
                <th className="runtime-action-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {rowModel.map((row) =>
                row.type === "group" ? (
                  <tr className="runtime-mxc-group-row" key={`group-${row.key}`} onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))}>
                    <td className="runtime-mxc-group-cell" colSpan={4}>
                      <div className="runtime-mxc-group-inner">
                        <span className="runtime-mxc-group-icon">{expandedGroups[row.key] ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</span>
                        <strong>{row.key}</strong>
                        <span>({row.logs.length})</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr className="runtime-mxc-data-row runtime-mxc-log-row" key={row.log.id}>
                    <td>
                      <span className={`runtime-level-pill is-${row.log.type.toLowerCase()}`}>[{row.log.type}]</span>
                    </td>
                    <td>{extractLogType(row.log.payload) || "未分类"}</td>
                    <td className="runtime-log-cell">{row.log.payload}</td>
                    <td className="runtime-action-cell">
                      <button className="runtime-row-action-button" onClick={() => setQuickRuleSeed(buildLogQuickRuleSeed(row.log))} type="button">
                        加规则
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {!rowModel.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的日志。</div> : null}
        </div>

        <div className="runtime-mobile-list runtime-log-mobile-list">
          {rowModel.map((row) =>
            row.type === "group" ? (
              <button
                className="runtime-mobile-group"
                key={`mobile-group-${row.key}`}
                onClick={() => setExpandedGroups((current) => ({ ...current, [row.key]: !current[row.key] }))}
                type="button"
              >
                <span className="runtime-mxc-group-icon">{expandedGroups[row.key] ? <GroupOffGlyph active /> : <GroupOnGlyph active />}</span>
                <strong>{row.key}</strong>
                <span>{row.logs.length}</span>
              </button>
            ) : (
              <article className="runtime-mobile-card runtime-log-mobile-card" key={`mobile-${row.log.id}`}>
                <div className="runtime-mobile-card-head">
                  <div>
                    <span className={`runtime-level-pill is-${row.log.type.toLowerCase()}`}>[{row.log.type}]</span>
                    <strong>{extractLogType(row.log.payload) || "未分类"}</strong>
                  </div>
                  <span className="runtime-mobile-age">{new Date(row.log.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                </div>
                <pre className="runtime-mobile-log-payload">{row.log.payload}</pre>
                <div className="runtime-mobile-card-footer">
                  <span className="runtime-mobile-context-hint">从这条日志提取目标</span>
                  <button className="runtime-row-action-button" onClick={() => setQuickRuleSeed(buildLogQuickRuleSeed(row.log))} type="button">
                    加规则
                  </button>
                </div>
              </article>
            ),
          )}
          {!rowModel.length ? <div className="runtime-empty runtime-empty-large">当前没有匹配的日志。</div> : null}
        </div>
        <div className="runtime-table-footer">
          <Pager page={page} setPage={setPage} totalItems={filteredLogs.length} totalPages={totalPages} pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      </div>
      <QuickRuleModal onClose={() => setQuickRuleSeed(null)} seed={quickRuleSeed} />
    </div>
  );
}
