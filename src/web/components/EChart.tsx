import { type CSSProperties, useEffect, useRef } from "react";
import { BarChart, LineChart, MapChart, PieChart, SankeyChart, ScatterChart } from "echarts/charts";
import { GeoComponent, GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { init, use, type ECharts, type EChartsCoreOption, type SetOptionOpts } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

// echarts/core `use` registers chart modules for tree-shaking — not a React hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
use([
  BarChart,
  LineChart,
  MapChart,
  PieChart,
  SankeyChart,
  ScatterChart,
  GeoComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

type EChartProps = {
  className?: string;
  option: EChartsCoreOption;
  style?: CSSProperties;
  updateOptions?: SetOptionOpts;
};

export function EChart({ className, option, style, updateOptions }: EChartProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const chart = init(element, undefined, { renderer: "svg" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, updateOptions ?? { notMerge: false, lazyUpdate: true });
  }, [option, updateOptions]);

  return <div className={className} ref={elementRef} style={style} />;
}
