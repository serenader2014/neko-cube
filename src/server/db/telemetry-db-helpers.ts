export type TimeRange = { start: string; end: string };

export function nowIso() {
  return new Date().toISOString();
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export function normalizeAnalyticsKey(value: unknown, fallbackLabel: unknown) {
  const rawValue = typeof value === "string" ? value : "";
  if (rawValue.length > 0) {
    return rawValue;
  }
  const rawLabel = typeof fallbackLabel === "string" ? fallbackLabel : "";
  return rawLabel.length > 0 ? rawLabel : "(unknown)";
}

export function durationMs(range: TimeRange) {
  return Math.max(0, new Date(range.end).getTime() - new Date(range.start).getTime());
}
