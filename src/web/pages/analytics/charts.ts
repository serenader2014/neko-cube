import type { EChartsCoreOption } from "echarts/core";
import type {
  AnalyticsListItem,
  AnalyticsRuleFlowResponse,
  AnalyticsTrendPoint,
} from "../../../shared/telemetry";
import type { ProxyProbeTrendPoint } from "../../../shared/probes";
import { formatBytes, formatChartTime, formatDateTime } from "../../lib/telemetry";
import { ANALYTICS_COLORS, ANALYTICS_WORLD_MAP_NAME, DOWNLOAD_COLOR, UPLOAD_COLOR } from "./constants";
import { buildDonutData, getItemTotalBytes, getMapCountryName, truncateFlowLabel } from "./helpers";
import type {
  DetailMode,
  FlowViewport,
  GeoMultiPolygon,
  GeoPolygon,
  GeoPosition,
  GeoRing,
  ProxyProbeSmokeXAxisMode,
  ProxyProbeSmokeSeriesVisibility,
  WorldMapFeature,
  WorldMapGeoJson,
} from "./types";

function getMobileCategoryLabelInterval(pointCount: number) {
  if (pointCount <= 4) {
    return 0;
  }
  return Math.max(1, Math.ceil(pointCount / 4) - 1);
}

function delayDelta(upper: number | null, lower: number | null) {
  return typeof upper === "number" && typeof lower === "number" ? Math.max(0, upper - lower) : null;
}

function finiteNumbers(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function percentileNumber(values: number[], percentile: number) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? sorted[0]!;
  const upper = sorted[upperIndex] ?? sorted[sorted.length - 1]!;
  return Math.round(lower + (upper - lower) * (position - lowerIndex));
}

function buildSmartDelayAxis(minValue: number, maxValue: number) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return { max: 1, min: 0 };
  }
  const normalizedMin = Math.max(0, Math.min(minValue, maxValue));
  const span = Math.max(1, maxValue - normalizedMin);
  const padding = Math.max(12, span * 0.22);
  let min = Math.max(0, Math.floor(normalizedMin - padding));
  let max = Math.ceil(maxValue + padding);
  const minSpan = Math.max(50, maxValue * 0.08);
  if (max - min < minSpan) {
    const center = (max + min) / 2;
    min = Math.max(0, Math.floor(center - minSpan / 2));
    max = Math.ceil(Math.max(center + minSpan / 2, min + minSpan));
  }
  return { max, min };
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function durationFromLabels(labels: string[]) {
  if (labels.length < 2) {
    return 0;
  }
  const startAt = new Date(labels[0]!).getTime();
  const endAt = new Date(labels[labels.length - 1]!).getTime();
  return Number.isFinite(startAt) && Number.isFinite(endAt) ? Math.max(0, endAt - startAt) : 0;
}

function formatProbeSmokeAxisLabel(value: string, mode: ProxyProbeSmokeXAxisMode) {
  if (mode === "dateTime") {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildProbeSmokeAxisLabelInterval(labels: string[], mode: ProxyProbeSmokeXAxisMode, compact = false) {
  if (labels.length <= 8) {
    return 0;
  }
  const duration = durationFromLabels(labels);
  if (mode === "dateTime" && duration > 48 * 60 * 60 * 1000) {
    const dayBreakIndexes = labels.flatMap((label, index) =>
      index === 0 || index === labels.length - 1 || localDateKey(label) !== localDateKey(labels[index - 1] ?? label) ? [index] : [],
    );
    const dayStep = Math.max(1, Math.ceil(dayBreakIndexes.length / (compact ? 4 : 8)));
    const visibleIndexes = new Set<number>([0, labels.length - 1]);
    dayBreakIndexes.forEach((index, position) => {
      if (position % dayStep === 0) {
        visibleIndexes.add(index);
      }
    });
    return (index: number) => visibleIndexes.has(index);
  }

  const targetLabelCount = compact ? (mode === "dateTime" ? 4 : 5) : (mode === "dateTime" ? 7 : 8);
  const step = Math.max(1, Math.ceil((labels.length - 1) / (targetLabelCount - 1)));
  return (index: number) =>
    index === 0
    || index === labels.length - 1
    || index % step === 0
    || (mode === "dateTime" && localDateKey(labels[index] ?? "") !== localDateKey(labels[index - 1] ?? ""));
}

function buildSmokeDensityData(points: ProxyProbeTrendPoint[], yAxisSpan: number, denseSmoke: boolean) {
  const binSizeMs = Math.max(4, Math.ceil(yAxisSpan / (denseSmoke ? 150 : 110)));
  const densityPoints: Array<{ bucket: string; count: number; delay: number }> = [];
  let maxCount = 1;

  for (const point of points) {
    const bins = new Map<number, { count: number; total: number }>();
    for (const delay of point.smokeDelayMs) {
      if (!Number.isFinite(delay)) {
        continue;
      }
      const bin = Math.round(delay / binSizeMs);
      const current = bins.get(bin);
      if (current) {
        current.count += 1;
        current.total += delay;
      } else {
        bins.set(bin, { count: 1, total: delay });
      }
    }
    for (const value of bins.values()) {
      maxCount = Math.max(maxCount, value.count);
      densityPoints.push({
        bucket: point.bucket,
        count: value.count,
        delay: Math.round(value.total / value.count),
      });
    }
  }

  const maxLog = Math.log2(maxCount + 1);
  return densityPoints.map((point) => {
    const density = Math.log2(point.count + 1) / maxLog;
    const opacity = Math.min(denseSmoke ? 0.5 : 0.62, (denseSmoke ? 0.2 : 0.24) + density * 0.34);
    const symbolSize = Math.min(denseSmoke ? 8.2 : 11, (denseSmoke ? 3.4 : 4.8) + Math.sqrt(point.count) * (denseSmoke ? 1.1 : 1.45));
    return {
      value: [point.bucket, point.delay],
      symbolSize: Math.round(symbolSize * 10) / 10,
      itemStyle: { color: `rgba(57, 48, 41, ${opacity.toFixed(2)})` },
    };
  });
}

function buildDelayBandSeries(
  name: string,
  stack: string,
  baseData: Array<number | null>,
  rangeData: Array<number | null>,
  color: string,
  z: number,
  boundaryColor = "transparent",
) {
  return [
    {
      name: `${name}-base`,
      type: "line",
      stack,
      symbol: "none",
      connectNulls: false,
      data: baseData,
      lineStyle: { opacity: 0 },
      areaStyle: { opacity: 0 },
      emphasis: { disabled: true },
      tooltip: { show: false },
      z,
    },
    {
      name,
      type: "line",
      stack,
      symbol: "none",
      connectNulls: false,
      data: rangeData,
      lineStyle: { color: boundaryColor, width: boundaryColor === "transparent" ? 0 : 1.2 },
      areaStyle: { color },
      emphasis: { disabled: true },
      tooltip: { show: false },
      z,
    },
  ];
}

export function buildAnalyticsTrendChartOption(points: AnalyticsTrendPoint[]): EChartsCoreOption {
  const mobileLabelInterval = getMobileCategoryLabelInterval(points.length);

  return {
    animationDuration: 420,
    animationDurationUpdate: 420,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    grid: {
      top: 16,
      right: 14,
      bottom: 24,
      left: 10,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255, 248, 237, 0.98)",
      borderColor: "rgba(77, 52, 29, 0.12)",
      borderWidth: 1,
      textStyle: {
        color: "#2e1d12",
      },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [];
        const label = rows[0] && typeof rows[0] === "object" && "axisValue" in rows[0] ? String((rows[0] as { axisValue: unknown }).axisValue) : "";
        const items = rows
          .map((entry) => {
            if (!entry || typeof entry !== "object" || !("seriesName" in entry) || !("value" in entry) || !("color" in entry)) {
              return "";
            }
            const value = Number((entry as { value: unknown }).value ?? 0);
            const color = String((entry as { color: unknown }).color);
            return `<div><span style="display:inline-block;margin-right:8px;width:8px;height:8px;border-radius:999px;background:${color};"></span>${String(
              (entry as { seriesName: unknown }).seriesName,
            )}: ${formatBytes(value)}</div>`;
          })
          .join("");
        return `<div>${formatDateTime(label)}</div>${items}`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.bucket),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(121, 97, 79, 0.82)",
        hideOverlap: true,
        formatter: (value: string) => formatChartTime(value),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(121, 97, 79, 0.82)",
        formatter: (value: number) => formatBytes(value),
      },
      splitLine: {
        lineStyle: {
          color: "rgba(121, 97, 79, 0.12)",
          type: "dashed",
        },
      },
    },
    series: [
      {
        name: "下载",
        type: "line",
        smooth: 0.42,
        symbol: "none",
        data: points.map((point) => point.downloadBytes),
        lineStyle: { color: DOWNLOAD_COLOR, width: 3, cap: "round", join: "round" },
        areaStyle: { color: "rgba(74, 125, 224, 0.16)" },
      },
      {
        name: "上传",
        type: "line",
        smooth: 0.42,
        symbol: "none",
        data: points.map((point) => point.uploadBytes),
        lineStyle: { color: UPLOAD_COLOR, width: 3, cap: "round", join: "round" },
        areaStyle: { color: "rgba(159, 99, 226, 0.12)" },
      },
    ],
    media: [
      {
        query: { maxWidth: 480 },
        option: {
          grid: {
            right: 10,
            bottom: 18,
          },
          xAxis: {
            axisLabel: {
              interval: mobileLabelInterval,
              hideOverlap: true,
              showMinLabel: true,
              showMaxLabel: true,
              margin: 8,
            },
          },
        },
      },
    ],
  };
}

const DEFAULT_PROXY_PROBE_SMOKE_VISIBILITY: ProxyProbeSmokeSeriesVisibility = {
  median: true,
  smoke: true,
  jitterBand: true,
  fullRange: true,
  loss: true,
};

export function buildProxyProbeSmokeChartOption(
  points: ProxyProbeTrendPoint[],
  visibility: ProxyProbeSmokeSeriesVisibility = DEFAULT_PROXY_PROBE_SMOKE_VISIBILITY,
  xAxisMode: ProxyProbeSmokeXAxisMode = "time",
  focusYAxis = true,
  compact = false,
): EChartsCoreOption {
  const labels = points.map((point) => point.bucket);
  const axisLabelInterval = buildProbeSmokeAxisLabelInterval(labels, xAxisMode, compact);
  const allMaxDelay = Math.max(...points.map((point) => point.maxDelayMs ?? point.p90DelayMs ?? point.p95DelayMs ?? point.p50DelayMs ?? 0), 1);
  const normalAxisValues = finiteNumbers(points.flatMap((point) => [
    ...(visibility.fullRange ? [point.maxDelayMs ?? point.p90DelayMs ?? point.p95DelayMs ?? point.p50DelayMs] : []),
    ...(visibility.jitterBand ? [point.p90DelayMs ?? point.p95DelayMs ?? point.p50DelayMs] : []),
    ...(visibility.median ? [point.p50DelayMs] : []),
    ...(visibility.smoke ? point.smokeDelayMs : []),
  ]));
  const normalAxisMax = Math.max(...normalAxisValues, 0);
  const allMinDelayCandidate = Math.min(...finiteNumbers(points.map((point) => point.minDelayMs ?? point.p50DelayMs)), Number.POSITIVE_INFINITY);
  const allMinDelay = Number.isFinite(allMinDelayCandidate) ? allMinDelayCandidate : 0;
  const smokeSampleCount = points.reduce((total, point) => total + point.smokeDelayMs.length, 0);
  const primaryDelayValues = finiteNumbers(points.flatMap((point) => [
    ...(visibility.jitterBand ? [point.p90DelayMs ?? point.p95DelayMs ?? point.p50DelayMs] : []),
    ...(visibility.median ? [point.p50DelayMs] : []),
  ]));
  const smokeDelays = points.flatMap((point) => point.smokeDelayMs);
  const smokeAxisFloor = visibility.smoke ? percentileNumber(smokeDelays, 0.02) : null;
  const smokeAxisLimit = visibility.smoke ? percentileNumber(smokeDelays, 0.98) : null;
  const primaryAxisFloor = Math.min(...primaryDelayValues, smokeAxisFloor ?? Number.POSITIVE_INFINITY);
  const primaryAxisLimit = Math.max(...primaryDelayValues, smokeAxisLimit ?? 0);
  const hasPrimarySeries = visibility.median || visibility.jitterBand || visibility.smoke;
  const maxDelay = focusYAxis && hasPrimarySeries && primaryAxisLimit > 0 ? primaryAxisLimit : (normalAxisMax > 0 ? normalAxisMax : allMaxDelay);
  const minDelay = focusYAxis && hasPrimarySeries && Number.isFinite(primaryAxisFloor) ? primaryAxisFloor : allMinDelay;
  const delayAxis = focusYAxis ? buildSmartDelayAxis(minDelay, maxDelay) : { max: Math.ceil(Math.max(maxDelay, 1) * 1.18), min: 0 };
  const yAxisMin = delayAxis.min;
  const yAxisMax = delayAxis.max;
  const failureMarkerHeight = Math.max((yAxisMax - yAxisMin) * 0.045, 6);
  const denseSmoke = points.length > 96 || smokeSampleCount > 520;
  const smokeDensityData = buildSmokeDensityData(points, yAxisMax - yAxisMin, denseSmoke);
  const fullRangeBase = points.map((point) => point.minDelayMs ?? point.p50DelayMs);
  const fullRangeSpread = points.map((point) =>
    delayDelta(point.maxDelayMs ?? point.p90DelayMs ?? point.p95DelayMs, point.minDelayMs ?? point.p50DelayMs),
  );
  const jitterBandBase = points.map((point) => point.p50DelayMs ?? point.minDelayMs);
  const jitterBandSpread = points.map((point) =>
    delayDelta(point.p90DelayMs ?? point.p95DelayMs ?? point.maxDelayMs, point.p50DelayMs ?? point.minDelayMs),
  );
  const rangeSeries = buildDelayBandSeries(
    "最小到最大范围",
    "delay-full-range",
    fullRangeBase,
    fullRangeSpread,
    denseSmoke ? "rgba(57, 48, 41, 0.13)" : "rgba(57, 48, 41, 0.08)",
    2,
    denseSmoke ? "rgba(57, 48, 41, 0.22)" : "rgba(57, 48, 41, 0.12)",
  );
  const jitterSeries = buildDelayBandSeries(
    "中位到 90 分位范围",
    "delay-jitter-range",
    jitterBandBase,
    jitterBandSpread,
    denseSmoke ? "rgba(169, 85, 43, 0.19)" : "rgba(169, 85, 43, 0.14)",
    3,
    denseSmoke ? "rgba(169, 85, 43, 0.28)" : "rgba(169, 85, 43, 0.18)",
  );

  return {
    animationDuration: 420,
    animationDurationUpdate: 420,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    grid: {
      top: compact ? 12 : 16,
      right: compact ? 8 : 14,
      bottom: compact ? (xAxisMode === "dateTime" ? 46 : 32) : 30,
      left: compact ? 4 : 10,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255, 248, 237, 0.98)",
      borderColor: "rgba(77, 52, 29, 0.12)",
      borderWidth: 1,
      textStyle: { color: "#2e1d12" },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [];
        const label = rows[0] && typeof rows[0] === "object" && "dataIndex" in rows[0] ? labels[Number((rows[0] as { dataIndex: unknown }).dataIndex)] : "";
        const point = points.find((item) => item.bucket === label);
        if (!point) {
          return "";
        }
        const loss = `${(point.lossRate * 100).toFixed(1)}%`;
        const clippedMin = focusYAxis && visibility.fullRange && typeof point.minDelayMs === "number" && point.minDelayMs < yAxisMin;
        const clippedMax = focusYAxis && visibility.fullRange && typeof point.maxDelayMs === "number" && point.maxDelayMs > yAxisMax;
        const clippedHint = clippedMin && clippedMax ? "（最小/最大值超出当前缩放）" : clippedMin ? "（最小值超出当前缩放）" : clippedMax ? "（最大值超出当前缩放）" : "";
        return [
          `<div>${formatDateTime(point.bucket)}</div>`,
          `<div>中位延迟：${formatDelay(point.p50DelayMs)}</div>`,
          `<div>90 分位：${formatDelay(point.p90DelayMs)}</div>`,
          `<div>标准差抖动：${formatDelay(point.jitterMs)}</div>`,
          `<div>最小到最大：${formatDelay(point.minDelayMs)} ~ ${formatDelay(point.maxDelayMs)}${clippedHint}</div>`,
          `<div>成功样本：${point.successCount}${point.smokeDelayMs.length ? ` / 单次样本 ${point.smokeDelayMs.length}` : ""}</div>`,
          `<div>失败率：${loss}</div>`,
        ].join("");
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(121, 97, 79, 0.82)",
        hideOverlap: true,
        interval: axisLabelInterval,
        margin: compact ? 10 : 8,
        rotate: compact && xAxisMode === "dateTime" ? 28 : 0,
        showMaxLabel: true,
        showMinLabel: true,
        fontSize: compact ? 10 : 12,
        formatter: (value: string) => formatProbeSmokeAxisLabel(value, xAxisMode),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: yAxisMin,
      max: yAxisMax,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(121, 97, 79, 0.82)",
        formatter: (value: number) => `${Math.round(value)}ms`,
      },
      splitLine: {
        lineStyle: { color: "rgba(121, 97, 79, 0.12)", type: "dashed" },
      },
    },
    series: [
      ...(visibility.fullRange ? rangeSeries : []),
      ...(visibility.jitterBand ? jitterSeries : []),
      ...(visibility.smoke
        ? [{
            name: "单次延迟样本",
            type: "scatter",
            data: smokeDensityData,
            emphasis: { disabled: true },
            tooltip: { show: false },
            z: 4,
          }]
        : []),
      ...(visibility.median
        ? [{
            name: "中位延迟",
            type: "line",
            smooth: 0.35,
            symbol: "none",
            data: points.map((point) => point.p50DelayMs),
            lineStyle: { color: "#a9552b", width: 2.5, cap: "round", join: "round" },
            z: 6,
          }]
        : []),
      ...(visibility.loss
        ? [{
            name: "失败样本",
            type: "bar",
            yAxisIndex: 0,
            barWidth: 5,
            data: points.map((point) => (point.failureCount > 0 ? yAxisMin + failureMarkerHeight : yAxisMin)),
            itemStyle: { color: "rgba(180, 55, 37, 0.72)", borderRadius: [3, 3, 0, 0] },
            tooltip: { show: false },
            z: 5,
          }]
        : []),
    ],
  };
}

function formatDelay(value: number | null) {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

export function buildAnalyticsDonutChartOption(items: AnalyticsListItem[]): EChartsCoreOption {
  return {
    animationDuration: 420,
    animationDurationUpdate: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(255, 248, 237, 0.98)",
      borderColor: "rgba(77, 52, 29, 0.12)",
      textStyle: { color: "#2e1d12" },
      formatter: (params: unknown) => {
        if (!params || typeof params !== "object" || !("name" in params) || !("value" in params)) {
          return "";
        }
        return `${String((params as { name: unknown }).name)}<br/>${formatBytes(Number((params as { value: unknown }).value ?? 0))}`;
      },
    },
    series: [
      {
        type: "pie",
        radius: ["56%", "78%"],
        center: ["50%", "46%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: "rgba(255, 248, 237, 0.92)",
          borderWidth: 2,
        },
        data: buildDonutData(items).map((item, index) => ({
          name: item.label,
          value: item.value,
          itemStyle: { color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] },
        })),
      },
    ],
  };
}

export function buildAnalyticsBarChartOption(items: AnalyticsListItem[], mode: DetailMode | "region"): EChartsCoreOption {
  const labels = items.map((item) => item.label);
  const maxLabelWidth = mode === "region" ? 112 : 128;
  return {
    animationDuration: 360,
    animationDurationUpdate: 360,
    grid: {
      top: 12,
      right: 72,
      bottom: 10,
      left: 6,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255, 248, 237, 0.98)",
      borderColor: "rgba(77, 52, 29, 0.12)",
      textStyle: { color: "#2e1d12" },
      formatter: (params: unknown) => {
        const row = Array.isArray(params) ? params[0] : null;
        if (!row || typeof row !== "object" || !("name" in row) || !("dataIndex" in row)) {
          return "";
        }
        const index = Number((row as { dataIndex: unknown }).dataIndex ?? 0);
        const item = items[index];
        if (!item) {
          return "";
        }
        return [
          `<div style="margin-bottom:4px">${String((row as { name: unknown }).name)}</div>`,
          `<div>总计：${formatBytes(item.downloadBytes + item.uploadBytes)}</div>`,
          `<div style="color:${DOWNLOAD_COLOR}">下载：${formatBytes(item.downloadBytes)}</div>`,
          `<div style="color:${UPLOAD_COLOR}">上传：${formatBytes(item.uploadBytes)}</div>`,
          `<div>连接：${item.connectionCount}</div>`,
        ].join("");
      },
    },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        show: false,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "category",
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(121, 97, 79, 0.9)",
        width: maxLabelWidth,
        overflow: "truncate",
      },
      data: labels,
    },
    series: [
      {
        name: "下载",
        type: "bar",
        stack: "traffic",
        data: items.map((item) => ({
          value: item.downloadBytes,
          itemStyle: {
            color: DOWNLOAD_COLOR,
            borderRadius: [0, 0, 0, 0],
          },
        })),
        barWidth: 18,
      },
      {
        name: "上传",
        type: "bar",
        stack: "traffic",
        label: {
          show: true,
          position: "right",
          color: "rgba(77, 52, 29, 0.88)",
          formatter: (params: unknown) => {
            if (!params || typeof params !== "object" || !("dataIndex" in params)) {
              return "";
            }
            const index = Number((params as { dataIndex: unknown }).dataIndex ?? 0);
            const item = items[index];
            return item ? formatBytes(item.downloadBytes + item.uploadBytes) : "";
          },
        },
        data: items.map((item, index) => ({
          value: item.uploadBytes,
          itemStyle: {
            color:
              mode === "ips" && index === 0
                ? "#7b5ce0"
                : ANALYTICS_COLORS[index % ANALYTICS_COLORS.length],
            borderRadius: [0, 999, 999, 0],
          },
        })),
        barWidth: 18,
      },
    ],
  };
}

export function buildAnalyticsWorldMapOption(items: AnalyticsListItem[], ready: boolean, compact = false): EChartsCoreOption {
  if (!ready) {
    return {};
  }
  const regions = items
    .map((item) => ({
      name: getMapCountryName(item),
      value: getItemTotalBytes(item),
      item,
    }))
    .filter((item) => item.name && item.value > 0);
  const maxTraffic = Math.max(...regions.map((item) => Number(item.value)), 1);

  return {
    animationDuration: 520,
    animationDurationUpdate: 360,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(255, 255, 255, 0.98)",
      borderColor: "rgba(148, 163, 184, 0.26)",
      borderWidth: 1,
      padding: [10, 12],
      extraCssText: "box-shadow:0 16px 36px rgba(15,23,42,.12);border-radius:12px;",
      textStyle: { color: "#2e1d12" },
      formatter: (params: unknown) => {
        if (!params || typeof params !== "object" || !("data" in params)) {
          return "";
        }
        const item = (params as { data?: { item?: AnalyticsListItem } }).data?.item;
        if (!item) {
          return "";
        }
        return [
          `<div style="margin-bottom:4px">${item.label}</div>`,
          `<div>总计：${formatBytes(getItemTotalBytes(item))}</div>`,
          `<div style="color:${DOWNLOAD_COLOR}">下载：${formatBytes(item.downloadBytes)}</div>`,
          `<div style="color:${UPLOAD_COLOR}">上传：${formatBytes(item.uploadBytes)}</div>`,
          `<div>连接：${item.connectionCount}</div>`,
        ].join("");
      },
    },
    visualMap: {
      show: false,
      min: 0,
      max: maxTraffic,
      calculable: false,
      inRange: {
        color: ["#dfe7ff", "#b8c6ff", "#817cf4", "#4f46e5"],
      },
    },
    series: [
      {
        type: "map",
        map: ANALYTICS_WORLD_MAP_NAME,
        roam: false,
        zoom: 1,
        layoutCenter: compact ? ["50%", "54%"] : ["50%", "52%"],
        layoutSize: compact ? "126%" : "168%",
        selectedMode: false,
        emphasis: {
          label: { show: false },
          itemStyle: {
            areaColor: "#4338ca",
            borderColor: "#ffffff",
            borderWidth: 1.2,
          },
        },
        itemStyle: {
          areaColor: "#eef4fb",
          borderColor: "#e0e8f3",
          borderWidth: 0.5,
        },
        data: regions,
      },
    ],
  };
}

export function buildAnalyticsRuleFlowOption(
  flow: AnalyticsRuleFlowResponse | undefined,
  selectedKey: string | null,
  mode: "focus" | "panorama",
  viewport: FlowViewport,
  compact = false,
): EChartsCoreOption {
  const nodes = flow?.nodes ?? [];
  const edges = flow?.edges ?? [];
  if (nodes.length === 0 || edges.length === 0) {
    return {};
  }

  const focusId = selectedKey ? `rule:${selectedKey}` : null;
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (mode === "focus" && focusId) {
    const visible = new Set<string>([focusId]);
    const downstreamQueue = [focusId];
    while (downstreamQueue.length > 0) {
      const current = downstreamQueue.shift()!;
      for (const edge of edges) {
        if (edge.source === current && !visible.has(edge.target)) {
          visible.add(edge.target);
          downstreamQueue.push(edge.target);
        }
      }
    }
    const upstreamQueue = [focusId];
    while (upstreamQueue.length > 0) {
      const current = upstreamQueue.shift()!;
      for (const edge of edges) {
        if (edge.target === current && !visible.has(edge.source)) {
          visible.add(edge.source);
          upstreamQueue.push(edge.source);
        }
      }
    }
    filteredNodes = nodes.filter((node) => visible.has(node.id));
    filteredEdges = edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  }

  const colorByType: Record<string, string> = {
    source: "#2f8df2",
    domain: "#44c7e8",
    rule: "#39c96b",
    group: "#f0c83c",
    proxy: "#f18b45",
    direct: "#ef464c",
  };
  const labelLimit = (nodeType: string) =>
    compact ? (nodeType === "domain" ? 11 : 9) : (nodeType === "domain" ? 18 : 16);
  const labelWidth = (nodeType: string) =>
    compact ? (nodeType === "domain" ? 76 : 68) : (nodeType === "domain" ? 128 : 118);

  return {
    animationDuration: 520,
    animationDurationUpdate: 360,
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(255, 248, 237, 0.98)",
      borderColor: "rgba(77, 52, 29, 0.12)",
      borderWidth: 1,
      padding: [10, 12],
      extraCssText: "box-shadow:0 16px 36px rgba(77,52,29,.12);border-radius:12px;",
      textStyle: { color: "#2e1d12" },
      formatter: (params: unknown) => {
        if (!params || typeof params !== "object" || !("data" in params)) {
          return "";
        }
        const data = (params as { data?: Record<string, unknown> }).data;
        if (!data) {
          return "";
        }
        const total = Number(data.value ?? (Number(data.uploadBytes ?? 0) + Number(data.downloadBytes ?? 0)));
        return [
          `<div style="margin-bottom:4px">${String(data.name ?? "")}</div>`,
          `<div>总计：${formatBytes(total)}</div>`,
          `<div style="color:${DOWNLOAD_COLOR}">下载：${formatBytes(Number(data.downloadBytes ?? 0))}</div>`,
          `<div style="color:${UPLOAD_COLOR}">上传：${formatBytes(Number(data.uploadBytes ?? 0))}</div>`,
          `<div>连接：${Number(data.connectionCount ?? 0)}</div>`,
        ].join("");
      },
    },
    series: [
      {
        type: "sankey",
        data: filteredNodes.map((node) => ({
          name: node.id,
          label: {
            color: "#2e1d12",
            fontWeight: 700,
            fontSize: compact ? 10 : 12,
            lineHeight: compact ? 13 : 16,
            overflow: "truncate",
            width: labelWidth(node.nodeType),
            position: compact ? "right" : (node.nodeType === "source" ? "left" : "right"),
            formatter: () => truncateFlowLabel(node.label, labelLimit(node.nodeType)),
          },
          itemStyle: {
            color: colorByType[node.nodeType],
            borderColor: "rgba(255, 250, 242, 0.86)",
            borderWidth: 1.2,
            borderRadius: 4,
          },
          uploadBytes: node.uploadBytes,
          downloadBytes: node.downloadBytes,
          connectionCount: node.connectionCount,
          value: node.uploadBytes + node.downloadBytes,
        })),
        links: filteredEdges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          value: Math.max(edge.uploadBytes + edge.downloadBytes, 1),
          uploadBytes: edge.uploadBytes,
          downloadBytes: edge.downloadBytes,
          connectionCount: edge.connectionCount,
          lineStyle: {
            color: "gradient",
            opacity: 0.34,
            curveness: 0.58,
          },
        })),
        draggable: false,
        orient: compact ? "vertical" : "horizontal",
        nodeAlign: "justify",
        roam: false,
        zoom: viewport.zoom,
        left: (compact ? 16 : 104) + viewport.offsetX,
        right: (compact ? 16 : 126) - viewport.offsetX,
        top: (compact ? 24 : 44) + viewport.offsetY,
        bottom: (compact ? 36 : 44) - viewport.offsetY,
        emphasis: {
          focus: "adjacency",
          lineStyle: {
            opacity: 0.58,
          },
        },
        nodeGap: compact ? 8 : 18,
        nodeWidth: compact ? 10 : 18,
        layoutIterations: compact ? 48 : 64,
      },
    ],
  };
}

export function sanitizeWorldMapGeoJson(geoJson: WorldMapGeoJson): WorldMapGeoJson {
  return {
    ...geoJson,
    features: geoJson.features
      .filter((mapFeature) => mapFeature.properties?.name !== "Antarctica")
      .map((mapFeature) => ({
        ...mapFeature,
        geometry: splitAntimeridianGeometry(mapFeature.geometry),
      })),
  };
}

function splitAntimeridianGeometry(geometry: WorldMapFeature["geometry"]): WorldMapFeature["geometry"] {
  const sourcePolygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const polygons: GeoMultiPolygon = [];

  for (const polygon of sourcePolygons) {
    const split = splitAntimeridianPolygon(polygon);
    polygons.push(...split);
  }

  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}

function splitAntimeridianPolygon(polygon: GeoPolygon): GeoMultiPolygon {
  if (polygon.length !== 1) {
    return [polygon];
  }

  const ring = polygon[0];
  const jumps = getAntimeridianJumps(ring);
  if (jumps.length !== 2) {
    return [polygon];
  }

  const [firstJump, secondJump] = jumps;
  const firstSegment = ring.slice(0, firstJump.index);
  const middleSegment = ring.slice(firstJump.index, secondJump.index);
  const lastSegment = ring.slice(secondJump.index);
  const firstSide = averageLongitude([...firstSegment, ...lastSegment]) >= 0 ? "east" : "west";
  const secondSide = firstSide === "east" ? "west" : "east";

  const primaryRing = closeRing(compactRing([
    ...firstSegment,
    firstJump.boundary[firstSide],
    secondJump.boundary[firstSide],
    ...lastSegment,
  ]));
  const secondaryRing = closeRing(compactRing([
    firstJump.boundary[secondSide],
    ...middleSegment,
    secondJump.boundary[secondSide],
    firstJump.boundary[secondSide],
  ]));

  return [[primaryRing], [secondaryRing]];
}

function getAntimeridianJumps(ring: GeoRing) {
  const jumps: Array<{
    index: number;
    boundary: { east: GeoPosition; west: GeoPosition };
  }> = [];

  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1];
    const current = ring[index];
    const delta = current[0] - previous[0];
    if (Math.abs(delta) <= 180) {
      continue;
    }

    const latitude = getBoundaryLatitude(previous, current);
    jumps.push({
      index,
      boundary: {
        east: [180, latitude],
        west: [-180, latitude],
      },
    });
  }

  return jumps;
}

function getBoundaryLatitude(previous: GeoPosition, current: GeoPosition) {
  if (Math.abs(Math.abs(previous[0]) - 180) < 0.001) {
    return previous[1];
  }
  if (Math.abs(Math.abs(current[0]) - 180) < 0.001) {
    return current[1];
  }
  return (previous[1] + current[1]) / 2;
}

function averageLongitude(ring: GeoRing) {
  const longitudes = ring.map(([longitude]) => longitude).filter((longitude) => Math.abs(longitude) < 179.999);
  if (longitudes.length === 0) {
    return 0;
  }
  return longitudes.reduce((sum, longitude) => sum + longitude, 0) / longitudes.length;
}

function compactRing(ring: GeoRing) {
  return ring.filter((point, index) => {
    const previous = ring[index - 1];
    return !previous || previous[0] !== point[0] || previous[1] !== point[1];
  });
}

function closeRing(ring: GeoRing) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    return [...ring, first];
  }
  return ring;
}
