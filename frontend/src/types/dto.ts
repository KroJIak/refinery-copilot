import type {
  AgentRole,
  DataSource,
  Decision,
  FreshnessStatus,
  QualityFlag,
  QualityTarget,
  RefusalReason,
  RunStatus,
  ScenarioKind,
} from "./enums";
export interface TagPoint {
  tagCode: string;
  ts: string;
  value: number | null;
  qualityFlag: QualityFlag;
  source: DataSource;
  unit: string | null;
}
export type TimeSeries = TagPoint[];
export interface DataFreshness {
  pointId: string;
  source: DataSource;
  lastSampleTs: string | null;
  availableTs: string | null;
  ageHours: number | null;
  status: FreshnessStatus;
  warnAfterH: number;
  staleAfterH: number;
}
export interface ShapItem {
  feature: string;
  value: number;
  contribution: number;
}
export interface QualityAssessment {
  target: QualityTarget;
  horizonH: number;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  intervalWidth: number;
  specRisk: number;
  conformalApplied: boolean;
  modelArtifactId: string;
  shapTopK: ShapItem[];
  computedAt: string;
}
export interface StateItem {
  tag: string;
  value: number | null;
  unit: string | null;
}
export interface RiskItem {
  target: QualityTarget;
  limit: string;
  limitValue: number;
  p50: number;
  p10: number;
  p90: number;
  specRisk: number;
}
export interface ActionItem {
  tag: string;
  label?: string;
  unit: string | null;
  currentValue: number;
  recommendedValue: number;
  deltaPct: number | null;
}
export interface EffectItem {
  target: QualityTarget;
  unit: string;
  baselineP50: number;
  actionP50: number;
  p10: number;
  p90: number;
  marginToSpec: number;
}
export interface CheckItem {
  constraintId: string;
  description: string;
  limit: number | string;
  unit: string | null;
  value: number;
  passed: boolean;
}
export interface ConfidenceInterval {
  p10: number;
  p90: number;
}
export interface AlternativeItem {
  label: string;
  actions: ActionItem[];
  quality: { target: QualityTarget; p10: number; p50: number; p90: number }[];
  costIndex: number;
  paretoRank: number;
}
export interface RefusalInfo {
  reasons: RefusalReason[];
  details: string[];
}
export interface Recommendation {
  runId: string;
  createdAt: string;
  tPoint: string;
  decision: Decision;
  state: StateItem[];
  risks: RiskItem[];
  actions?: ActionItem[];
  effects?: EffectItem[];
  checks?: CheckItem[];
  confidence?: ConfidenceInterval;
  explanation: string;
  alternatives: AlternativeItem[];
  refusal: RefusalInfo | null;
}
export interface NumberRef {
  path: string;
  value: number;
  unit: string | null;
  label: string;
}
export interface AgentStep {
  runId: string;
  stepIdx: number;
  agentRole: AgentRole;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  inputDigest: string;
  inputSummary: Record<string, unknown>;
  output: Record<string, unknown>;
  notes: string[];
  numberRefs: NumberRef[];
  confidence: number | null;
}
export interface Scenario {
  scenarioId: string;
  kind: ScenarioKind;
  tPoint: string;
  overrides: Record<string, number>;
  description: string | null;
  seed: number;
}
export type ScenarioDraft = Omit<Scenario, "scenarioId" | "seed"> & {
  seed?: number;
};
export interface ControlledVariable {
  key: string;
  group: "hdu" | "avt" | "blend";
  label: string;
  unit: string;
  p2: number;
  p98: number;
  step: number;
  current?: number;
}
export interface ScenarioPreset {
  kind: ScenarioKind;
  tPoint: string;
  label: string;
  description: string;
  overrides: Record<string, number>;
}
export interface RunReport {
  runId: string;
  createdAt: string;
  status: RunStatus;
  scenario: Scenario;
  dataHashes: Record<string, string>;
  versions: Record<string, string>;
  env: Record<string, string>;
  freshness: DataFreshness[];
  quality: QualityAssessment[];
  agentsTrace: AgentStep[];
  recommendation: Recommendation;
  durationMs: number | null;
  artifacts: Record<string, string>;
}
export interface HealthResponse {
  status: string;
  contract: string;
  core: string;
  modelsLoaded: number | boolean;
}
export interface StateResponse {
  tPoint: string;
  tags: TagPoint[];
  freshness: DataFreshness[];
  lastRun?: { runId: string; decision: Decision };
}
export interface RunCreated {
  runId: string;
  status: "started";
  eventsUrl: string;
}
export interface RunSummary {
  runId: string;
  status: RunStatus;
  kind: ScenarioKind;
  tPoint: string;
  decision: Decision | null;
  createdAt: string;
}
export interface WhatifQualityPoint {
  target: QualityTarget;
  p10: number;
  p50: number;
  p90: number;
  specRisk: number;
  unit: string;
}
export interface WhatifVariant {
  overrides: Record<string, number>;
  quality: WhatifQualityPoint[];
  costIndex: number;
  feasible: boolean;
  violations: string[];
}
export interface WhatifRequest {
  tPoint: string;
  overrides: Record<string, number>;
  variants: Record<string, number>[];
}
export interface WhatifResponse {
  tPoint: string;
  elapsedMs: number;
  baseline: WhatifQualityPoint[];
  variants: WhatifVariant[];
}
export interface ModelArtifact {
  artifactId: string;
  target: QualityTarget;
  algorithm: string;
  quantiles: number[];
  modelUri: string;
  hyperparams: Record<string, unknown>;
  conformal: Record<string, unknown>;
  coverage: number;
  metrics: Record<string, number>;
  trainedOnRange: { start: string; end: string };
  features: string[];
  monotoneConstraints: Record<string, number>;
  dataHashes: Record<string, string>;
  createdAt: string;
  seed: number;
  coreVersion: string;
  active: boolean;
}
export interface RunStartedPayload {
  runId: string;
  status: "running";
  kind: ScenarioKind;
  tPoint: string;
  seed: number;
}
export interface StepPayload {
  runId: string;
  stepIdx: number;
  agentRole: AgentRole;
  label: string;
  payload: Record<string, unknown>;
}
export interface LogPayload {
  runId: string;
  stepIdx: number;
  level: "info" | "warn";
  message: string;
  ts: string;
}
export interface RunFinishedPayload {
  runId: string;
  status: "completed" | "refused";
  durationMs: number;
  reportUrl: string;
}
export interface RunFailedPayload {
  runId: string;
  errorCode: string;
  message: string;
  durationMs: number;
}
export type AgentStepStatus = "idle" | "running" | "done";
export type ConnectionState = "connecting" | "open" | "stale" | "closed";
