import * as liveApi from "@/services/client";
import { mockApi, setMockScenario } from "./mockApi";
import type { ScenarioKind } from "@/types";
import { USE_MOCKS } from "@/config/env";
import { subscribeRunEvents as mockSubscribe } from "./mockSse";
import { subscribeRunEvents as liveSubscribe } from "@/services/sse";
export { USE_MOCKS } from "@/config/env";
export const api = USE_MOCKS ? mockApi : liveApi;
export const subscribeRunEvents = USE_MOCKS ? mockSubscribe : liveSubscribe;
export const setScenarioContext = (kind: ScenarioKind) => {
  if (USE_MOCKS) setMockScenario(kind);
};
export { controlledVariables, scenarioCatalog } from "./mockApi";
