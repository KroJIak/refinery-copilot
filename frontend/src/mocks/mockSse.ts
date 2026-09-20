import type { SseSource } from "@/services/sse";
import { agentTrace, completeMockRun, getMockRun } from "./mockApi";
import { recommendation } from "./fixtures";
export function subscribeRunEvents({
  url,
  handlers,
  signal,
}: SseSource): () => void {
  const id = url.split("/").at(-2) ?? "";
  const run = getMockRun(id);
  let closed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    signal?.removeEventListener("abort", close);
    handlers.onConnectionChange?.("closed");
  };
  const later = (ms: number, fn: () => void) =>
    timers.push(
      setTimeout(() => {
        if (!closed) fn();
      }, ms),
    );
  if (signal?.aborted) return close;
  signal?.addEventListener("abort", close, { once: true });
  handlers.onConnectionChange?.("connecting");
  if (!run) {
    later(0, () => {
      handlers.onRunFailed?.({
        runId: id,
        errorCode: "run_not_found",
        message: "Прогон не найден",
        durationMs: 0,
      });
      close();
    });
    return close;
  }
  later(20, () => {
    handlers.onConnectionChange?.("open");
    handlers.onRunStarted?.({ ...run, status: "running" });
  });
  for (const step of agentTrace(id)) {
    const base = 200 + step.stepIdx * 1100;
    later(base, () =>
      handlers.onAgentStarted?.({
        ...step,
        finishedAt: "",
        durationMs: null,
        output: {},
        numberRefs: [],
      }),
    );
    later(base + 450, () => {
      handlers.onStep?.({
        runId: id,
        stepIdx: step.stepIdx,
        agentRole: step.agentRole,
        label: step.notes[0] ?? "Проверка",
        payload: step.output,
      });
      handlers.onLog?.({
        runId: id,
        stepIdx: step.stepIdx,
        level: run.kind === "bad_data" && step.stepIdx === 0 ? "warn" : "info",
        message: step.notes[0] ?? "Проверка завершена",
        ts: step.startedAt,
      });
    });
    later(base + 900, () => handlers.onAgentFinished?.(step));
  }
  later(6000, () => {
    const card = recommendation(id, run.kind);
    card.tPoint = run.tPoint;
    if (card.decision === "refuse") handlers.onRefusal?.(card);
    else handlers.onRecommendation?.(card);
  });
  later(6200, () => {
    completeMockRun(id);
    handlers.onRunFinished?.({
      runId: id,
      status:
        run.kind === "bad_data" || run.kind === "stale_lims"
          ? "refused"
          : "completed",
      durationMs: 6200,
      reportUrl: `/api/runs/${id}/report.json`,
    });
    close();
  });
  return close;
}
export default subscribeRunEvents;
