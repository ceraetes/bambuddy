"""Unit tests for 3MF project_settings override merge."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from backend.app.services.slicer_project_overrides import (
    _normalize_setting_value_for_compare,
    _values_differ,
    compute_process_overrides,
    map_embedded_preset_name,
    merge_preset_json,
    process_keys_from_project_settings,
    read_project_settings,
)


def _zip_with_settings(settings: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Metadata/project_settings.config", json.dumps(settings))
    return buf.getvalue()


class TestMapEmbeddedPresetName:
    def test_x1c_to_a1_mini(self):
        mapped = map_embedded_preset_name("0.20mm Standard @BBL X1C", "Bambu Lab A1 mini 0.4 nozzle")
        assert mapped == "0.20mm Standard @BBL A1M"


class TestComputeProcessOverrides:
    def test_differs_from_source_preset(self):
        project = process_keys_from_project_settings(
            {
                "layer_height": "0.2",
                "enable_support": "1",
                "printer_settings_id": "ignored",
            }
        )
        source = json.dumps({"layer_height": "0.2", "enable_support": "0", "type": "process"})
        overrides = compute_process_overrides(project, source)
        assert overrides == {"enable_support": "1"}
        assert "layer_height" not in overrides

    def test_skips_minus_one_sentinel(self):
        project = process_keys_from_project_settings({"tree_support_wall_count": "-1"})
        overrides = compute_process_overrides(project, None)
        assert "tree_support_wall_count" not in overrides

    def test_fallback_without_source_preset(self):
        project = process_keys_from_project_settings({"enable_support": "1", "printer_model": "Bambu Lab X1 Carbon"})
        overrides = compute_process_overrides(project, None)
        assert "enable_support" in overrides
        assert "printer_model" not in overrides

    def test_fallback_diffs_against_target_when_source_missing(self):
        project = process_keys_from_project_settings(
            {
                "enable_support": "1",
                "layer_height": "0.2",
                "custom_bambu_field": "99",
            }
        )
        target = json.dumps({"layer_height": "0.2", "enable_support": "0", "type": "process"})
        overrides = compute_process_overrides(project, None, target_process_json=target)
        assert overrides == {"enable_support": "1"}
        assert "custom_bambu_field" not in overrides
        assert "layer_height" not in overrides

    def test_unknown_keys_excluded_from_project_process(self):
        project = process_keys_from_project_settings(
            {
                "enable_support": "1",
                "some_opaque_profile_key": "42",
                "0.20mm Standard @BBL A1": "ignored",
            }
        )
        assert "enable_support" in project
        assert "some_opaque_profile_key" not in project

    def test_values_normalize_list_vs_scalar(self):
        assert not _values_differ("250", "['250']")
        assert not _values_differ("15%", "15%")
        assert _values_differ("1", "0")
        assert _normalize_setting_value_for_compare("true") == "1"

    def test_only_differs_from_materialized_baseline(self):
        source = json.dumps(
            {
                "enable_support": "0",
                "layer_height": "0.2",
                "sparse_infill_pattern": "grid",
                "gap_infill_speed": "['250']",
                "type": "process",
            }
        )
        project = process_keys_from_project_settings(
            {
                "enable_support": "1",
                "layer_height": "0.2",
                "sparse_infill_pattern": "crosshatch",
                "gap_infill_speed": "250",
                "printer_model": "ignored",
            }
        )
        overrides = compute_process_overrides(project, source)
        assert overrides == {
            "enable_support": "1",
            "sparse_infill_pattern": "crosshatch",
        }

    def test_project_only_process_keys_are_overrides(self):
        source = json.dumps({"enable_support": "0", "type": "process"})
        project = process_keys_from_project_settings(
            {
                "enable_support": "0",
                "prime_tower_infill_gap": "100%",
                "wall_transition_angle": "10",
            }
        )
        overrides = compute_process_overrides(project, source)
        assert overrides == {"prime_tower_infill_gap": "100%"}


class TestMergePresetJson:
    def test_merges_and_sets_type(self):
        base = json.dumps({"name": "0.20mm Standard @BBL A1 Mini", "inherits": "0.20mm Standard @BBL A1 Mini"})
        out = json.loads(merge_preset_json(base, {"enable_support": "1"}))
        assert out["enable_support"] == "1"
        assert out["type"] == "process"


class TestReadProjectSettings:
    def test_reads_from_zip(self):
        data = read_project_settings(_zip_with_settings({"layer_height": "0.2"}))
        assert data == {"layer_height": "0.2"}

    def test_invalid_zip_returns_none(self):
        assert read_project_settings(b"not-a-zip") is None
