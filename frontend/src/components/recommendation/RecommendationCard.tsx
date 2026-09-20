import type { ReactNode } from "react";
import type {
  AlternativeItem,
  QualityAssessment,
  Recommendation,
  RefusalReason,
} from "@/types";

export const targetLabel: Record<string, string> = {
  sulfur: "Сера",
  t95: "T95",
  cetane: "ЦЧ",
  d15: "Плотность",
  Q21: "Сера",
  "24-2000.Q21": "Сера",
  feed_rate: "Расход",
  F19: "Расход",
  "24-2000.F19": "Расход",
};
export const shortTag = (tag: string) =>
  tag.startsWith("24-2000.") ? tag.slice(8) : tag;
export const number = (value: number | null | undefined, precision = 1) =>
  value == null
    ? "—"
    : value.toLocaleString("ru-RU", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
export const valueWithUnit = (
  value: number | null | undefined,
  unit: string | null | undefined,
) => `${number(value)}${unit ? `\u00a0${unit}` : ""}`;
const refusalLabels: Record<RefusalReason, string> = {
  stale_lims: "Устаревший лабораторный анализ",
  wide_interval: "Широкий интервал прогноза",
  out_of_training_domain: "Режим вне области обучения",
  no_feasible_variant: "Нет допустимого варианта",
  sensor_fault: "Недостоверные показания датчика",
};
interface Props {
  recommendation: Recommendation;
  quality?: QualityAssessment[];
  mode?: "full" | "compact";
  onApplyAsScenario?: (
    card: Recommendation,
    alternative?: AlternativeItem,
  ) => void;
  onExport?: (format: "md" | "json") => void;
  showExport?: boolean;
}
function Block({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="recommendation-block">
      <span className="recommendation-block__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

export function RecommendationCard({
  recommendation: card,
  quality = [],
  mode = "full",
  onApplyAsScenario,
  onExport,
  showExport = false,
}: Props) {
  const action = card.actions?.[0];
  const sulfur = card.effects?.find((effect) => effect.target === "sulfur");
  const confidence = card.confidence
    ? (card.confidence.p10 + card.confidence.p90) / 2
    : null;
  if (mode === "compact")
    return (
      <div
        className={`recommendation-compact ${card.decision === "refuse" ? "recommendation-compact--refused" : ""}`}
      >
        <span className="recommendation-compact__star" aria-hidden="true">
          {card.decision === "refuse" ? "!" : "✦"}
        </span>
        <span>
          {card.decision === "refuse" ? (
            "Надёжной рекомендации нет"
          ) : (
            <>
              {action
                ? `${shortTag(action.tag)}: ${number(action.currentValue)} → ${valueWithUnit(action.recommendedValue, action.unit)}`
                : "Рекомендация готова"}
              {sulfur && (
                <>
                  {" "}
                  · сера {number(sulfur.baselineP50)} →{" "}
                  {number(sulfur.actionP50)} мг/кг
                </>
              )}
              {confidence !== null && (
                <> · уверенность {number(confidence, 2)}</>
              )}
            </>
          )}
        </span>
      </div>
    );
  if (card.decision === "refuse")
    return (
      <article className="recommendation-card recommendation-card--refused">
        <div className="refusal-heading">
          <span aria-hidden="true">!</span>
          <h1>Надёжной рекомендации нет</h1>
        </div>
        <ul className="refusal-reasons">
          {card.refusal?.reasons.map((reason, index) => (
            <li key={reason}>
              <strong>{refusalLabels[reason]}</strong>
              {card.refusal?.details[index] && (
                <p>{card.refusal.details[index]}</p>
              )}
            </li>
          ))}
        </ul>
        {card.refusal?.details
          .slice(card.refusal.reasons.length)
          .map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
        <p className="refusal-explanation">{card.explanation}</p>
        {showExport && onExport && (
          <div className="recommendation-actions">
            <button className="text-button" onClick={() => onExport("md")}>
              Экспорт MD
            </button>
            <button className="text-button" onClick={() => onExport("json")}>
              Экспорт JSON
            </button>
          </div>
        )}
      </article>
    );
  return (
    <article className="recommendation-card">
      {action && (
        <div className="recommendation-hero">
          <h1>
            {shortTag(action.tag)}: {number(action.currentValue)}{" "}
            <span className="recommendation-hero__arrow">→</span>{" "}
            <em>{number(action.recommendedValue)}</em>{" "}
            <small>{action.unit}</small>
          </h1>
          {sulfur && (
            <p>
              сера {number(sulfur.baselineP50)} →{" "}
              <em>{number(sulfur.actionP50)}</em> <span>{sulfur.unit}</span>
            </p>
          )}
        </div>
      )}
      {confidence !== null && (
        <div className="confidence-summary">
          <span>Уверенность {number(confidence, 2)}</span>
          <div className="confidence-summary__track">
            <span style={{ width: `${confidence * 100}%` }} />
          </div>
        </div>
      )}
      <Block title="Время и состояние" icon="◷">
        <p>
          {new Date(card.tPoint).toLocaleString("ru-RU", {
            timeZone: "UTC",
            dateStyle: "long",
            timeStyle: "short",
          })}{" "}
          UTC
        </p>
        <p>
          {card.state
            .map(
              (item) =>
                `${targetLabel[item.tag] ?? shortTag(item.tag)}: ${valueWithUnit(item.value, item.unit)}`,
            )
            .join(" · ")}
        </p>
      </Block>
      <Block title="Проблема / риск" icon="△">
        {card.risks.map((risk) => (
          <div className="risk-line" key={risk.target}>
            <p>
              {targetLabel[risk.target]}: {number(risk.p50)} · норма{" "}
              {risk.limit}
            </p>
            <p className="muted">
              Интервал {number(risk.p10)}–{number(risk.p90)} · риск{" "}
              {number(risk.specRisk * 100, 0)} %
            </p>
            <div className="risk-line__track">
              <span
                style={{
                  width: `${Math.min(100, risk.specRisk * 100)}%`,
                  background: risk.specRisk > 0.3 ? "#ff655c" : "#e5b752",
                }}
              />
            </div>
          </div>
        ))}
      </Block>
      <Block title="Предлагаемое действие" icon="⚙">
        {card.actions?.map((item) => (
          <p className="action-line" key={item.tag}>
            {shortTag(item.tag)}: {number(item.currentValue)} →{" "}
            <strong>{valueWithUnit(item.recommendedValue, item.unit)}</strong>
            {item.deltaPct !== null && (
              <span className="muted">
                {" "}
                ({item.deltaPct > 0 ? "+" : ""}
                {number(item.deltaPct)} %)
              </span>
            )}
          </p>
        ))}
      </Block>
      <Block title="Ожидаемый эффект" icon="▥">
        {card.effects?.map((effect) => (
          <p key={effect.target}>
            {targetLabel[effect.target]}: {number(effect.baselineP50)} →{" "}
            {valueWithUnit(effect.actionP50, effect.unit)}. Запас до
            спецификации: {valueWithUnit(effect.marginToSpec, effect.unit)}.
          </p>
        ))}
        <p className="model-disclaimer">
          Модельная оценка; история не подтверждает действий, которых в ней не
          было.
        </p>
        {quality.some((item) => item.shapTopK.length) && (
          <details className="shap-details">
            <summary>Факторы влияния</summary>
            {quality.flatMap((item) =>
              item.shapTopK.slice(0, 3).map((shap) => (
                <div
                  className="shap-row"
                  key={`${item.target}-${shap.feature}`}
                >
                  <span>{shap.feature}</span>
                  <meter min={-2} max={2} value={shap.contribution} />
                  <span>
                    {shap.contribution > 0 ? "+" : ""}
                    {number(shap.contribution, 2)}
                  </span>
                </div>
              )),
            )}
          </details>
        )}
      </Block>
      <Block title="Проверка ограничений" icon="♧">
        <div className="constraint-list">
          {card.checks?.map((check) => (
            <span
              className={check.passed ? "constraint-pass" : "constraint-fail"}
              key={check.constraintId}
            >
              <b aria-hidden="true">{check.passed ? "✓" : "×"}</b>
              {check.description}
            </span>
          ))}
        </div>
        {card.checks?.some((check) => !check.passed) && (
          <p className="constraint-fail">
            Рекомендация содержит невыполненные ограничения. Проверьте результат
            перед использованием.
          </p>
        )}
      </Block>
      <Block title="Уверенность" icon="◎">
        {card.confidence ? (
          <>
            <p>
              Диапазон оценки {number(card.confidence.p10, 2)}–
              {number(card.confidence.p90, 2)}
            </p>
            <div className="confidence-range">
              <span
                style={{
                  left: `${card.confidence.p10 * 100}%`,
                  width: `${(card.confidence.p90 - card.confidence.p10) * 100}%`,
                }}
              />
            </div>
          </>
        ) : (
          <p>Нет оценки</p>
        )}
      </Block>
      <Block title="Объяснение" icon="▤">
        <p>{card.explanation}</p>
      </Block>
      {!!card.alternatives.length && (
        <Block title="Альтернативы" icon="↗">
          {card.alternatives.map((alt) => (
            <div className="alternative-row" key={alt.label}>
              <span>
                {alt.label} · стоимость {number(alt.costIndex, 2)} · ранг{" "}
                {alt.paretoRank}
              </span>
              {onApplyAsScenario && (
                <button
                  className="text-button"
                  onClick={() => onApplyAsScenario(card, alt)}
                >
                  В What-if →
                </button>
              )}
            </div>
          ))}
        </Block>
      )}
      <div className="recommendation-actions">
        {onApplyAsScenario && (
          <button
            className="primary-button"
            disabled={!card.actions?.length}
            onClick={() => onApplyAsScenario(card)}
          >
            Применить как сценарий
          </button>
        )}
        {showExport && onExport && (
          <>
            <button className="secondary-button" onClick={() => onExport("md")}>
              Экспорт MD
            </button>
            <button
              className="secondary-button"
              onClick={() => onExport("json")}
            >
              Экспорт JSON
            </button>
          </>
        )}
      </div>
    </article>
  );
}
