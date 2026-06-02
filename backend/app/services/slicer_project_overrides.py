"""Map embedded 3MF preset names across printers and merge project_settings overrides.

When ``use_project_overrides`` is enabled on a slice request, Bambuddy reads
``Metadata/project_settings.config``, maps ``@BBL``-tagged preset names to the
target printer, diffs process keys against the source embedded process preset,
and merges the delta onto the resolved target process JSON before ``--load-settings``.
"""

from __future__ import annotations

import json
import logging
import re
import zipfile
from io import BytesIO
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.local_preset import LocalPreset
from backend.app.models.user import User
from backend.app.schemas.slicer import PresetRef, SliceBundleSpec
from backend.app.services.preset_resolver import resolve_preset_ref
from backend.app.utils.slicer_profile_resolve import (
    append_bbl_printer_tag,
    strip_bbl_printer_tag,
)

logger = logging.getLogger(__name__)

PROJECT_SETTINGS_PATH = "Metadata/project_settings.config"

# Keep in sync with library._PROJECT_SETTINGS_SENTINEL_KEYS (#1201).
PROJECT_SETTINGS_SENTINEL_KEYS = frozenset(
    {
        "raft_first_layer_expansion",
        "tree_support_wall_count",
        "prime_tower_brim_width",
    }
)

_IDENTITY_KEYS = frozenset(
    {
        "printer_settings_id",
        "print_settings_id",
        "filament_settings_id",
        "printer_model",
        "name",
        "inherits",
        "from",
        "type",
        "version",
    }
)

_PROCESS_HINT_KEYS = frozenset(
    {
        "layer_height",
        "first_layer_height",
        "wall_loops",
        "prime_tower_width",
        "prime_tower_max_speed",
        "prime_tower_rib_wall",
        "outer_wall_speed",
        "inner_wall_speed",
        "interlocking_depth",
        "bottom_shell_layers",
        "top_shell_layers",
        "sparse_infill_density",
        "enable_support",
        "support_type",
        "support_on_build_plate_only",
        "tree_support_branch_angle",
        "tree_support_wall_count",
        "raft_layers",
    }
)

_PRINTER_HINT_KEYS = frozenset(
    {
        "machine_max_speed_x",
        "machine_max_speed_y",
        "machine_max_speed_z",
        "bed_shape",
        "printable_area",
        "printable_height",
    }
)

_FILAMENT_HINT_KEYS = frozenset(
    {
        "filament_type",
        "filament_vendor",
        "filament_colour",
        "filament_color",
        "filament_is_support",
        "filament_ids",
    }
)


def read_project_settings(zip_bytes: bytes) -> dict | None:
    """Parse ``Metadata/project_settings.config`` from 3MF bytes."""
    try:
        with zipfile.ZipFile(BytesIO(zip_bytes), "r") as zf:
            if PROJECT_SETTINGS_PATH not in zf.namelist():
                return None
            data = json.loads(zf.read(PROJECT_SETTINGS_PATH).decode("utf-8"))
    except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError, OSError, KeyError):
        return None
    return data if isinstance(data, dict) else None


def map_embedded_preset_name(name: str | None, target_printer_model: str | None) -> str | None:
    """Remap a preset name's ``@BBL <printer>`` token to the target printer."""
    if not name or not str(name).strip():
        return None
    # Strip the source printer token first — ``append_bbl_printer_tag`` is a
    # no-op when a printer tag is already present (#1325 cross-printer map).
    base = strip_bbl_printer_tag(str(name).strip())
    return append_bbl_printer_tag(base, target_printer_model)


def _normalize_preset_name(name: str) -> str:
    cleaned = name.strip()
    if cleaned.startswith("# "):
        cleaned = cleaned[2:].strip()
    return re.sub(r"\s+", " ", cleaned).lower()


def classify_settings_key(key: str) -> Literal["identity", "printer", "process", "filament", "unknown"]:
    if key in _IDENTITY_KEYS or key.startswith("X-BBL"):
        return "identity"
    if key in _PRINTER_HINT_KEYS:
        return "printer"
    if key in _FILAMENT_HINT_KEYS:
        return "filament"
    if key in _PROCESS_HINT_KEYS:
        return "process"
    if re.search(r"\d+\.\d+mm\s", key):
        return "unknown"
    if "support" in key.lower() or "infill" in key.lower() or "wall" in key.lower():
        return "process"
    if "filament" in key.lower():
        return "filament"
    if "machine" in key.lower() or "nozzle" in key.lower() or "bed" in key.lower():
        return "printer"
    return "unknown"


def _flatten_setting_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        for item in value:
            if item is not None and str(item).strip():
                return str(item).strip()
        return None
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return str(value)


def process_keys_from_project_settings(project_settings: dict) -> dict[str, str]:
    """Extract process-class keys from project_settings with scalar string values."""
    out: dict[str, str] = {}
    for key, raw in project_settings.items():
        if classify_settings_key(key) not in ("process", "unknown"):
            continue
        flat = _flatten_setting_value(raw)
        if flat is not None:
            out[key] = flat
    return out


def _preset_dict_from_json(preset_json: str) -> dict[str, str]:
    try:
        data = json.loads(preset_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: str(v) for k, v in data.items() if v is not None}


def _values_differ(project_val: str, preset_val: str | None) -> bool:
    if preset_val is None:
        return True
    return project_val.strip() != preset_val.strip()


def compute_process_overrides(
    project_process: dict[str, str],
    source_process_json: str | None,
) -> dict[str, str]:
    """Keys in project_settings that differ from the embedded source process preset."""
    source_flat = _preset_dict_from_json(source_process_json) if source_process_json else {}

    overrides: dict[str, str] = {}
    for key, project_val in project_process.items():
        if key in PROJECT_SETTINGS_SENTINEL_KEYS and project_val == "-1":
            continue
        if project_val == "-1":
            continue
        if classify_settings_key(key) in ("identity", "printer", "filament"):
            continue
        if source_process_json and not _values_differ(project_val, source_flat.get(key)):
            continue
        overrides[key] = project_val
    return overrides


def merge_preset_json(base_json: str, overrides: dict[str, str], *, slot: str = "process") -> str:
    """Shallow-merge overrides onto a preset JSON string; ensure CLI ``type`` is set."""
    from backend.app.services.preset_resolver import _SLOT_TO_PROFILE_TYPE

    try:
        profile = json.loads(base_json)
    except json.JSONDecodeError:
        profile = {}
    if not isinstance(profile, dict):
        profile = {}
    profile.update(overrides)
    profile.setdefault("type", _SLOT_TO_PROFILE_TYPE.get(slot, "process"))
    return json.dumps(profile)


def _name_matches(candidate: str, preset_name: str) -> bool:
    return _normalize_preset_name(candidate) == _normalize_preset_name(preset_name)


def _base_name_matches(candidate: str, preset_name: str) -> bool:
    return _normalize_preset_name(strip_bbl_printer_tag(candidate)) == _normalize_preset_name(
        strip_bbl_printer_tag(preset_name)
    )


async def _find_local_preset_by_name(db: AsyncSession, slot: str, name: str) -> PresetRef | None:
    result = await db.execute(select(LocalPreset).where(LocalPreset.preset_type == slot).order_by(LocalPreset.id))
    presets = result.scalars().all()
    for p in presets:
        if _name_matches(name, p.name):
            return PresetRef(source="local", id=str(p.id))
    for p in presets:
        if _base_name_matches(name, p.name):
            return PresetRef(source="local", id=str(p.id))
    return None


async def resolve_preset_ref_by_name(
    db: AsyncSession,
    user: User | None,
    slot: str,
    name: str | None,
) -> PresetRef | None:
    """Resolve a preset catalogue ref by display name (exact, then @BBL base match)."""
    if not name or not str(name).strip():
        return None
    sought = str(name).strip()

    local_ref = await _find_local_preset_by_name(db, slot, sought)
    if local_ref is not None:
        return local_ref

    from backend.app.api.routes.slicer_presets import (
        _fetch_bundled_presets,
        _fetch_cloud_presets,
        _fetch_local_presets,
    )

    cloud_slots, _status = await _fetch_cloud_presets(db, user)
    local_slots = await _fetch_local_presets(db)
    standard_slots = await _fetch_bundled_presets(db)

    for _tier, slots in (
        ("cloud", cloud_slots),
        ("local", local_slots),
        ("standard", standard_slots),
    ):
        for preset in slots.get(slot, []):
            if _name_matches(sought, preset.name):
                return PresetRef(source=preset.source, id=preset.id)
        for preset in slots.get(slot, []):
            if _base_name_matches(sought, preset.name):
                return PresetRef(source=preset.source, id=preset.id)

    return None


def _first_settings_id(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None


def embedded_preset_names_from_project_settings(project_settings: dict) -> dict[str, str | None]:
    return {
        "printer": _first_settings_id(project_settings.get("printer_settings_id")),
        "process": _first_settings_id(project_settings.get("print_settings_id")),
    }


def map_bundle_spec_for_target(
    bundle: SliceBundleSpec,
    target_printer_model: str | None,
) -> SliceBundleSpec:
    """Return a copy of the bundle spec with printer-tagged preset names remapped."""
    return SliceBundleSpec(
        bundle_id=bundle.bundle_id,
        printer_name=map_embedded_preset_name(bundle.printer_name, target_printer_model) or bundle.printer_name,
        process_name=map_embedded_preset_name(bundle.process_name, target_printer_model) or bundle.process_name,
        filament_names=[map_embedded_preset_name(n, target_printer_model) or n for n in bundle.filament_names],
    )


async def apply_project_overrides_to_presets(
    db: AsyncSession,
    user: User | None,
    *,
    model_bytes: bytes,
    presets: dict[str, str],
    target_printer_model: str | None,
) -> tuple[dict[str, str], bool]:
    """Merge embedded process overrides onto ``presets['process']``.

    Uses the target-printer-mapped equivalent of the embedded process preset as
    the merge base when it resolves in the catalogue; otherwise keeps the
    caller-supplied resolved process JSON.

    Returns ``(presets, used_project_overrides)``.
    """
    project_settings = read_project_settings(model_bytes)
    if not project_settings:
        return presets, False

    embedded = embedded_preset_names_from_project_settings(project_settings)
    project_process = process_keys_from_project_settings(project_settings)

    source_process_name = embedded.get("process")
    source_process_json: str | None = None
    if source_process_name:
        source_ref = await resolve_preset_ref_by_name(db, user, "process", source_process_name)
        if source_ref is not None:
            try:
                source_process_json = await resolve_preset_ref(db, user, source_ref, "process")
            except Exception as exc:
                logger.warning("Could not resolve source process preset %r: %s", source_process_name, exc)

    overrides = compute_process_overrides(project_process, source_process_json)
    if not overrides:
        return presets, False

    target_process_json = presets.get("process", "")
    mapped_process_name = map_embedded_preset_name(source_process_name, target_printer_model)
    if mapped_process_name:
        mapped_ref = await resolve_preset_ref_by_name(db, user, "process", mapped_process_name)
        if mapped_ref is not None:
            try:
                target_process_json = await resolve_preset_ref(db, user, mapped_ref, "process")
            except Exception as exc:
                logger.warning(
                    "Could not resolve mapped process preset %r: %s",
                    mapped_process_name,
                    exc,
                )

    presets["process"] = merge_preset_json(target_process_json, overrides, slot="process")
    logger.info(
        "Applied %d project_settings process override(s) onto target process preset",
        len(overrides),
    )
    return presets, True
