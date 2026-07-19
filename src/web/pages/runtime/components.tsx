import type { Dispatch, SetStateAction } from "react";

export function OverviewStatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="runtime-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function Pager({
  page,
  setPage,
  totalItems,
  totalPages,
  pageSize,
  setPageSize,
}: {
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalItems: number;
  totalPages: number;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
}) {
  return (
    <div className="runtime-pager">
      <div className="runtime-pager-size">
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <span>{totalItems} 条</span>
      </div>
      <button className="runtime-filter-chip" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
        上一页
      </button>
      <span className="runtime-choice-pill">
        {page}/{totalPages}
      </span>
      <button
        className="runtime-filter-chip"
        disabled={page >= totalPages}
        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
        type="button"
      >
        下一页
      </button>
    </div>
  );
}

export function renderSortMark(active: boolean, direction: "asc" | "desc") {
  return <span className="runtime-table-sort-mark">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>;
}
