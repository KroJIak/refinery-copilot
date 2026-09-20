import type {
  AgentStep,
  ConnectionState,
  LogPayload,
  Recommendation,
  RunFailedPayload,
  RunFinishedPayload,
  RunStartedPayload,
  StepPayload,
} from "@/types";
export type RunEventHandlers = {
  onRunStarted?(p: RunStartedPayload): void;
  onAgentStarted?(s: AgentStep): void;
  onStep?(p: StepPayload): void;
  onLog?(p: LogPayload): void;
  onAgentFinished?(s: AgentStep): void;
  onRecommendation?(c: Recommendation): void;
  onRefusal?(c: Recommendation): void;
  onRunFinished?(p: RunFinishedPayload): void;
  onRunFailed?(p: RunFailedPayload): void;
  onConnectionChange?(s: ConnectionState): void;
};
export type SseSource = {
  url: string;
  handlers: RunEventHandlers;
  signal?: AbortSignal;
};
export function subscribeRunEvents(source: SseSource): () => void {
  if (source.signal?.aborted) return () => {};
  source.handlers.onConnectionChange?.("connecting");
  const es = new EventSource(source.url);
  let lastId = 0;
  let closed = false;
  const abort = () => {
    if (closed) return;
    closed = true;
    es.close();
    source.signal?.removeEventListener("abort", abort);
    source.handlers.onConnectionChange?.("closed");
  };
  const names = [
    "run_started",
    "agent_started",
    "step",
    "log",
    "agent_finished",
    "recommendation",
    "refusal",
    "run_finished",
    "run_failed",
  ] as const;
  const listeners = names.map((name) => {
    const fn = (e: MessageEvent<string>) => {
      if (closed) return;
      const seq = Number(e.lastEventId);
      if (e.lastEventId && seq <= lastId) return;
      try {
        const p = JSON.parse(e.data);
        const h = source.handlers;
        const dispatch = (
          {
            run_started: () => h.onRunStarted?.(p),
            agent_started: () => h.onAgentStarted?.(p),
            step: () => h.onStep?.(p),
            log: () => h.onLog?.(p),
            agent_finished: () => h.onAgentFinished?.(p),
            recommendation: () => h.onRecommendation?.(p),
            refusal: () => h.onRefusal?.(p),
            run_finished: () => h.onRunFinished?.(p),
            run_failed: () => h.onRunFailed?.(p),
          } as Record<string, (() => void) | undefined>
        )[name];
        dispatch?.();
        if (e.lastEventId) lastId = seq;
        if (name === "run_finished" || name === "run_failed") abort();
      } catch (error) {
        if (error instanceof SyntaxError)
          source.handlers.onConnectionChange?.("stale");
      }
    };
    es.addEventListener(name, fn);
    return [name, fn] as const;
  });
  es.onopen = () => source.handlers.onConnectionChange?.("open");
  es.onerror = () => source.handlers.onConnectionChange?.("stale");
  source.signal?.addEventListener("abort", abort, { once: true });
  return () => {
    listeners.forEach(([n, f]) => es.removeEventListener(n, f));
    source.signal?.removeEventListener("abort", abort);
    abort();
  };
}
