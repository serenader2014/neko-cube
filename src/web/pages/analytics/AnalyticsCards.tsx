import { type Dispatch, type SetStateAction, useMemo } from "react";
import { NavLink } from "react-router-dom";
import type { AnalyticsListItem } from "../../../shared/telemetry";
import { formatBytes, formatCount } from "../../lib/telemetry";
import { getItemTotalBytes, percentage, sortAnalyticsItems } from "./helpers";
import type { AnalyticsNavRoute, SortMode } from "./types";

export function AnalyticsMetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article className={`panel analytics-metric-card analytics-metric-${tone}`}>
      <span className="analytics-metric-icon" aria-hidden="true">
        <AnalyticsMetricIcon tone={tone} />
      </span>
      <div className="analytics-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function AnalyticsMetricIcon({ tone }: { tone: string }) {
  if (tone === "download") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 4v11" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (tone === "upload") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 20V9" />
        <path d="M7 14l5-5 5 5" />
        <path d="M5 4h14" />
      </svg>
    );
  }

  if (tone === "traffic") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 8h11" />
        <path d="M11 4l4 4-4 4" />
        <path d="M20 16H9" />
        <path d="M13 12l-4 4 4 4" />
      </svg>
    );
  }

  if (tone === "connections") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 8a4 4 0 0 1 4-4h2" />
        <path d="M17 16a4 4 0 0 1-4 4h-2" />
        <path d="M8 12h8" />
        <path d="M17 4h3v3" />
        <path d="M4 17v3h3" />
      </svg>
    );
  }

  if (tone === "domains") {
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16" />
        <path d="M12 4c2 2.2 3 4.8 3 8s-1 5.8-3 8" />
        <path d="M12 4c-2 2.2-3 4.8-3 8s1 5.8 3 8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 6h14" />
      <path d="M5 12h10" />
      <path d="M5 18h7" />
      <path d="M16 16l2 2 4-5" />
    </svg>
  );
}

export function AnalyticsLeaderboardCard({
  title,
  items,
  label,
  route,
  sortMode,
  onSortChange,
}: {
  title: string;
  items: AnalyticsListItem[];
  label: string;
  route: Exclude<AnalyticsNavRoute, "overview">;
  sortMode: SortMode;
  onSortChange: Dispatch<SetStateAction<SortMode>>;
}) {
  const top = useMemo(() => sortAnalyticsItems(items, sortMode).slice(0, 5), [items, sortMode]);
  const total = Math.max(...top.map(getItemTotalBytes), 1);

  return (
    <section className="panel analytics-leaderboard-card">
      <div className="analytics-card-head">
        <div>
          <p className="eyebrow">{label}</p>
          <h4>{title}</h4>
        </div>
        <div className="analytics-mode-toggle" role="tablist" aria-label={`${title} 排序`}>
          <button className={sortMode === "traffic" ? "is-active" : ""} onClick={() => onSortChange("traffic")} type="button">
            流量
          </button>
          <button className={sortMode === "connections" ? "is-active" : ""} onClick={() => onSortChange("connections")} type="button">
            连接
          </button>
        </div>
      </div>
      <div className="analytics-ranked-stack">
        {top.map((item, index) => (
          <div className="analytics-ranked-card is-static" key={item.key}>
            <div className="analytics-ranked-main">
              <span className="analytics-rank-badge">{index + 1}</span>
              <strong>{item.label}</strong>
            </div>
            <div className="analytics-ranked-metrics">
              <span>{formatBytes(item.downloadBytes + item.uploadBytes)}</span>
              <small>{percentage(item.downloadBytes + item.uploadBytes, top).toFixed(1)}%</small>
            </div>
            <AnalyticsSplitBar item={item} total={total} />
            <AnalyticsRankStats item={item} items={top} />
          </div>
        ))}
        {!top.length ? <div className="empty-state compact-empty-state">当前范围内还没有统计数据。</div> : null}
      </div>
      <div className="analytics-card-footer">
        <NavLink className="analytics-view-all" to={`/analytics/${route}`}>
          查看全部
        </NavLink>
      </div>
    </section>
  );
}

export function AnalyticsSplitBar({ item, total }: { item: AnalyticsListItem; total: number }) {
  const totalBytes = getItemTotalBytes(item);
  const width = Math.max(8, (totalBytes / Math.max(total, 1)) * 100);
  const downPercent = totalBytes > 0 ? (item.downloadBytes / totalBytes) * 100 : 50;

  return (
    <div className="analytics-split-bar">
      <span className="analytics-split-bar-fill" style={{ width: `${width}%` }}>
        <span className="analytics-split-bar-down" style={{ width: `${downPercent}%` }} />
        <span className="analytics-split-bar-up" style={{ width: `${100 - downPercent}%` }} />
      </span>
    </div>
  );
}

export function AnalyticsRankStats({ item, items }: { item: AnalyticsListItem; items: AnalyticsListItem[] }) {
  return (
    <div className="analytics-rank-stats">
      <span className="analytics-rank-stat analytics-rank-stat-download">↓ {formatBytes(item.downloadBytes)}</span>
      <span className="analytics-rank-stat analytics-rank-stat-upload">↑ {formatBytes(item.uploadBytes)}</span>
      <span className="analytics-rank-stat">{formatCount(item.connectionCount)} conn</span>
      <span className="analytics-rank-stat analytics-rank-share">{percentage(item.downloadBytes + item.uploadBytes, items).toFixed(1)}%</span>
    </div>
  );
}
