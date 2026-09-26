import type { RootStore } from "./store";
import type { AgentRole } from '@/types';
const roles:AgentRole[]=['data','quality','reliability','optimization','orchestrator'];
export const selectTPoint = (s: RootStore) => s.tPoint;
export const selectFreshnessBadges = (s: RootStore) =>
  s.freshness.map((x) => ({ pointId: x.pointId, status: x.status }));
export const selectRunStatus = (s: RootStore) => s.runStatus;
export const selectActiveSteps = (s: RootStore) =>
  Object.entries(s.steps).map(([stepIdx, status]) => ({
    stepIdx: Number(stepIdx),
    role:
      s.trace.find((x) => x.stepIdx === Number(stepIdx))?.agentRole ?? roles[Number(stepIdx)] ?? 'data',
    status,
  }));
export const selectCard = (s: RootStore) => s.card;
export const selectIsRefusal = (s: RootStore) => s.card?.decision === "refuse";
export const selectWhatifReady = (s: RootStore) =>
  Boolean(s.whatifResult) && !s.whatifLoading;
export const selectViolations = (s: RootStore) =>
  s.whatifResult?.variants.flatMap((x) => x.violations) ?? [];
