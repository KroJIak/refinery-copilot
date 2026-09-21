import { create } from "zustand";
import type {
  AgentStep,
  AgentStepStatus,
  ConnectionState,
  ControlledVariable,
  DataFreshness,
  HealthResponse,
  LogPayload,
  ModelArtifact,
  Recommendation,
  RunReport,
  RunStatus,
  RunSummary,
  ScenarioDraft,
  ScenarioKind,
  ScenarioPreset,
  StateResponse,
  TagPoint,
  WhatifResponse,
} from "@/types";
import { api, setScenarioContext, subscribeRunEvents } from "@/mocks";
import { userMessage } from "@/services/userMessage";

export interface AppStore {
  state: StateResponse | null;
  tPoint: string | null;
  tags: TagPoint[];
  freshness: DataFreshness[];
  health: HealthResponse | null;
  loading: boolean;
  error: string | null;
  scenarios: ScenarioPreset[];
  scenariosLoading: boolean;
  scenariosError: string | null;
  controlledVariables: ControlledVariable[];
  models: ModelArtifact[];
  modelsLoading: boolean;
  modelsError: string | null;
  runs: RunSummary[];
  runsLoading: boolean;
  reports: Record<string, RunReport>;
  reportLoading: boolean;
  reportError: string | null;
  runId: string | null;
  runStatus: RunStatus | "idle";
  status: RunStatus | "idle";
  kind: ScenarioKind | null;
  steps: Record<number, AgentStepStatus>;
  trace: AgentStep[];
  logs: LogPayload[];
  card: Recommendation | null;
  reportUrl: string | null;
  errorCode: string | null;
  connection: ConnectionState | "closed";
  whatifDraft: Record<string, number>;
  whatifResult: WhatifResponse | null;
  whatifLoading: boolean;
  whatifError: string | null;
  bootstrap: () => Promise<void>;
  loadState: (params?: { tPoint?: string; tags?: string[] }) => Promise<void>;
  ensureScenarios: () => Promise<void>;
  selectScenario: (kind: ScenarioKind) => Promise<void>;
  ensureModels: () => Promise<void>;
  ensureRuns: () => Promise<void>;
  loadRun: (id: string) => Promise<void>;
  exportReport: (id: string, format: "json" | "md") => Promise<string>;
  startRun: (draft: ScenarioDraft) => Promise<void>;
  resetRun: () => void;
  setWhatifDraft: (draft: Record<string, number>) => void;
  evaluateWhatif: (
    overrides?: Record<string, number>,
    variants?: Record<string, number>[],
  ) => Promise<void>;
  requestWhatif: () => Promise<void>;
}
let stopSse: (() => void) | null = null;
let bootstrapPromise: Promise<void> | null = null;
let whatifAbort: AbortController | null = null;
let stateAbort: AbortController | null = null;
let stateVersion = 0;
let whatifVersion = 0;
let runVersion = 0;
let reportVersion = 0;
let bootstrapped = false;

export const useAppStore = create<AppStore>((set, get) => ({
  state: null,
  tPoint: null,
  tags: [],
  freshness: [],
  health: null,
  loading: false,
  error: null,
  scenarios: [],
  scenariosLoading: false,
  scenariosError: null,
  controlledVariables: [],
  models: [],
  modelsLoading: false,
  modelsError: null,
  runs: [],
  runsLoading: false,
  reports: {},
  reportLoading: false,
  reportError: null,
  runId: null,
  runStatus: "idle",
  status: "idle",
  kind: null,
  steps: {},
  trace: [],
  logs: [],
  card: null,
  reportUrl: null,
  errorCode: null,
  connection: "closed",
  whatifDraft: {},
  whatifResult: null,
  whatifLoading: false,
  whatifError: null,

  bootstrap: async () => {
    if (bootstrapped) return;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = Promise.all([
      get().ensureScenarios(),
      api
        .getControlledVariables()
        .then((controlledVariables) => set({ controlledVariables }))
        .catch(() => set({ controlledVariables: [] })),
      api
        .getHealth()
        .then((health) => set({ health }))
        .catch((e) =>
          set({ error: userMessage(e, "Сервис недоступен") }),
        ),
    ]).then(async () => {
      if (get().reportLoading || get().runId) {
        bootstrapped = true;
        return;
      }
      const initial = new URLSearchParams(window.location.search).get("kind");
      const preset =
        get().scenarios.find((item) => item.kind === initial) ??
        get().scenarios.find((item) => item.kind === "quality_risk") ??
        get().scenarios[0];
      if (preset) {
        set({ kind: preset.kind });
        setScenarioContext(preset.kind);
      }
      await get().loadState({ tPoint: preset?.tPoint });
      const previous = get().state?.lastRun;
      if (previous && !get().runId && !get().reportLoading)
        await get().loadRun(previous.runId);
      bootstrapped = true;
    });
    try {
      await bootstrapPromise;
    } finally {
      bootstrapPromise = null;
    }
  },
  loadState: async (params = {}) => {
    stateAbort?.abort();
    const controller = new AbortController();
    stateAbort = controller;
    const version = ++stateVersion;
    set({ loading: true, error: null, state: null, tags: [], freshness: [] });
    try {
      const value = await api.getState(params, controller.signal);
      if (version !== stateVersion) return;
      set({
        state: value,
        tPoint: value.tPoint,
        tags: value.tags,
        freshness: value.freshness,
        loading: false,
      });
    } catch (e) {
      if (version !== stateVersion || controller.signal.aborted) return;
      set({
        loading: false,
        error:
          userMessage(e, "Не удалось загрузить состояние"),
      });
    }
  },
  ensureScenarios: async () => {
    if (get().scenarios.length || get().scenariosLoading) return;
    set({ scenariosLoading: true, scenariosError: null });
    try {
      const scenarios = await api.getScenarios();
      set({ scenarios, scenariosLoading: false });
    } catch {
      const kinds: ScenarioKind[] = [
        "normal",
        "quality_risk",
        "sour_crude",
        "bad_data",
        "stale_lims",
      ];
      set({
        scenariosLoading: false,
        scenarios: kinds.map((kind) => ({
          kind,
          label: ({ normal: "Норма", quality_risk: "Риск по качеству", sour_crude: "Сернистая нефть", bad_data: "Плохие данные", stale_lims: "Устаревший ЛИМС" } as Record<ScenarioKind, string>)[kind],
          description: "",
          tPoint: get().tPoint ?? "",
          overrides: {},
        })),
        scenariosError:
          "Каталог сценариев недоступен — запуск по текущему срезу",
      });
    }
  },
  selectScenario: async (kind) => {
    if (kind === get().kind && get().state) return;
    const preset = get().scenarios.find((item) => item.kind === kind);
    get().resetRun();
    set({ kind, whatifResult: null });
    setScenarioContext(kind);
    await get().loadState({ tPoint: preset?.tPoint });
  },
  ensureModels: async () => {
    if (get().models.length || get().modelsLoading) return;
    set({ modelsLoading: true, modelsError: null });
    try {
      set({ models: await api.getModels(), modelsLoading: false });
    } catch (e) {
      set({
        modelsLoading: false,
        modelsError: userMessage(e, "Не удалось загрузить модели"),
      });
    }
  },
  ensureRuns: async () => {
    if (get().runsLoading) return;
    set({ runsLoading: true });
    try {
      set({ runs: await api.getRuns(), runsLoading: false });
    } catch (e) {
      set({
        runsLoading: false,
        error: userMessage(e, "Не удалось загрузить историю прогонов"),
      });
    }
  },
  loadRun: async (id) => {
    const version = ++reportVersion;
    set({ reportLoading: true, reportError: null });
    try {
      const value = get().reports[id] ?? (await api.getRun(id));
      if (version !== reportVersion) return;
      const activeId = get().runId;
      const activeBusy = Boolean(
        activeId &&
        activeId !== id &&
        (get().runStatus === "started" || get().runStatus === "running"),
      );
      let restoredState: StateResponse | null = null;
      if (!activeBusy) {
        setScenarioContext(value.scenario.kind);
        stateAbort?.abort();
        stateVersion++;
        restoredState = await api.getState({ tPoint: value.scenario.tPoint });
        if (version !== reportVersion) return;
      }
      set({
        reports: { ...get().reports, [id]: value },
        reportLoading: false,
        ...(activeBusy
          ? {}
          : {
              runId: id,
              card: value.recommendation,
              kind: value.scenario.kind,
              runStatus: value.status,
              status: value.status,
              tPoint: value.scenario.tPoint,
              freshness: value.freshness,
              state: restoredState
                ? { ...restoredState, freshness: value.freshness }
                : null,
              tags: restoredState?.tags ?? [],
              loading: false,
              trace: value.agentsTrace,
              steps: Object.fromEntries(
                value.agentsTrace.map((s) => [s.stepIdx, "done"]),
              ),
            }),
      });
    } catch (e) {
      if (version !== reportVersion) return;
      set({
        reportLoading: false,
        reportError: userMessage(e, "Прогон не найден"),
      });
    }
  },
  exportReport: async (id, format) => {
    const response = await api.getReport(id, format);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    set({ reportUrl: url });
    return url;
  },
  startRun: async (draft) => {
    if (get().runStatus === "started" || get().runStatus === "running") return;
    stopSse?.();
    const version = ++runVersion;
    set({
      runStatus: "started",
      status: "started",
      kind: draft.kind,
      runId: null,
      card: null,
      trace: [],
      logs: [],
      steps: {},
      errorCode: null,
      reportUrl: null,
    });
    try {
      const created = await api.createRun(draft);
      if (version !== runVersion) return;
      set({ runId: created.runId });
      stopSse = subscribeRunEvents({
        url: created.eventsUrl,
        handlers: {
          onConnectionChange: (connection) => set({ connection }),
          onRunStarted: (p) =>
            set({
              runId: p.runId,
              kind: p.kind,
              runStatus: "running",
              status: "running",
            }),
          onAgentStarted: (s) =>
            set((state) => ({
              steps: { ...state.steps, [s.stepIdx]: "running" },
            })),
          onLog: (p) => set((state) => ({ logs: [...state.logs, p] })),
          onAgentFinished: (s) =>
            set((state) => ({
              steps: { ...state.steps, [s.stepIdx]: "done" },
              trace: [...state.trace, s],
            })),
          onRecommendation: (card) => set({ card }),
          onRefusal: (card) => set({ card }),
          onRunFinished: (p) => {
            set({
              runStatus: p.status,
              status: p.status,
              reportUrl: p.reportUrl,
            });
            void get().ensureRuns();
          },
          onRunFailed: (p) =>
            set({
              runStatus: "failed",
              status: "failed",
              errorCode: p.errorCode,
              error: userMessage(new Error(p.message), "Прогон завершился с ошибкой. Повторите попытку."),
            }),
        },
      });
    } catch (e) {
      if (version === runVersion)
        set({
          runStatus: "failed",
          status: "failed",
          error: userMessage(e, "Ошибка прогона"),
        });
    }
  },
  resetRun: () => {
    runVersion++;
    stopSse?.();
    stopSse = null;
    set({
      runId: null,
      runStatus: "idle",
      status: "idle",
      steps: {},
      trace: [],
      logs: [],
      card: null,
      reportUrl: null,
      errorCode: null,
      connection: "closed",
    });
  },
  setWhatifDraft: (draft) => set({ whatifDraft: draft }),
  evaluateWhatif: async (overrides = get().whatifDraft, variants = []) => {
    whatifAbort?.abort();
    const controller = new AbortController();
    whatifAbort = controller;
    const version = ++whatifVersion;
    set({ whatifLoading: true, whatifError: null, whatifDraft: overrides });
    try {
      const result = await api.whatif(
        {
          tPoint: get().tPoint ?? "",
          overrides,
          variants: variants.length ? variants : [overrides],
        },
        controller.signal,
      );
      if (version !== whatifVersion) return;
      set({ whatifResult: result, whatifLoading: false });
    } catch (e) {
      if (version !== whatifVersion || controller.signal.aborted) return;
      set({
        whatifLoading: false,
        whatifError: userMessage(e, "Ошибка расчёта"),
      });
    }
  },
  requestWhatif: async () => get().evaluateWhatif(),
}));
export const useStore = useAppStore;
export type RootStore = AppStore;
