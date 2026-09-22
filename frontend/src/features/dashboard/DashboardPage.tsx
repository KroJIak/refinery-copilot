import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/store";
import { AgentPipeline } from "@/components/agents/AgentPipeline";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { sulfurSeries } from "@/components/charts/sulfurSeries";
import {
  number,
  RecommendationCard,
} from "@/components/recommendation/RecommendationCard";
import type { ScenarioKind } from "@/types";
import "./primary.css";

const threshold = [{ kind: "spec_max" as const, value: 10, label: "10 мг/кг" }];
const dateLabel = (value: string) =>
  value
    ? new Date(value)
        .toLocaleString("ru-RU", {
          timeZone: "UTC",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        .replace(",", "")
    : "текущий срез";

export function DashboardPage() {
  const store = useAppStore();
  const [search, setSearch] = useSearchParams();
  const requestedKind = search.get("kind");
  const running =
    store.runStatus === "started" || store.runStatus === "running";
  const selected = store.scenarios.find((item) => item.kind === store.kind);
  useEffect(() => {
    void store.bootstrap();
  }, [store.bootstrap]);
  useEffect(() => {
    if (!store.scenarios.length || !store.state || store.loading) return;
    const requested = store.scenarios.find(
      (item) => item.kind === requestedKind,
    );
    if (requested && requested.kind !== store.kind && !running) {
      void store.selectScenario(requested.kind);
      return;
    }
    if (!requestedKind || !requested) {
      const fallback = requestedKind
        ? store.scenarios[0]
        : (selected ?? store.scenarios[0]);
      if (fallback) setSearch({ kind: fallback.kind }, { replace: true });
    }
  }, [
    requestedKind,
    store.scenarios,
    store.state,
    store.loading,
    store.kind,
    store.selectScenario,
    running,
    selected,
    setSearch,
  ]);
  const series = useMemo(
    () => sulfurSeries(store.tags, store.tPoint, store.card),
    [store.tags, store.tPoint, store.card],
  );
  const anomalies = useMemo(() => {
    const points = series[0]?.points ?? [];
    const intervals: { from: string; to: string; reason: string }[] = [];
    points.forEach((point, index) => {
      if (point.qualityFlag === "ok") return;
      const previous = intervals[intervals.length - 1];
      if (
        previous &&
        previous.to === point.ts &&
        previous.reason === point.qualityFlag
      )
        previous.to = points[index + 1]?.ts ?? point.ts;
      else
        intervals.push({
          from: point.ts,
          to: points[index + 1]?.ts ?? point.ts,
          reason: point.qualityFlag,
        });
    });
    return intervals;
  }, [series]);
  const getMetric = (target: string, pattern: RegExp) =>
    store.card?.risks.find((item) => item.target === target)?.p50 ??
    store.card?.state.find((item) => pattern.test(item.tag))?.value ??
    [...store.tags]
      .reverse()
      .find((item) => pattern.test(item.tagCode) && item.qualityFlag === "ok")
      ?.value;
  const metrics = [
    {
      target: "sulfur",
      title: "Сера",
      unit: "мг/кг",
      value: getMetric("sulfur", /sulfur|Q21/i),
      limit: "норма ≤ 10 мг/кг",
      breach: (value: number) => value > 10,
    },
    {
      target: "t95",
      title: "Выкипание",
      unit: "°C",
      value: getMetric("t95", /t95/i),
      limit: "норма ≤ 360 °C",
      breach: (value: number) => value > 360,
    },
    {
      target: "cetane",
      title: "Цетановое",
      unit: "",
      value: getMetric("cetane", /cetane/i),
      limit: "норма ≥ 51",
      breach: (value: number) => value < 51,
    },
  ];
  const chooseScenario = (kind: ScenarioKind) => {
    if (kind === store.kind) return;
    if (running && !window.confirm("Сбросить текущий прогон?")) return;
    void store.selectScenario(kind);
    setSearch({ kind });
  };
  const launch = () => {
    if (!selected) return;
    void store.startRun({
      kind: selected.kind,
      tPoint: selected.tPoint || store.tPoint || "",
      overrides: selected.overrides,
      description: selected.description,
    });
  };
  return (
    <div className="dashboard-page">
      <div className="scenario-presets" aria-label="Сценарии">
        {store.scenarios.map((preset) => (
          <button
            key={preset.kind}
            aria-pressed={preset.kind === store.kind}
            className={`scenario-preset ${preset.kind === store.kind ? "scenario-preset--active" : ""}`}
            onClick={() => chooseScenario(preset.kind)}
            title={preset.description ?? ""}
          >
            {preset.label}
            <span> · {dateLabel(preset.tPoint)}</span>
          </button>
        ))}
      </div>
      {store.health && !store.health.modelsLoaded && (
        <div className="status-banner status-banner--warning" role="status">
          Модели не загружены. Запуск рекомендаций пока недоступен.
        </div>
      )}
      {store.scenariosError && (
        <div className="status-banner status-banner--warning" role="status">
          {store.scenariosError}
        </div>
      )}
      {store.error && (
        <div className="status-banner status-banner--error" role="alert">
          {store.error}
        </div>
      )}
      {store.connection === "stale" && (
        <div className="status-banner status-banner--warning" role="status">
          Соединение потеряно, переподключение…
        </div>
      )}
      <div className={`dashboard-kpis ${store.loading ? "is-loading" : ""}`}>
        {metrics.map((metric, index) => (
          <section
            className={`dashboard-kpi ${index === 0 ? "dashboard-kpi--primary" : ""}`}
            key={metric.target}
          >
            {store.loading ? (
              <div className="skeleton skeleton-kpi" />
            ) : (
              <>
                <div
                  className={`dashboard-kpi__value ${metric.value != null && metric.breach(metric.value) ? "dashboard-kpi__value--breach" : ""}`}
                >
                  {number(metric.value)} <span>{metric.unit}</span>
                </div>
                <h2>{metric.title}</h2>
                <p>{metric.limit}</p>
              </>
            )}
          </section>
        ))}
      </div>
      <section className="dashboard-graph-panel">
        <div className="dashboard-chart">
          <div className="dashboard-chart__heading">
            <h2>Сера на выходе, мг/кг</h2>
            <div className="chart-legend">
              <span>
                <i className="legend-history" />
                История
              </span>
              {series.some((item) => item.kind === "forecast") && (
                <span>
                  <i className="legend-band" />
                  P10–P90
                </span>
              )}
              <span>
                <i className="legend-lims" />
                ЛИМС
              </span>
              <span>UTC</span>
            </div>
          </div>
          {store.loading ? (
            <div className="skeleton skeleton-chart" />
          ) : (
            <TimeSeriesChart
              series={series}
              thresholds={threshold}
              now={store.tPoint ?? undefined}
              height={360}
              sentinelAreas={anomalies}
            />
          )}
        </div>
        <div className="dashboard-agents">
          {store.runId ? (
            <Link
              to={`/recommendation/${store.runId}`}
              aria-label="Открыть конвейер агентов"
            >
              <AgentPipeline
                variant="mini"
                steps={store.steps}
                trace={store.trace}
                runStatus={store.runStatus}
              />
            </Link>
          ) : (
            <AgentPipeline variant="mini" />
          )}
        </div>
      </section>
      <div className="dashboard-bottom">
        {store.card && store.runId ? (
          <Link
            className="dashboard-result-link"
            to={`/recommendation/${store.runId}`}
          >
            <RecommendationCard mode="compact" recommendation={store.card} />
          </Link>
        ) : (
          <div className="dashboard-empty-result">
            <span aria-hidden="true" />
            {running
              ? "Агенты оценивают выбранный режим"
              : "Прогонов ещё не было"}
          </div>
        )}
        <button
          className="primary-button"
          disabled={
            running ||
            store.loading ||
            !store.state ||
            !selected ||
            (!!store.health && !store.health.modelsLoaded)
          }
          onClick={launch}
        >
          {running ? "Идёт прогон…" : "Получить рекомендацию"}
        </button>
      </div>
    </div>
  );
}
