export type AgentRole =
  "data" | "quality" | "reliability" | "optimization" | "orchestrator";
export type FreshnessStatus = "ok" | "warn" | "stale" | "missing";
export type RefusalReason =
  | "stale_lims"
  | "wide_interval"
  | "out_of_training_domain"
  | "no_feasible_variant"
  | "sensor_fault";
export type RunStatus =
  "started" | "running" | "completed" | "refused" | "failed";
export type ScenarioKind =
  "normal" | "quality_risk" | "bad_data" | "sour_crude" | "stale_lims";
export type QualityTarget = "sulfur" | "t95" | "d15" | "cetane";
export type QualityFlag = "ok" | "sentinel" | "stuck" | "outlier" | "missing";
export type DataSource = "lims" | "pak" | "vak" | "kip";
export type Decision = "recommend" | "refuse";
