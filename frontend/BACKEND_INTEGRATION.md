# Backend integration notes

This document records the failure modes the frontend is prepared to handle when mocks are replaced by the API.

## Contract rules

- Keep the transport error shape stable: `{ "error": { "code": string, "message": string, "details": object } }`.
- Treat `code` as a machine-readable value and never use the backend `message` as the primary user-facing copy. The frontend maps codes and HTTP statuses in `src/services/userMessage.ts`.
- Preserve the ISO-8601 UTC format for `tPoint`, timestamps, freshness dates, and run events. Reject invalid dates before rendering.
- Return complete DTOs for state, scenarios, models, runs, reports, and What-if results. Missing arrays should be `[]`, not `null`.
- Keep scenario `kind`, tag codes, model IDs, and constraint IDs stable; they are integration keys, not translated labels.
- The current client also normalizes the temporary single-sulfur What-if bridge response into the documented `baseline[]` / `variants[]` shape. Remove that compatibility path only after the backend emits the documented DTO for every quality target.

## HTTP failures

The UI has explicit copy for `models_not_loaded`, `model_not_ready`, `data_missing`, `bad_t_point`, `unknown_scenario_kind`, `unmanaged_override`, `too_many_variants`, `run_not_found`, `run_already_active`, `artifact_not_found`, `report_unavailable`, `validation_error`, and common 4xx/5xx statuses. Unknown errors fall back to a safe Russian message and remain available for developer logging.

Important edge cases to test:

1. `POST /runs` can return a duplicate active run (`409`) or a validation error (`422`); the page must remain retryable.
2. `POST /whatif` must reject more than eight variants and unknown/non-finite overrides without leaking a stack trace or field internals into the UI.
3. `/state` may contain missing telemetry, stale laboratory data, or a timestamp outside a model training window. These are valid domain states, not transport failures.
4. A report can disappear between the history list and `/runs/{id}`. Render the not-found state and keep navigation usable.
5. A model registry can be reachable but incompatible with the core version. Show the model warning and keep the rest of the application available.

## SSE failures and ordering

- The event stream must emit `run_started` before agent events and exactly one terminal `run_finished` or `run_failed` event.
- Events must include the same `runId`; ignore late events from an older run after the user starts a new one.
- Reconnects may produce duplicate events. Consumers should be idempotent by `(runId, stepIdx, event type)`.
- On a stale connection, send a reconnectable error; do not mark a completed run as failed only because the browser disconnected.
- Send UTF-8 JSON and keep event payload fields aligned with `docs/api` DTOs. Unknown event types must be ignored safely.

## Observability checklist

Before enabling the live client, verify request cancellation on route changes, timeout handling, UTC date parsing, empty/partial DTOs, duplicate SSE events, and the Russian error mapping for every documented backend code. Keep raw codes and request IDs in developer logs or expandable technical details only.
