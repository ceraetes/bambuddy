"""@BBL printer-token strip/append for Spoolman-stored slicer profile names.

Spoolman keeps the ``@BBL`` marker but omits the printer-model token; append it
back when the active printer is known. Kept in sync with
``frontend/src/utils/slicerProfileResolve.ts`` (shared test vectors).
"""

from __future__ import annotations

import re

from backend.app.utils.printer_models import normalize_printer_model

_BBL_MARKER = "@BBL"
_NOZZLE_SUFFIX_RE = re.compile(r"\s+\d+(?:\.\d+)?\s*nozzle\s*$", re.IGNORECASE)
_SETTING_ID_RE = re.compile(r"^[A-Za-z0-9]+$")
# PRINTER_MODEL_MAP uses "A1 Mini"; Bambu cloud process presets use @BBL A1M.
_BBL_PRESET_TAG_OVERRIDES: dict[str, str] = {"A1 Mini": "A1M"}


def split_profile_candidates(raw: str | None) -> list[str]:
    """Split a stored profile value into comma-separated candidates, trimmed."""
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _bbl_marker_index(name: str) -> int:
    """Index of the ``@BBL`` marker (case-insensitive), or -1 when absent."""
    return name.upper().find(_BBL_MARKER)


def _looks_like_setting_id(name: str) -> bool:
    """True for bare ids like ``GFSL05`` / ``PFUSabc`` (no spaces, no @)."""
    return bool(_SETTING_ID_RE.match(name)) and _bbl_marker_index(name) < 0


def has_bbl_printer_tag(name: str) -> bool:
    """True when ``@BBL`` is followed by a printer model token (not a bare base)."""
    if not name:
        return False
    idx = _bbl_marker_index(name)
    if idx < 0:
        return False
    rest = name[idx + len(_BBL_MARKER) :].strip()
    return bool(rest)


def strip_bbl_printer_tag(name: str) -> str:
    """Remove the printer-model token after ``@BBL``; keep the marker on the base."""
    if not name:
        return ""
    idx = _bbl_marker_index(name)
    if idx < 0:
        return name.strip()
    head = name[: idx + len(_BBL_MARKER)].rstrip()
    return head


def append_bbl_printer_tag(base_name: str, printer_model: str | None) -> str:
    """Append the active printer's model token after ``@BBL`` on a base name.

    Bare setting ids (``GFSL05``) and names that already carry a printer token
    are returned unchanged. When ``printer_model`` cannot be resolved, returns
    ``base_name`` unchanged.
    """
    if not base_name:
        return base_name
    if _looks_like_setting_id(base_name):
        return base_name
    if has_bbl_printer_tag(base_name):
        return base_name

    token = _canonical_token(printer_model)
    if not token:
        return base_name

    idx = _bbl_marker_index(base_name)
    if idx < 0:
        return f"{base_name.rstrip()} {_BBL_MARKER} {token}"
    head = base_name[: idx + len(_BBL_MARKER)].rstrip()
    return f"{head} {token}"


def resolve_profile_for_printer(raw: str | None, printer_model: str | None) -> list[str]:
    """Apply ``append_bbl_printer_tag`` to each comma-separated candidate, in order."""
    return [append_bbl_printer_tag(candidate, printer_model) for candidate in split_profile_candidates(raw)]


def _bbl_preset_tag(token: str) -> str:
    return _BBL_PRESET_TAG_OVERRIDES.get(token, token)


def _canonical_token(printer_model: str | None) -> str | None:
    """Normalise a printer model or preset name to a canonical ``@BBL`` short token."""
    if not printer_model:
        return None
    cleaned = printer_model.strip()
    if cleaned.startswith("# "):
        cleaned = cleaned[2:].strip()
    cleaned = _NOZZLE_SUFFIX_RE.sub("", cleaned).strip()
    if not cleaned:
        return None
    model = normalize_printer_model(cleaned)
    return _bbl_preset_tag(model) if model else None
