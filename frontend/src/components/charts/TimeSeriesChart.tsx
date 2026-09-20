import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts";
import type { EChartsOption, SeriesOption } from "echarts";
import type { TagPoint } from "@/types";

export interface SeriesInput {
  tagCode: string;
  label?: string;
  unit: string | null;
  points: TagPoint[];
  kind: "telemetry" | "forecast" | "lims_fact";
  p10?: TagPoint[];
  p90?: TagPoint[];
}
export interface ThresholdSpec {
  kind: "spec_max" | "spec_min" | "band";
  value: number | [number, number];
  label: string;
  breachColor?: string;
}
interface ChartProps {
  series: SeriesInput[];
  thresholds?: ThresholdSpec[];
  height?: number;
  lttbTarget?: number;
  syncGroup?: string;
  now?: string;
  sentinelAreas?: { from: string; to: string; reason: string }[];
  limsFacts?: { ts: string; value: number; label?: string }[];
  onPointClick?: (tagCode: string, ts: string) => void;
}

/** Largest triangle sampling; gap points are retained so missing measurements remain visible. */
export function lttbDownsample(points: TagPoint[], target = 8000): TagPoint[] {
  if (points.length <= target || target < 3) return points;
  const selected: TagPoint[] = [points[0]!];
  const bucket = (points.length - 2) / (target - 2);
  let previous = 0;
  for (let i = 0; i < target - 2; i += 1) {
    const nextStart = Math.floor((i + 1) * bucket) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucket) + 1, points.length);
    let meanX = 0;
    let meanY = 0;
    for (let j = nextStart; j < nextEnd; j += 1) {
      meanX += Date.parse(points[j]!.ts);
      meanY += points[j]!.value ?? 0;
    }
    const count = Math.max(nextEnd - nextStart, 1);
    meanX /= count;
    meanY /= count;
    const start = Math.floor(i * bucket) + 1;
    const end = Math.min(Math.floor((i + 1) * bucket) + 1, points.length - 1);
    let largest = -1;
    let chosen = start;
    for (let j = start; j < end; j += 1) {
      const area = Math.abs(
        (Date.parse(points[previous]!.ts) - meanX) *
          ((points[j]!.value ?? 0) - (points[previous]!.value ?? 0)) -
          (Date.parse(points[previous]!.ts) - Date.parse(points[j]!.ts)) *
            (meanY - (points[previous]!.value ?? 0)),
      );
      if (area > largest) {
        largest = area;
        chosen = j;
      }
    }
    selected.push(points[chosen]!);
    previous = chosen;
    const gap = points
      .slice(start, end)
      .find(
        (point) =>
          point.value === null ||
          point.qualityFlag === "sentinel" ||
          point.qualityFlag === "stuck",
      );
    if (gap && gap !== points[chosen]) selected.push(gap);
  }
  selected.push(points[points.length - 1]!);
  return selected.sort((a, b) => a.ts.localeCompare(b.ts));
}

const time = (value: number) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  });
const toPair = (point: TagPoint) => [
  Date.parse(point.ts),
  point.qualityFlag === "sentinel" || point.qualityFlag === "stuck"
    ? null
    : point.value,
];

export function TimeSeriesChart({
  series,
  thresholds = [],
  height = 340,
  lttbTarget = 8000,
  syncGroup,
  now,
  sentinelAreas = [],
  limsFacts = [],
  onPointClick,
}: ChartProps) {
  const [window, setWindow] = useState<[number, number]>([0, 100]);
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>();
  const bounds = useMemo<[number, number]>(() => {
    const nonempty = series.filter((item) => item.points.length);
    return [
      Math.min(...nonempty.map((item) => Date.parse(item.points[0]!.ts))),
      Math.max(
        ...nonempty.map((item) =>
          Date.parse(item.points[item.points.length - 1]!.ts),
        ),
      ),
    ];
  }, [series]);
  const option = useMemo<EChartsOption>(() => {
    const plotted: SeriesOption[] = [];
    const from = bounds[0] + ((bounds[1] - bounds[0]) * window[0]) / 100;
    const to = bounds[0] + ((bounds[1] - bounds[0]) * window[1]) / 100;
    const sample = (points: TagPoint[]) => {
      if (points.length <= lttbTarget) return points;
      const visible = points.filter(
        (point) => Date.parse(point.ts) >= from && Date.parse(point.ts) <= to,
      );
      return lttbDownsample(visible, lttbTarget);
    };
    for (const item of series) {
      const color = item.kind === "lims_fact" ? "#91baff" : "#397eff";
      const points = sample(item.points);
      if (item.kind === "forecast" && item.p10 && item.p90) {
        const low = sample(item.p10);
        const high = new Map(item.p90.map((point) => [point.ts, point.value]));
        plotted.push({
          type: "line",
          name: "Нижняя граница",
          data: low.map(toPair),
          stack: item.tagCode,
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
        });
        plotted.push({
          type: "line",
          name: "P10–P90",
          data: low.map((point) => [
            Date.parse(point.ts),
            point.value === null || high.get(point.ts) == null
              ? null
              : high.get(point.ts)! - point.value,
          ]),
          stack: item.tagCode,
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { color: "#397eff", opacity: 0.17 },
          silent: true,
          tooltip: { show: false },
        });
      }
      plotted.push({
        type: item.kind === "lims_fact" ? "scatter" : "line",
        name:
          item.label ??
          (item.kind === "lims_fact"
            ? "ЛИМС"
            : item.kind === "forecast"
              ? "Прогноз"
              : "Сера"),
        data: points.map(toPair),
        symbol: "circle",
        symbolSize: item.kind === "lims_fact" ? 6 : 4,
        showSymbol: points.length === 1,
        connectNulls: false,
        sampling: "lttb",
        itemStyle: { color },
        lineStyle: {
          color,
          width: 2,
          type: item.kind === "forecast" ? "dashed" : "solid",
        },
        progressive: 2000,
      } as SeriesOption);
      if (item.kind === "telemetry") {
        const breach = points.map((point) => {
          const value = point.value;
          const exceeds =
            value !== null &&
            thresholds.some(
              (th) =>
                typeof th.value === "number" &&
                (th.kind === "spec_max" ? value > th.value : value < th.value),
            );
          return [Date.parse(point.ts), exceeds ? value : null];
        });
        plotted.push({
          type: "line",
          name: "За нормой",
          data: breach,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: "#ff655c", width: 2 },
          tooltip: { show: false },
        });
      }
    }
    if (limsFacts.length)
      plotted.push({
        name: "ЛИМС",
        type: "scatter",
        data: limsFacts.map((point) => [Date.parse(point.ts), point.value]),
        symbolSize: 6,
        itemStyle: { color: "#91baff" },
      });
    plotted.push({
      type: "line",
      data: [],
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { type: "dashed", color: "#ff655c", width: 1 },
        label: { color: "#ff817a", fontSize: 11 },
        data: [
          ...thresholds
            .filter((th) => typeof th.value === "number")
            .map((th) => ({
              yAxis: th.value as number,
              label: { formatter: th.label },
            })),
          ...(now
            ? [
                {
                  xAxis: Date.parse(now),
                  lineStyle: { color: "#8e8e93" },
                  label: {
                    formatter: "сейчас",
                    color: "#a5a5ae",
                    position: "insideStartTop" as const,
                  },
                },
              ]
            : []),
        ],
      },
      markArea: {
        silent: true,
        itemStyle: {
          color: "rgba(255,214,10,.045)",
          decal: {
            symbol: "rect",
            dashArrayX: [1, 0],
            dashArrayY: [2, 5],
            rotation: -0.7,
            color: "rgba(255,214,10,.1)",
          },
        },
        label: { color: "#b5a55b", fontSize: 10 },
        data: [
          ...sentinelAreas.map((area) => [
            {
              name: area.reason === "stuck" ? "залипание" : "нет данных",
              xAxis: Date.parse(area.from),
            },
            { xAxis: Date.parse(area.to) },
          ]),
          ...thresholds
            .filter((th) => Array.isArray(th.value))
            .map((th) => [
              { name: th.label, yAxis: (th.value as number[])[0] },
              { yAxis: (th.value as number[])[1] },
            ]),
        ],
      },
    } as SeriesOption);
    return {
      animation: false,
      useUTC: true,
      backgroundColor: "transparent",
      textStyle: {
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      grid: { left: 43, right: 44, top: 26, bottom: 66 },
      tooltip: {
        trigger: "axis",
        appendToBody: true,
        backgroundColor: "#242426",
        borderColor: "#3a3a3d",
        textStyle: { color: "#f5f5f7", fontSize: 12 },
        axisPointer: { type: "cross" },
        valueFormatter: (value) =>
          typeof value === "number"
            ? value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
            : "нет данных",
      },
      xAxis: {
        type: "time",
        min: bounds[0],
        max: bounds[1],
        axisLine: { lineStyle: { color: "#38383c" } },
        axisLabel: { color: "#96969f", formatter: time, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: (value) => Math.max(0, Math.floor(value.min - 2)),
        axisLabel: { color: "#96969f" },
        splitLine: { lineStyle: { color: "#ffffff08" } },
      },
      dataZoom: [
        {
          type: "inside",
          start: window[0],
          end: window[1],
          filterMode: "none",
        },
        {
          type: "slider",
          start: window[0],
          end: window[1],
          filterMode: "none",
          bottom: 5,
          height: 20,
          borderColor: "#ffffff0d",
          backgroundColor: "#ffffff03",
          fillerColor: "#397eff12",
          handleStyle: { color: "#555562" },
          textStyle: { color: "#8e8e93" },
          showDetail: false,
          brushSelect: false,
        },
      ],
      series: plotted,
    };
  }, [
    series,
    thresholds,
    now,
    lttbTarget,
    window,
    bounds,
    sentinelAreas,
    limsFacts,
  ]);
  if (!series.some((item) => item.points.some((point) => point.value !== null)))
    return (
      <div className="chart-empty" style={{ minHeight: height }}>
        Нет данных за период
      </div>
    );
  return (
    <div
      role="img"
      aria-label="График временных рядов. Время указано в UTC."
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        setWindow(([a, b]) => [
          Math.max(0, Math.min(100 - (b - a), a + delta)),
          Math.min(100, Math.max(b - a, b + delta)),
        ]);
      }}
      tabIndex={0}
    >
      <ReactECharts
        option={option}
        style={{ height }}
        opts={{ renderer: "canvas" }}
        notMerge
        onChartReady={(chart) => {
          if (syncGroup) {
            chart.group = syncGroup;
            echarts.connect(syncGroup);
          }
        }}
        onEvents={{
          datazoom: (event: {
            start?: number;
            end?: number;
            batch?: { start: number; end: number }[];
          }) => {
            const next = event.batch?.[0] ?? event;
            if (next.start === undefined || next.end === undefined) return;
            const start = next.start;
            const end = next.end;
            clearTimeout(zoomTimer.current);
            zoomTimer.current = setTimeout(() => setWindow([start, end]), 80);
          },
          click: (event: { seriesName: string; value?: [number, number] }) => {
            if (event.value && onPointClick)
              onPointClick(
                event.seriesName,
                new Date(event.value[0]).toISOString(),
              );
          },
        }}
      />
    </div>
  );
}
