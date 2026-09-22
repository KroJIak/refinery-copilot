import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, FileText, LoaderCircle, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "@/store";
import { AgentPipeline } from "@/components/agents/AgentPipeline";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { sulfurSeries } from "@/components/charts/sulfurSeries";
import {
  RecommendationCard,
  number,
  shortTag,
  targetLabel,
  valueWithUnit,
} from "@/components/recommendation/RecommendationCard";
import type { AlternativeItem, Recommendation } from "@/types";
import "../dashboard/primary.css";

const thresholds = [
  { kind: "spec_max" as const, value: 10, label: "10 мг/кг" },
];
const versionLabels: Record<string, string> = { python: "Python", lightgbm: "LightGBM", core: "Версия ядра", contract: "Версия контракта" };
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function RecommendationPage() {
  const { runId: routeRunId } = useParams();
  const navigate = useNavigate();
  const store = useAppStore();
  const [filter, setFilter] = useState("all");
  const [exportError, setExportError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const active = store.runStatus === "running" || store.runStatus === "started";
  const viewingActive = !!routeRunId && routeRunId === store.runId;
  const running = viewingActive && active;
  const report = routeRunId ? store.reports[routeRunId] : undefined;
  const card = report?.recommendation ?? (viewingActive ? store.card : null);
  const kind = report?.scenario.kind ?? (viewingActive ? store.kind : null);
  const label =
    store.scenarios.find((item) => item.kind === kind)?.label ?? kind ?? "";
  const missing =
    !!routeRunId &&
    !card &&
    !running &&
    !store.reportLoading &&
    !!store.reportError;
  useEffect(() => {
    void store.ensureRuns();
  }, [store.ensureRuns]);
  useEffect(() => {
    if (!routeRunId && active && store.runId) {
      navigate(`/recommendation/${store.runId}`, { replace: true });
      return;
    }
    if (routeRunId && !running && !report) void store.loadRun(routeRunId);
  }, [
    routeRunId,
    active,
    store.runId,
    running,
    report,
    store.loadRun,
    navigate,
  ]);
  useEffect(() => {
    if (followLog.current && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [store.logs]);
  const series = useMemo(
    () =>
      sulfurSeries(store.tags, report?.scenario.tPoint ?? store.tPoint, card),
    [store.tags, report?.scenario.tPoint, store.tPoint, card],
  );
  const filteredRuns = store.runs.filter(
    (run) => filter === "all" || run.decision === filter,
  );
  const progress = Math.min(
    5,
    Object.values(store.steps).filter((status) => status === "done").length +
      (Object.values(store.steps).includes("running") ? 1 : 0),
  );
  const apply = (
    recommendation: Recommendation,
    alternative?: AlternativeItem,
  ) => {
    const actions = alternative?.actions ?? recommendation.actions ?? [];
    store.setWhatifDraft(
      Object.fromEntries(
        actions.map((action) => [action.tag, action.recommendedValue]),
      ),
    );
    navigate("/whatif");
  };
  const download = async (format: "md" | "json") => {
    if (!routeRunId) return;
    setExportError(null);
    try {
      const url = await store.exportReport(routeRunId, format);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${routeRunId}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Не удалось скачать отчёт",
      );
    }
  };
  const failed = viewingActive && store.runStatus === "failed";
  const retry = () => {
    const preset = store.scenarios.find((item) => item.kind === store.kind);
    if (preset)
      void store
        .startRun({
          kind: preset.kind,
          tPoint: preset.tPoint,
          overrides: preset.overrides,
          description: preset.description,
        })
        .then(() => {
          const id = useAppStore.getState().runId;
          if (id) navigate(`/recommendation/${id}`);
        });
  };

  return (
    <div
      className={`scenarios-page ${card && card.decision === "recommend" ? "scenarios-page--recommendation" : ""}`}
    >
      {card?.decision === "recommend" && (
        <aside className="recommendation-state">
          <h2>Состояние</h2>
          {card.state.map((item) => (
            <div className="state-reading" key={item.tag}>
              <span>{targetLabel[item.tag] ?? shortTag(item.tag)}</span>
              <strong>{number(item.value)}</strong>
              <small>{item.value === null ? "нет данных" : item.unit}</small>
            </div>
          ))}
        </aside>
      )}
      <div className="scenarios-main">
        {(running || failed) && !card ? (
          <>
            <h1 className="run-title">
              {failed ? "Прогон остановлен" : "Живой прогон"} — {label}
            </h1>
            <div className="run-progress">
              <progress value={progress} max={5} />
              <span>шаг {progress} из 5</span>
            </div>
            {store.connection === "stale" && (
              <div className="status-banner status-banner--warning">
                Соединение потеряно, переподключение…
              </div>
            )}
            {failed && (
              <div className="status-banner status-banner--error" role="alert">
                {store.error}
                <button className="text-button" onClick={retry}>
                  Повторить
                </button>
              </div>
            )}
            <div className="running-layout">
              <AgentPipeline
                runId={store.runId}
                steps={store.steps}
                trace={store.trace}
                logs={store.logs}
                runStatus={store.runStatus}
              />
              <section className="event-stream">
                <h2>Поток событий</h2>
                <div
                  className="event-stream__log"
                  ref={logRef}
                  onScroll={() => {
                    const node = logRef.current;
                    if (node)
                      followLog.current =
                        node.scrollHeight - node.scrollTop - node.clientHeight <
                        40;
                  }}
                  aria-live="polite"
                >
                  {store.logs.slice(-30).map((entry, index) => (
                    <div
                      className={`event-log ${entry.level === "warn" ? "event-log--warn" : ""}`}
                      key={`${entry.ts}-${index}`}
                    >
                      <time>
                        {new Date(entry.ts).toLocaleTimeString("ru-RU", {
                          timeZone: "UTC",
                        })}
                      </time>
                      <span>
                        {entry.level === "warn" && <TriangleAlert className="inline-icon" aria-label="Предупреждение" />}
                        {entry.message}
                      </span>
                    </div>
                  ))}
                  {!store.logs.length && (
                    <p className="muted">Ожидаем первое событие…</p>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : card ? (
          <>
            {card.decision === "refuse" && (
              <div className="scenario-label">Сценарий: {label}</div>
            )}
            <RecommendationCard
              recommendation={card}
              quality={report?.quality}
              onApplyAsScenario={apply}
              onExport={download}
              showExport
            />
            {card.decision === "refuse" && (
              <section className="refusal-chart">
                <h2>Сера на выходе, мг/кг</h2>
                <TimeSeriesChart
                  series={series}
                  thresholds={thresholds}
                  height={280}
                  now={card.tPoint}
                />
              </section>
            )}
            {exportError && (
              <div className="status-banner status-banner--error" role="alert">
                {exportError}
              </div>
            )}
            <details className="report-metadata">
              <summary>Воспроизводимость прогона</summary>
              <dl>
                <div>
                  <dt>Прогон</dt>
                  <dd>{card.runId}</dd>
                </div>
                <div>
                  <dt>Начальное число (seed)</dt>
                  <dd>{report?.scenario.seed ?? "—"}</dd>
                </div>
                <div>
                  <dt>Длительность</dt>
                  <dd>
                    {report?.durationMs == null
                      ? "—"
                      : valueWithUnit(report.durationMs / 1000, "с")}
                  </dd>
                </div>
                {Object.entries(report?.versions ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <dt>{versionLabels[key] ?? key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>Хэши данных</summary>
                {Object.keys(report?.dataHashes ?? {}).length ? (
                  <pre>{JSON.stringify(report?.dataHashes, null, 2)}</pre>
                ) : (
                  <p>—</p>
                )}
              </details>
            </details>
          </>
        ) : store.reportLoading && routeRunId ? (
          <div className="scenarios-empty" role="status">
            <div className="loading-spinner" />
            <h1>Загружаем прогон</h1>
          </div>
        ) : missing ? (
          <div className="scenarios-empty">
            <h1>Прогон не найден</h1>
            <p>Возможно, ссылка устарела или прогон был удалён.</p>
            <Link to="/recommendation">История прогонов</Link>
            <Link to="/">На Обзор <ArrowRight className="inline-icon" aria-hidden="true" /></Link>
          </div>
        ) : (
          <div className="scenarios-empty">
            <div className="scenarios-empty__symbol" aria-hidden="true">
              <FileText aria-hidden="true" />
            </div>
            <h1>
              {store.runs.length ? "Выберите прогон" : "Прогонов ещё не было"}
            </h1>
            <p>
              {store.runs.length
                ? "Откройте результат в истории справа."
                : "Нажмите «Получить рекомендацию» на Обзоре"}
            </p>
            <Link to="/">На Обзор <ArrowRight className="inline-icon" aria-hidden="true" /></Link>
          </div>
        )}
      </div>
      <aside className="run-history">
        <h2>История прогонов</h2>
        {store.runs.length > 0 && (
          <div className="history-filters" aria-label="Фильтр истории">
            {[
              { key: "all", label: "Все" },
              { key: "recommend", label: <><CircleCheck aria-hidden="true" /> Совет</> },
              { key: "refuse", label: <><CircleX aria-hidden="true" /> Отказ</> },
            ].map((option) => (
              <button
                key={option.key}
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {store.runsLoading && !store.runs.length ? (
          <p className="muted" role="status">
            Загружаем…
          </p>
        ) : !store.runs.length ? (
          <p className="muted">Пусто</p>
        ) : filteredRuns.length ? (
          filteredRuns.map((run) => (
            <Link
              className={`history-run ${routeRunId === run.runId ? "history-run--active" : ""}`}
              to={`/recommendation/${run.runId}`}
              key={run.runId}
              title={`Срез ${run.tPoint}`}
            >
              <div>
                <time>{date(run.createdAt)}</time>
                <span
                  className={`history-run__status history-run__status--${run.status}`}
                >
                  {run.status === "completed"
                    ? <CircleCheck aria-hidden="true" />
                    : run.status === "refused"
                      ? <CircleX aria-hidden="true" />
                      : run.status === "failed"
                        ? <CircleAlert aria-hidden="true" />
                        : <LoaderCircle className="agent-node__spinner" aria-hidden="true" />}
                </span>
              </div>
              <strong>
                {store.scenarios.find((preset) => preset.kind === run.kind)
                  ?.label ?? run.kind}
              </strong>
              <small>
                {run.decision === "refuse"
                  ? "Отказ от рекомендации"
                  : run.decision === "recommend"
                    ? "Рекомендация"
                    : run.status === "failed"
                      ? "Прогон не завершён"
                      : "Идёт прогон…"}
              </small>
            </Link>
          ))
        ) : (
          <p className="muted">Нет прогонов с таким исходом</p>
        )}
      </aside>
    </div>
  );
}
