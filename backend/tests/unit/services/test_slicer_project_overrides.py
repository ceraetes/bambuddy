"""Unit tests for 3MF project_settings override merge."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from backend.app.services.slicer_project_overrides import (
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
        assert mapped == "0.20mm Standard @BBL A1 Mini"


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
