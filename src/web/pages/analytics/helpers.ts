import type { Dispatch, SetStateAction } from "react";
import type { AnalyticsDimension, AnalyticsListItem } from "../../../shared/telemetry";
import { formatDateTime } from "../../lib/telemetry";
import {
  COUNTRY_NAME_MAPPING,
  DIMENSION_LABELS,
  FLOW_MAX_OFFSET_X,
  FLOW_MAX_OFFSET_Y,
  FLOW_MAX_ZOOM,
  FLOW_MIN_ZOOM,
  englishRegionNames,
} from "./constants";
import type { DetailMode, FlowViewport, SortMode, SortOrder, TableSortKey } from "./types";

export function buildDonutData(items: AnalyticsListItem[]) {
  return items
    .map((item) => ({ key: item.key, value: item.downloadBytes + item.uploadBytes, label: item.label }))
    .filter((item) => item.value > 0);
}

export function getItemTotalBytes(item: AnalyticsListItem) {
  return item.downloadBytes + item.uploadBytes;
}

export function percentage(value: number, items: AnalyticsListItem[]) {
  const total = items.reduce((sum, item) => sum + getItemTotalBytes(item), 0);
  return total > 0 ? (value / total) * 100 : 0;
}

export function buildTableTitle(dimension: AnalyticsDimension, detailMode: DetailMode, selectedItem: AnalyticsListItem | null) {
  if (dimension === "regions") {
    return "地区详情";
  }
  if (selectedItem) {
    return `${selectedItem.label} · ${detailMode === "ips" ? "IP 明细" : "关联明细"}`;
  }
  return `${DIMENSION_LABELS[dimension]}列表`;
}

export function buildDetailEndpoint(dimension: AnalyticsDimension, selectedKey: string | null, detailMode: DetailMode, search: string) {
  if (!selectedKey || dimension === "regions") {
    return null;
  }
  const encoded = encodeURIComponent(selectedKey);
  if (dimension === "domains") {
    return detailMode === "ips" ? `/api/analytics/domains/${encoded}/ips${search}` : `/api/analytics/domains/${encoded}/proxies${search}`;
  }
  if (dimension === "proxies") {
    return detailMode === "ips" ? `/api/analytics/proxies/${encoded}/ips${search}` : `/api/analytics/proxies/${encoded}/domains${search}`;
  }
  if (dimension === "rules") {
    return detailMode === "ips" ? `/api/analytics/rules/${encoded}/ips${search}` : `/api/analytics/rules/${encoded}/domains${search}`;
  }
  return detailMode === "ips" ? `/api/analytics/devices/${encoded}/ips${search}` : `/api/analytics/devices/${encoded}/domains${search}`;
}

export function getDefaultEnd() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function getDefaultStart() {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function sortAnalyticsItems(items: AnalyticsListItem[], sortMode: SortMode) {
  return [...items].sort((left, right) => {
    if (sortMode === "connections") {
      return right.connectionCount - left.connectionCount;
    }
    return getItemTotalBytes(right) - getItemTotalBytes(left);
  });
}

export function filterAnalyticsTableItems(items: AnalyticsListItem[], searchText: string, sortKey: TableSortKey, sortOrder: SortOrder) {
  const keyword = searchText.trim().toLowerCase();
  const filtered = items.filter((item) =>
    !keyword ? true : [item.label, item.key, JSON.stringify(item.meta ?? {})].join(" ").toLowerCase().includes(keyword),
  );
  return [...filtered].sort((left, right) => {
    const leftValue =
      sortKey === "label"
        ? left.label
        : sortKey === "download"
          ? left.downloadBytes
          : sortKey === "upload"
            ? left.uploadBytes
            : sortKey === "connections"
              ? left.connectionCount
              : left.lastSeen ?? "";
    const rightValue =
      sortKey === "label"
        ? right.label
        : sortKey === "download"
          ? right.downloadBytes
          : sortKey === "upload"
            ? right.uploadBytes
            : sortKey === "connections"
              ? right.connectionCount
              : right.lastSeen ?? "";
    const result = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    return sortOrder === "asc" ? result : -result;
  });
}

export function setTableSort(
  setSortKey: Dispatch<SetStateAction<TableSortKey>>,
  setSortOrder: Dispatch<SetStateAction<SortOrder>>,
  nextKey: TableSortKey,
) {
  setSortKey((current) => {
    if (current === nextKey) {
      setSortOrder((order) => (order === "asc" ? "desc" : "asc"));
      return current;
    }
    setSortOrder("desc");
    return nextKey;
  });
}

export function renderSortMark(sortKey: TableSortKey, sortOrder: SortOrder, current: TableSortKey) {
  if (sortKey !== current) {
    return "↕";
  }
  return sortOrder === "asc" ? "↑" : "↓";
}

export function getMetaText(item: AnalyticsListItem, key: string) {
  const meta = item.meta as Record<string, unknown> | undefined;
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

export function appendScopeParams(
  search: string,
  scope?: { proxy?: string; rule?: string; device?: string },
) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (scope?.proxy) {
    params.set("proxy", scope.proxy);
  }
  if (scope?.rule) {
    params.set("rule", scope.rule);
  }
  if (scope?.device) {
    params.set("device", scope.device);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildScopeQuery(dimension: AnalyticsDimension, contextItem: AnalyticsListItem | null, search: string) {
  if (!contextItem) {
    return search;
  }
  if (dimension === "proxies") {
    return appendScopeParams(search, { proxy: contextItem.key });
  }
  if (dimension === "rules") {
    return appendScopeParams(search, { rule: contextItem.key });
  }
  if (dimension === "devices") {
    return appendScopeParams(search, { device: contextItem.key });
  }
  return search;
}

export function buildDomainExpansionEndpoints(
  dimension: AnalyticsDimension,
  contextItem: AnalyticsListItem | null,
  key: string,
  search: string,
) {
  const encoded = encodeURIComponent(key);
  const scopedSearch = buildScopeQuery(dimension, contextItem, search);
  if (dimension === "domains") {
    return {
      proxies: `/api/analytics/domains/${encoded}/proxies${search}`,
      ips: `/api/analytics/domains/${encoded}/ips${search}`,
    };
  }
  if (dimension === "rules" || dimension === "devices") {
    return {
      proxies: `/api/analytics/domains/${encoded}/proxies${scopedSearch}`,
      ips: `/api/analytics/domains/${encoded}/ips${scopedSearch}`,
    };
  }
  return {
    proxies: "",
    ips: `/api/analytics/domains/${encoded}/ips${scopedSearch}`,
  };
}

export function buildIpExpansionEndpoints(
  dimension: AnalyticsDimension,
  contextItem: AnalyticsListItem | null,
  key: string,
  search: string,
) {
  const encoded = encodeURIComponent(key);
  const scopedSearch = buildScopeQuery(dimension, contextItem, search);
  if (dimension === "domains") {
    return {
      proxies: `/api/analytics/ips/${encoded}/proxies${search}`,
      domains: `/api/analytics/ips/${encoded}/domains${search}`,
    };
  }
  if (dimension === "rules" || dimension === "devices") {
    return {
      proxies: `/api/analytics/ips/${encoded}/proxies${scopedSearch}`,
      domains: `/api/analytics/ips/${encoded}/domains${scopedSearch}`,
    };
  }
  return {
    proxies: "",
    domains: `/api/analytics/ips/${encoded}/domains${scopedSearch}`,
  };
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) {
    return formatDateTime(value);
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function getRegionHeatColor(index: number) {
  const colors = ["#4f46e5", "#7268f1", "#97a6fb", "#b8c6ff", "#d7e0ff"];
  return colors[Math.min(index, colors.length - 1)];
}

export function appendSearchParam(search: string, key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return search;
  }
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, trimmed);
  return `?${params.toString()}`;
}

export function zoomFlowViewport(current: FlowViewport, delta: number): FlowViewport {
  return {
    ...current,
    zoom: clampNumber(Number((current.zoom + delta).toFixed(2)), FLOW_MIN_ZOOM, FLOW_MAX_ZOOM),
  };
}

export function panFlowViewport(current: FlowViewport, deltaX: number, deltaY: number): FlowViewport {
  return {
    ...current,
    offsetX: clampNumber(current.offsetX + deltaX, -FLOW_MAX_OFFSET_X, FLOW_MAX_OFFSET_X),
    offsetY: clampNumber(current.offsetY + deltaY, -FLOW_MAX_OFFSET_Y, FLOW_MAX_OFFSET_Y),
  };
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function truncateFlowLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

export function getMapCountryName(item: AnalyticsListItem) {
  const code = getItemCountryCode(item);
  if (!/^[A-Z]{2}$/.test(code)) {
    return "";
  }
  return COUNTRY_NAME_MAPPING[code] ?? englishRegionNames?.of(code) ?? item.label;
}

export function getItemCountryCode(item: AnalyticsListItem) {
  const meta = item.meta as Record<string, unknown> | undefined;
  return String(meta?.country_code ?? item.key ?? "").toUpperCase();
}

export function isMappableRegionItem(item: AnalyticsListItem) {
  const code = getItemCountryCode(item);
  return /^[A-Z]{2}$/.test(code) && code !== "UN" && code !== "ZZ";
}

export function countryCodeToFlagEmoji(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) {
    return "◦";
  }
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}
