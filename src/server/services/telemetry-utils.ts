import crypto from "node:crypto";
import type { ClashTarget } from "../../shared/types.js";

export type AnalyticsTimeRange = {
  start: string;
  end: string;
  preset: "1h" | "24h" | "7d" | "custom";
};

export function computeTargetKey(target: Pick<ClashTarget, "controllerUrl" | "externalController" | "configPath">) {
  const input = [target.controllerUrl, target.externalController, target.configPath].join("|");
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function toMinuteIso(value: number | Date | string) {
  const date = new Date(value);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

export function toHourIso(value: number | Date | string) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function normalizeRuntimeLogLevel(level: string | undefined) {
  if (!level) {
    return "info";
  }
  if (level === "warn") {
    return "warning";
  }
  if (level === "silent") {
    return "silent";
  }
  if (level === "debug" || level === "info" || level === "warning" || level === "error") {
    return level;
  }
  return "info";
}

export function parseAnalyticsRange(
  preset: string | undefined,
  start: string | undefined,
  end: string | undefined,
  now = Date.now(),
): AnalyticsTimeRange {
  if (preset === "custom") {
    if (!start || !end) {
      throw new Error("Custom analytics range requires start and end.");
    }
    const startAt = new Date(start);
    const endAt = new Date(end);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt > endAt) {
      throw new Error("Invalid analytics time range.");
    }
    return {
      preset: "custom",
      start: startAt.toISOString(),
      end: endAt.toISOString(),
    };
  }

  const endDate = new Date(now);
  const startDate = new Date(now);
  switch (preset) {
    case "1h":
      startDate.setTime(now - 60 * 60 * 1000);
      return { preset: "1h", start: startDate.toISOString(), end: endDate.toISOString() };
    case "24h":
      startDate.setTime(now - 24 * 60 * 60 * 1000);
      return { preset: "24h", start: startDate.toISOString(), end: endDate.toISOString() };
    case "7d":
    default:
      startDate.setTime(now - 7 * 24 * 60 * 60 * 1000);
      return { preset: "7d", start: startDate.toISOString(), end: endDate.toISOString() };
  }
}

export function pickTrendBucketMinutes(range: Pick<AnalyticsTimeRange, "start" | "end">) {
  const duration = Math.max(0, new Date(range.end).getTime() - new Date(range.start).getTime());
  if (duration <= 6 * 60 * 60 * 1000) {
    return 1;
  }
  if (duration <= 48 * 60 * 60 * 1000) {
    return 5;
  }
  return 60;
}
