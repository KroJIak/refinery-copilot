import { useEffect, useMemo, useState } from "react";
import type {
  AgentRole,
  AgentStep,
  AgentStepStatus,
  LogPayload,
  RunStatus,
} from "@/types";

export interface AgentNodeState {
  agentRole: AgentRole;
  status: "pending" | "running" | "done" | "failed";
  step?: AgentStep;
  startedAt?: string;
  logTail?: string[];
}
interface Props {
  nodes?: AgentNodeState[];
  steps?: Record<number, AgentStepStatus>;
  trace?: AgentStep[];
  logs?: LogPayload[];
  runStatus?: RunStatus | "idle";
  runId?: string | null;
  variant?: "full" | "mini";
  onOpenStep?: (step: AgentStep) => void;
}
const roles: { role: AgentRole; label: string }[] = [
  { role: "data", label: "Данные" },
  { role: "quality", label: "Качество" },
  { role: "reliability", label: "Надёжность" },
  { role: "optimization", label: "Варианты" },
  { role: "orchestrator", label: "Итог" },
];

const formatDuration = (ms: number | null | undefined) =>
  ms == null
    ? "…"
    : `${(ms / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с`;

export function AgentPipeline({
  nodes,
  steps = {},
  trace = [],
  logs = [],
  runStatus = "idle",
  runId,
  variant = "full",
  onOpenStep,
}: Props) {
  const [expanded, setExpanded] = useState<number | null | undefined>(
    undefined,
  );
  const [now, setNow] = useState(Date.now());
  const NodeHeader = variant === "mini" ? "div" : "button";
  useEffect(() => {
    if (runStatus !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runStatus]);
  const resolved = useMemo(
    () =>
      roles.map((item, index) => {
        const step = trace.find((value) => value.stepIdx === index);
        const explicit = nodes?.find((value) => value.agentRole === item.role);
        const status =
          explicit?.status ??
          (steps[index] === "done"
            ? "done"
            : steps[index] === "running"
              ? "running"
              : runStatus === "failed" &&
                  index === Math.max(...Object.keys(steps).map(Number), 0)
                ? "failed"
                : "pending");
        return {
          ...item,
          status,
          step: explicit?.step ?? step,
          startedAt: explicit?.startedAt,
          logTail:
            explicit?.logTail ??
            logs
              .filter((log) => log.stepIdx === index)
              .slice(-5)
              .map((log) => log.message),
        };
      }),
    [nodes, steps, trace, logs, runStatus],
  );
  return (
    <section
      className={`agent-pipeline agent-pipeline--${variant}`}
      aria-label="Конвейер агентов"
    >
      {resolved.map((node, index) => {
        const duration =
          node.step?.durationMs ??
          (node.status === "running" && node.startedAt
            ? now - Date.parse(node.startedAt)
            : undefined);
        const defaultExpanded = resolved.findIndex(
          (item) => item.status === "running",
        );
        const isExpanded =
          variant === "full" &&
          (expanded === undefined
            ? index ===
              (defaultExpanded >= 0
                ? defaultExpanded
                : resolved.map((item) => item.status).lastIndexOf("done"))
            : expanded === index);
        return (
          <div
            className={`agent-node agent-node--${node.status}`}
            key={node.role}
          >
            <NodeHeader
              className="agent-node__button"
              aria-expanded={variant === "full" ? isExpanded : undefined}
              onClick={() => {
                if (variant === "mini") return;
                setExpanded((value) => (value === index ? null : index));
                if (node.step) onOpenStep?.(node.step);
              }}
            >
              <span className="agent-node__status" aria-hidden="true">
                {node.status === "done"
                  ? "✓"
                  : node.status === "running"
                    ? "⠙"
                    : node.status === "failed"
                      ? "!"
                      : "○"}
              </span>
              <span>{node.label}</span>
              <span className="agent-node__duration">
                {node.status === "pending"
                  ? "ожидает"
                  : node.status === "running"
                    ? duration == null ? 'выполняется…' : `выполняется… ${Math.round(duration / 1000)} с`
                    : formatDuration(duration)}
              </span>
              {variant === "full" && (
                <span className="agent-node__chevron">
                  {isExpanded ? "⌃" : "⌄"}
                </span>
              )}
            </NodeHeader>
            {isExpanded && (
              <div className="agent-node__details">
                {node.step?.notes.length ? (
                  <ul>
                    {node.step.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Без текстовых выводов</p>
                )}
                {node.step?.numberRefs.length ? (
                  <div className="agent-node__numbers">
                    {node.step.numberRefs.map((ref) => (
                      <span key={`${ref.path}-${ref.label}`}>
                        {ref.label}: {ref.value.toLocaleString("ru-RU")}{" "}
                        {ref.unit ?? ""}
                      </span>
                    ))}
                  </div>
                ) : null}
                {node.step && (
                  <details>
                    <summary>Вход и выход</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          input: node.step.inputSummary,
                          output: node.step.output,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
      {variant === "full" && (
        <footer className="agent-pipeline__footer">
          Итог прогона: {runStatus}
          {runId ? ` · ${runId}` : ""}
        </footer>
      )}
    </section>
  );
}
