from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from refinery_core.agents.orchestrator import run_pipeline
from refinery_core.agents.quality import bump_t5, feature_matrix
from refinery_core.models.round2_search import add_plant_features
from refinery_core.scenarios import PRESETS, resolve_scenario
from refinery_core.types import EXPECTED_OUTCOME, REFUSAL_REASON_LABELS, refusal_reason_label


def test_refusal_labels_cover_all_codes():
    for code in (
        "stale_lims",
        "sensor_fault",
        "wide_interval",
        "out_of_training_domain",
        "no_feasible_variant",
    ):
        label = refusal_reason_label(code)
        assert label != code
        assert label == REFUSAL_REASON_LABELS[code]


def test_q21_not_in_features(registry):
    feats = registry.features_quantile + registry.features_whatif
    assert all("Q21" not in f for f in feats)
    assert registry.sulfur_metrics.get("uses_q21") is False


def test_row_is_published_not_future(store):
    t = datetime(2024, 8, 17, 14, 0, tzinfo=UTC)
    row = store.row_at(t)
    assert row["sample_ts"] + pd.Timedelta(hours=4) <= pd.Timestamp(t)


def test_demo_hours_are_distinct():
    hours = {PRESETS[k]["t_point"] for k in ("normal", "quality_risk", "bad_data", "sour_crude")}
    assert len(hours) == 4
    assert PRESETS["sour_crude"]["overrides"] == {}
    assert "feed_sulfur_delta" not in PRESETS["sour_crude"]
    assert PRESETS["bad_data"]["fault"].lims_age_hours is None


def test_bad_data_refuses(store, registry, settings):
    result = run_pipeline(resolve_scenario("bad_data"), store, registry, settings=settings)
    assert result.status == "refused"
    reasons = result.recommendation["refusal"]["reasons"]
    assert "stale_lims" in reasons
    assert result.ctx.steps["data"].output["freshness"][0]["age_hours"] > 52


def test_demo_kinds_match_expected(store, registry, settings):
    for kind in ("normal", "quality_risk", "sour_crude"):
        result = run_pipeline(resolve_scenario(kind), store, registry, settings=settings)
        assert result.recommendation["decision"] == EXPECTED_OUTCOME[kind], kind
        assert result.status == "completed"
    normal = run_pipeline(resolve_scenario("normal"), store, registry, settings=settings)
    action = normal.recommendation["actions"][0]
    assert action["current_value"] == action["recommended_value"]


def test_whatif_uses_loc_not_quantile_sign(store, registry):
    t = datetime(2026, 5, 24, 14, 0, tzinfo=UTC)
    row = store.row_at(t)
    df = add_plant_features(pd.DataFrame([row]))
    loc_cols = registry.features_whatif
    loc0 = registry.loc_value(feature_matrix(df, loc_cols))
    loc1 = registry.loc_value(feature_matrix(bump_t5(df, loc_cols, 5.0), loc_cols))
    assert loc1 - loc0 < 0


def test_determinism_numbers(store, registry, settings):
    sc = resolve_scenario("quality_risk")
    a = run_pipeline(sc, store, registry, settings=settings)
    b = run_pipeline(sc, store, registry, settings=settings)
    assert (
        a.recommendation["effects"][0]["action_p50"] == b.recommendation["effects"][0]["action_p50"]
    )
    assert (
        a.recommendation["actions"][0]["recommended_value"]
        == b.recommendation["actions"][0]["recommended_value"]
    )


def test_telemetry_window_present(store):
    t = datetime(2024, 8, 17, 14, 0, tzinfo=UTC)
    window = store.window(t)
    assert window
    assert "T5" in window[0]


def test_season_changes_cetane_check(store, registry, settings):
    summer = run_pipeline(
        resolve_scenario("normal", season="summer"), store, registry, settings=settings
    )
    winter = run_pipeline(
        resolve_scenario("normal", season="winter"), store, registry, settings=settings
    )
    s_ids = [c["constraint_id"] for c in summer.recommendation["checks"]]
    w_ids = [c["constraint_id"] for c in winter.recommendation["checks"]]
    assert "cetane_min_summer" in s_ids
    assert "cetane_min_winter" in w_ids
    assert s_ids != w_ids
    s_cetane = next(c for c in summer.recommendation["checks"] if "cetane" in c["constraint_id"])
    assert s_cetane["passed"] is None or isinstance(s_cetane["value"], float)


def test_sulfur_check_uses_expected_value(store, registry, settings):
    result = run_pipeline(resolve_scenario("quality_risk"), store, registry, settings=settings)
    sulfur = next(c for c in result.recommendation["checks"] if c["constraint_id"] == "sulfur_max")
    effect = result.recommendation["effects"][0]
    assert sulfur["value"] == effect["action_p50"]
    assert sulfur["passed"] == (effect["action_p50"] <= 10)
    assert effect["p90"] != effect["action_p50"]
    labels = {a["label"] for a in result.recommendation["actions"]}
    assert labels
    opt = result.ctx.steps["optimization"].output
    assert opt["n_feasible"] >= 1
    assert len(opt["candidates"]) > 4
    density = next(c for c in result.recommendation["checks"] if c["constraint_id"] == "density_range")
    assert density["passed"] is None or density["value"] is not None
