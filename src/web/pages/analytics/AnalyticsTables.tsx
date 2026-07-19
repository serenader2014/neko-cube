import { type Dispatch, Fragment, type SetStateAction, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsDetailResponse, AnalyticsDimension, AnalyticsListItem } from "../../../shared/telemetry";
import { apiRequest } from "../../lib/api";
import { formatBytes } from "../../lib/telemetry";
import {
  buildDomainExpansionEndpoints,
  buildIpExpansionEndpoints,
  countryCodeToFlagEmoji,
  filterAnalyticsTableItems,
  formatRelativeTime,
  getFaviconUrl,
  getItemTotalBytes,
  getMetaText,
  renderSortMark,
  setTableSort,
} from "./helpers";
import type { SortOrder, TableSortKey } from "./types";

export function AnalyticsDomainStatsTable({
  contextDimension,
  contextItem,
  items,
  rangeSearch,
  title,
}: {
  contextDimension: AnalyticsDimension;
  contextItem: AnalyticsListItem | null;
  items: AnalyticsListItem[];
  rangeSearch: string;
  title: string;
}) {
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<TableSortKey>("download");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [contextDimension, contextItem?.key, pageSize, searchText, sortKey, sortOrder]);

  const filteredItems = useMemo(
    () => filterAnalyticsTableItems(items, searchText, sortKey, sortOrder),
    [items, searchText, sortKey, sortOrder],
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = useMemo(() => filteredItems.slice((page - 1) * pageSize, page * pageSize), [filteredItems, page, pageSize]);

  const expansionEndpoints = expandedKey ? buildDomainExpansionEndpoints(contextDimension, contextItem, expandedKey, rangeSearch) : null;
  const proxiesQuery = useQuery({
    queryKey: ["analytics-domain-expand-proxies", contextDimension, contextItem?.key, expandedKey, rangeSearch],
    queryFn: () => apiRequest<AnalyticsDetailResponse>(expansionEndpoints!.proxies),
    enabled: Boolean(expansionEndpoints?.proxies),
  });
  const ipsQuery = useQuery({
    queryKey: ["analytics-domain-expand-ips", contextDimension, contextItem?.key, expandedKey, rangeSearch],
    queryFn: () => apiRequest<AnalyticsDetailResponse>(expansionEndpoints!.ips),
    enabled: Boolean(expansionEndpoints?.ips),
  });

  return (
    <section className="panel analytics-data-table-card">
      <div className="analytics-table-card-head">
        <div>
          <h4>{title}</h4>
          <p className="muted">{filteredItems.length} 个域名</p>
        </div>
        <div className="analytics-table-tools">
          <input
            className="analytics-table-search"
            placeholder="搜索域名..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select className="analytics-control-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={10}>每页 10 条</option>
            <option value={20}>每页 20 条</option>
            <option value={50}>每页 50 条</option>
          </select>
        </div>
      </div>
      <div className="analytics-data-table-wrap">
        <table className="analytics-data-table">
          <thead>
            <tr>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "label")}>
                域名 {renderSortMark(sortKey, sortOrder, "label")}
              </th>
              <th>代理</th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "download")}>
                下载 {renderSortMark(sortKey, sortOrder, "download")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "upload")}>
                上传 {renderSortMark(sortKey, sortOrder, "upload")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "connections")}>
                连接 {renderSortMark(sortKey, sortOrder, "connections")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "lastSeen")}>
                最近 {renderSortMark(sortKey, sortOrder, "lastSeen")}
              </th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => {
              const isExpanded = expandedKey === item.key;
              return (
                <Fragment key={item.key}>
                  <tr className={isExpanded ? "is-expanded" : ""} key={item.key}>
                    <td onClick={() => setExpandedKey(isExpanded ? null : item.key)}>
                      <div className="analytics-entity-cell">
                        <img alt="" className="analytics-favicon" src={getFaviconUrl(item.label)} />
                        <strong>{item.label}</strong>
                      </div>
                    </td>
                    <td>{getMetaText(item, "proxy_name") || getMetaText(item, "proxy_chain") || "-"}</td>
                    <td className="analytics-table-download">{formatBytes(item.downloadBytes)}</td>
                    <td className="analytics-table-upload">{formatBytes(item.uploadBytes)}</td>
                    <td>{item.connectionCount}</td>
                    <td>{formatRelativeTime(item.lastSeen)}</td>
                    <td>
                      <button className="analytics-expand-chip" onClick={() => setExpandedKey(isExpanded ? null : item.key)} type="button">
                        {Number((item.meta as Record<string, unknown>)?.ip_count ?? 0)} {isExpanded ? "▴" : "▾"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="analytics-expand-row">
                      <td colSpan={7}>
                        <div className="analytics-expand-grid">
                          <AnalyticsDetailPanel
                            items={proxiesQuery.data?.items ?? []}
                            loading={proxiesQuery.isLoading}
                            title="关联代理"
                          />
                          <AnalyticsDetailPanel
                            items={ipsQuery.data?.items ?? []}
                            loading={ipsQuery.isLoading}
                            title="关联 IP"
                            tone="ip"
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <AnalyticsTablePager
        page={page}
        pageSize={pageSize}
        setPage={setPage}
        total={filteredItems.length}
        totalPages={totalPages}
      />
    </section>
  );
}

export function AnalyticsIpStatsTable({
  contextDimension,
  contextItem,
  items,
  rangeSearch,
  title,
}: {
  contextDimension: AnalyticsDimension;
  contextItem: AnalyticsListItem | null;
  items: AnalyticsListItem[];
  rangeSearch: string;
  title: string;
}) {
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<TableSortKey>("download");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [contextDimension, contextItem?.key, pageSize, searchText, sortKey, sortOrder]);

  const filteredItems = useMemo(
    () => filterAnalyticsTableItems(items, searchText, sortKey, sortOrder),
    [items, searchText, sortKey, sortOrder],
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = useMemo(() => filteredItems.slice((page - 1) * pageSize, page * pageSize), [filteredItems, page, pageSize]);

  const expansionEndpoints = expandedKey ? buildIpExpansionEndpoints(contextDimension, contextItem, expandedKey, rangeSearch) : null;
  const proxiesQuery = useQuery({
    queryKey: ["analytics-ip-expand-proxies", contextDimension, contextItem?.key, expandedKey, rangeSearch],
    queryFn: () => apiRequest<AnalyticsDetailResponse>(expansionEndpoints!.proxies),
    enabled: Boolean(expansionEndpoints?.proxies),
  });
  const domainsQuery = useQuery({
    queryKey: ["analytics-ip-expand-domains", contextDimension, contextItem?.key, expandedKey, rangeSearch],
    queryFn: () => apiRequest<AnalyticsDetailResponse>(expansionEndpoints!.domains),
    enabled: Boolean(expansionEndpoints?.domains),
  });

  return (
    <section className="panel analytics-data-table-card">
      <div className="analytics-table-card-head">
        <div>
          <h4>{title}</h4>
          <p className="muted">{filteredItems.length} 个 IP 地址</p>
        </div>
        <div className="analytics-table-tools">
          <input
            className="analytics-table-search"
            placeholder="搜索 IP 地址..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select className="analytics-control-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={10}>每页 10 条</option>
            <option value={20}>每页 20 条</option>
            <option value={50}>每页 50 条</option>
          </select>
        </div>
      </div>
      <div className="analytics-data-table-wrap">
        <table className="analytics-data-table">
          <thead>
            <tr>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "label")}>
                IP {renderSortMark(sortKey, sortOrder, "label")}
              </th>
              <th>国家或代理</th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "download")}>
                下载 {renderSortMark(sortKey, sortOrder, "download")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "upload")}>
                上传 {renderSortMark(sortKey, sortOrder, "upload")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "connections")}>
                连接 {renderSortMark(sortKey, sortOrder, "connections")}
              </th>
              <th onClick={() => setTableSort(setSortKey, setSortOrder, "lastSeen")}>
                最近 {renderSortMark(sortKey, sortOrder, "lastSeen")}
              </th>
              <th>域名</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => {
              const isExpanded = expandedKey === item.key;
              const countryCode = getMetaText(item, "country_code");
              const countryLabel = getMetaText(item, "country_name");
              return (
                <Fragment key={item.key}>
                  <tr className={isExpanded ? "is-expanded" : ""} key={item.key}>
                    <td onClick={() => setExpandedKey(isExpanded ? null : item.key)}>
                      <div className="analytics-entity-cell">
                        <span className="analytics-ip-dot" />
                        <strong>{item.label}</strong>
                      </div>
                    </td>
                    <td>
                      <div className="analytics-ip-meta">
                        <span>{countryCode ? `${countryCodeToFlagEmoji(countryCode)} ${countryLabel || countryCode}` : "-"}</span>
                        <small>{getMetaText(item, "proxy_name") || "-"}</small>
                      </div>
                    </td>
                    <td className="analytics-table-download">{formatBytes(item.downloadBytes)}</td>
                    <td className="analytics-table-upload">{formatBytes(item.uploadBytes)}</td>
                    <td>{item.connectionCount}</td>
                    <td>{formatRelativeTime(item.lastSeen)}</td>
                    <td>
                      <button className="analytics-expand-chip" onClick={() => setExpandedKey(isExpanded ? null : item.key)} type="button">
                        {Number((item.meta as Record<string, unknown>)?.domain_count ?? 0)} {isExpanded ? "▴" : "▾"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="analytics-expand-row">
                      <td colSpan={7}>
                        <div className="analytics-expand-grid">
                          <AnalyticsDetailPanel
                            items={domainsQuery.data?.items ?? []}
                            loading={domainsQuery.isLoading}
                            title="关联域名"
                          />
                          <AnalyticsDetailPanel
                            items={proxiesQuery.data?.items ?? []}
                            loading={proxiesQuery.isLoading}
                            title="关联代理"
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <AnalyticsTablePager
        page={page}
        pageSize={pageSize}
        setPage={setPage}
        total={filteredItems.length}
        totalPages={totalPages}
      />
    </section>
  );
}

function AnalyticsDetailPanel({
  items,
  loading,
  title,
  tone,
}: {
  items: AnalyticsListItem[];
  loading: boolean;
  title: string;
  tone?: "ip";
}) {
  return (
    <div className="analytics-detail-panel">
      <strong>{title}</strong>
      {loading ? <div className="muted">加载中…</div> : null}
      {!loading && items.length === 0 ? <div className="muted">暂无数据</div> : null}
      <div className="analytics-detail-list">
        {items.slice(0, 10).map((item) => (
          <div className="analytics-detail-item" key={item.key}>
            <span className={tone === "ip" ? "analytics-detail-ip" : ""}>{item.label}</span>
            <strong>{formatBytes(getItemTotalBytes(item))}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsRegionSummaryTable({
  expanded,
  items,
  onToggleExpanded,
  title,
  totalItems,
}: {
  expanded: boolean;
  items: AnalyticsListItem[];
  onToggleExpanded?: () => void;
  title: string;
  totalItems: number;
}) {
  return (
    <section className="panel analytics-data-table-card">
      <div className="analytics-table-card-head">
        <div>
          <h4>{title}</h4>
          <p className="muted">显示 {items.length} / {totalItems} 个地区</p>
        </div>
        {onToggleExpanded ? (
          <button className="button-secondary analytics-region-toggle" onClick={onToggleExpanded} type="button">
            {expanded ? "收起" : "查看全部"}
          </button>
        ) : null}
      </div>
      <div className="analytics-data-table-wrap">
        <table className="analytics-data-table">
          <thead>
            <tr>
              <th>地区</th>
              <th>下载</th>
              <th>上传</th>
              <th>连接</th>
              <th>最近</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td>{item.label}</td>
                <td className="analytics-table-download">{formatBytes(item.downloadBytes)}</td>
                <td className="analytics-table-upload">{formatBytes(item.uploadBytes)}</td>
                <td>{item.connectionCount}</td>
                <td>{formatRelativeTime(item.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AnalyticsTablePager({
  page,
  pageSize,
  setPage,
  total,
  totalPages,
}: {
  page: number;
  pageSize: number;
  setPage: Dispatch<SetStateAction<number>>;
  total: number;
  totalPages: number;
}) {
  const start = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);
  return (
    <div className="analytics-table-pager">
      <div className="analytics-table-pager-copy">
        {start}-{end} / {total}
      </div>
      <div className="runtime-pager">
        <button className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
          上一页
        </button>
        <span className="runtime-choice-pill">
          {page}/{totalPages}
        </span>
        <button
          className="button-secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          type="button"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
