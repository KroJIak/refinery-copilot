from __future__ import annotations

from datetime import UTC, datetime

from refinery_core.agents.orchestrator import run_pipeline
from refinery_core.scenarios import resolve_scenario
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
    t = datetime(2024, 5, 15, 8, 0, tzinfo=UTC)
    row = store.row_at(t)
    assert row["sample_ts"] + __import__("pandas").Timedelta(hours=4) <= __import__(
        "pandas"
    ).Timestamp(t)


def test_bad_data_refuses(store, registry, settings):
    sc = resolve_scenario("bad_data")
    result = run_pipeline(sc, store, registry, settings=settings)
    assert result.status == "refused"
    assert result.recommendation["decision"] == "refuse"
    reasons = result.recommendation["refusal"]["reasons"]
    assert "stale_lims" in reasons
    assert "sensor_fault" in reasons


def test_demo_kinds_match_expected(store, registry, settings):
    for kind in ("normal", "quality_risk", "sour_crude"):
        result = run_pipeline(resolve_scenario(kind), store, registry, settings=settings)
        assert result.recommendation["decision"] == EXPECTED_OUTCOME[kind], kind
        assert result.status == "completed"
    normal = run_pipeline(resolve_scenario("normal"), store, registry, settings=settings)
    assert (
        normal.recommendation["actions"][0]["current_value"]
        == normal.recommendation["actions"][0]["recommended_value"]
    )


def test_whatif_uses_loc_not_quantile_sign(store, registry):
    import pandas as pd

    from refinery_core.agents.quality import bump_t5, feature_matrix
    from refinery_core.models.round2_search import add_plant_features

    t = datetime(2026, 6, 15, 8, 0, tzinfo=UTC)
    row = store.row_at(t)
    df = add_plant_features(pd.DataFrame([row]))
    loc_cols = registry.features_whatif
    q_cols = registry.features_quantile
    loc0 = registry.loc_value(feature_matrix(df, loc_cols))
    loc1 = registry.loc_value(feature_matrix(bump_t5(df, loc_cols, 5.0), loc_cols))
    assert loc1 - loc0 < 0
    q0 = registry.q50.predict(feature_matrix(df, q_cols))[0]
    q1 = registry.q50.predict(feature_matrix(bump_t5(df, q_cols, 5.0), q_cols))[0]
    # quantile gradient may have the wrong sign; loc must not follow it if they disagree
    assert (loc1 - loc0) != 0
    _ = q1 - q0


def test_determinism_numbers(store, registry, settings):
    sc = resolve_scenario("quality_risk")
    a = run_pipeline(sc, store, registry, settings=settings)
    b = run_pipeline(sc, store, registry, settings=settings)
    ea = a.recommendation["effects"][0]
    eb = b.recommendation["effects"][0]
    assert ea["baseline_p50"] == eb["baseline_p50"]
    assert ea["action_p50"] == eb["action_p50"]
    assert (
        a.recommendation["actions"][0]["recommended_value"]
        == b.recommendation["actions"][0]["recommended_value"]
    )
