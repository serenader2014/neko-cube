import type { EChartsCoreOption } from "echarts/core";
import { formatBytes, formatChartTime, formatDateTime, formatRate } from "../../lib/telemetry";
import { RUNTIME_CHART_AXIS_COLOR, RUNTIME_CHART_GRID_COLOR, RUNTIME_CHART_TICK_COLOR } from "./constants";
import type { RuntimeTrafficChartPoint } from "./types";

const RUNTIME_CHART_INITIAL_ANIMATION_MS = 220;
// The realtime window changes xAxis min/max while points are appended and trimmed.
// Update animation makes ECharts morph line vertices by index instead of panning the plot.
const RUNTIME_CHART_UPDATE_ANIMATION_MS = 0;

const mobileTimeAxisMedia = {
  query: { maxWidth: 480 },
  option: {
    grid: {
      right: 8,
      bottom: 18,
    },
    xAxis: {
      splitNumber: 3,
      axisLabel: {
        hideOverlap: true,
        showMinLabel: false,
        showMaxLabel: true,
        margin: 8,
      },
    },
  },
};

export function buildRuntimeTrafficChartOption(points: RuntimeTrafficChartPoint[], domain: [number, number]): EChartsCoreOption {
  return {
    animationDuration: RUNTIME_CHART_INITIAL_ANIMATION_MS,
    animationDurationUpdate: RUNTIME_CHART_UPDATE_ANIMATION_MS,
    animationEasing: "cubicOut",
    animationEasingUpdate: "linear",
    grid: {
      top: 18,
      right: 12,
      bottom: 24,
      left: 8,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6, 18, 29, 0.96)",
      borderColor: "rgba(255, 141, 92, 0.24)",
      borderWidth: 1,
      textStyle: {
        color: "#d5e6f9",
      },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [];
        const timestamp = rows[0] && typeof rows[0] === "object" && "axisValue" in rows[0] ? Number((rows[0] as { axisValue: unknown }).axisValue) : domain[0];
        const items = rows
          .map((entry) => {
            if (!entry || typeof entry !== "object" || !("seriesName" in entry) || !("value" in entry) || !("color" in entry)) {
              return "";
            }
            const point = (entry as { value: unknown }).value as [number, number];
            const value = Array.isArray(point) ? Number(point[1] ?? 0) : 0;
            const label = String((entry as { seriesName: unknown }).seriesName);
            const color = String((entry as { color: unknown }).color);
            return `<div><span style="display:inline-block;margin-right:8px;width:8px;height:8px;border-radius:999px;background:${color};"></span>${label}: ${formatRate(value)}</div>`;
          })
          .join("");
        return `<div>${formatDateTime(timestamp)}</div>${items}`;
      },
    },
    xAxis: {
      type: "time",
      min: domain[0],
      max: domain[1],
      splitNumber: 5,
      axisLine: {
        lineStyle: { color: RUNTIME_CHART_AXIS_COLOR },
      },
      axisLabel: {
        color: RUNTIME_CHART_TICK_COLOR,
        hideOverlap: true,
        showMinLabel: false,
        showMaxLabel: true,
        formatter: (value: number) => formatChartTime(value),
      },
      splitLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: RUNTIME_CHART_TICK_COLOR,
        formatter: (value: number) => formatBytes(Number(value)),
      },
      splitLine: {
        lineStyle: { color: RUNTIME_CHART_GRID_COLOR },
      },
    },
    series: [
      {
        name: "Down",
        type: "line",
        smooth: 0.45,
        symbol: "none",
        data: points.map((point) => [point.timestampMs, point.down]),
        lineStyle: {
          color: "#2a95ff",
          width: 3,
          cap: "round",
          join: "round",
        },
        areaStyle: {
          color: "rgba(42, 149, 255, 0.2)",
        },
      },
      {
        name: "Up",
        type: "line",
        smooth: 0.45,
        symbol: "none",
        data: points.map((point) => [point.timestampMs, point.up]),
        lineStyle: {
          color: "#1cd9aa",
          width: 3,
          cap: "round",
          join: "round",
        },
        areaStyle: {
          color: "rgba(28, 217, 170, 0.18)",
        },
      },
    ],
    media: [mobileTimeAxisMedia],
  };
}

export function buildRuntimeConnectionsChartOption(points: RuntimeTrafficChartPoint[], domain: [number, number]): EChartsCoreOption {
  return {
    animationDuration: RUNTIME_CHART_INITIAL_ANIMATION_MS,
    animationDurationUpdate: RUNTIME_CHART_UPDATE_ANIMATION_MS,
    animationEasing: "cubicOut",
    animationEasingUpdate: "linear",
    grid: {
      top: 18,
      right: 12,
      bottom: 24,
      left: 8,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6, 18, 29, 0.96)",
      borderColor: "rgba(255, 141, 92, 0.24)",
      borderWidth: 1,
      textStyle: {
        color: "#d5e6f9",
      },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [];
        const timestamp = rows[0] && typeof rows[0] === "object" && "axisValue" in rows[0] ? Number((rows[0] as { axisValue: unknown }).axisValue) : domain[0];
        const row = rows[0] && typeof rows[0] === "object" && "value" in rows[0] ? (rows[0] as { value: unknown }).value : [timestamp, 0];
        const value = Array.isArray(row) ? Number(row[1] ?? 0) : 0;
        return `<div>${formatDateTime(timestamp)}</div><div>Active: ${value}</div>`;
      },
    },
    xAxis: {
      type: "time",
      min: domain[0],
      max: domain[1],
      splitNumber: 5,
      axisLine: {
        lineStyle: { color: RUNTIME_CHART_AXIS_COLOR },
      },
      axisLabel: {
        color: RUNTIME_CHART_TICK_COLOR,
        hideOverlap: true,
        showMinLabel: false,
        showMaxLabel: true,
        formatter: (value: number) => formatChartTime(value),
      },
      splitLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: RUNTIME_CHART_TICK_COLOR,
      },
      splitLine: {
        lineStyle: { color: RUNTIME_CHART_GRID_COLOR },
      },
    },
    series: [
      {
        name: "Active",
        type: "line",
        smooth: 0.45,
        symbol: "none",
        data: points.map((point) => [point.timestampMs, point.activeConnections]),
        lineStyle: {
          color: "#7bb6ff",
          width: 3,
          cap: "round",
          join: "round",
        },
        areaStyle: {
          color: "rgba(123, 182, 255, 0.12)",
        },
      },
    ],
    media: [mobileTimeAxisMedia],
  };
}
