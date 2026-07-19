export function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  // No-break space keeps the number and unit on one line in narrow layouts.
  return `${size.toFixed(digits)}\u00A0${units[unitIndex]}`;
}

const compactCountFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number) {
  return compactCountFormat.format(Math.max(0, value));
}

export function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

export function formatDateTime(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatChartTime(value: string | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function buildAnalyticsSearch(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}
