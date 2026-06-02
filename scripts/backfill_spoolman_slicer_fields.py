#!/usr/bin/env python3
"""Backfill Bambuddy Spoolman extra fields for slicer preset matching.

Bambuddy reads these from Spoolman ``extra`` (JSON-encoded strings):

  Spool + filament:
    - ``bambu_slicer_filament``      — preset / tray_info_idx (e.g. GFL05, PFUS…)
    - ``bambu_slicer_filament_name`` — display name (e.g. "Bambu PLA Basic")

  Spool only:
    - ``bambu_color_name``           — human-readable colour (not ``bambu_slicer_filament_color``)

AMS sync does not write slicer presets today; this script fills gaps from, in order:

  1. Existing Spoolman extra values (skipped unless ``--force``)
  2. Bambuddy ``spoolman_k_profile.setting_id`` when ``--bambuddy-db`` is set
  3. Bambuddy ``local_presets`` filament presets (setting_id in JSON)
  4. Variant-prefix match (e.g. ``PLA Basic …`` → ``GFA00``, ``PETG HF …`` → ``GFG02``)
  5. Generic material preset only for non–Bambu Lab vendors (GFL99, GFG99, …)
  6. For spools: inherit resolved values from the linked filament

Usage:
    python scripts/backfill_spoolman_slicer_fields.py --spoolman-url http://localhost:7912
    python scripts/backfill_spoolman_slicer_fields.py --spoolman-url http://localhost:7912 \\
        --bambuddy-db /path/to/bambuddy.db --dry-run
    python scripts/backfill_spoolman_slicer_fields.py --spoolman-url http://localhost:7912 --force
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Repo layout: scripts/ → bambuddy/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.app.api.routes._spoolman_helpers import _extract_extra_str
from backend.app.api.routes.cloud import _BUILTIN_FILAMENT_NAMES
from backend.app.models.local_preset import LocalPreset
from backend.app.models.spoolman_k_profile import SpoolmanKProfile
from backend.app.services.spoolman import (
    SPOOLMAN_FILAMENT_EXTRA_KEYS,
    SPOOLMAN_SPOOL_EXTRA_KEYS,
    SpoolmanClient,
    SpoolmanUnavailableError,
)
from backend.app.utils.filament_ids import GENERIC_FILAMENT_IDS, normalize_slicer_filament

logger = logging.getLogger(__name__)

_PRESET_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{2,31}$")

# Spoolman colour-specific names often append a colour after the product line; these are
# not separate Bambu preset IDs but should inherit the parent line's tray_info_idx.
_EXTRA_VARIANT_ALIASES: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    ("pla translucent", "GFA00", "Bambu PLA Basic", frozenset({"bambu lab"})),
)


@dataclass(frozen=True)
class _VariantEntry:
    variant_key: str
    preset_id: str
    display_name: str
    vendor_hints: frozenset[str]
    is_generic: bool


@dataclass
class PresetGuess:
    preset_id: str
    preset_name: str
    source: str


@dataclass
class ColorGuess:
    color_name: str
    source: str


def _encode_extra(value: str) -> str:
    return json.dumps(value)


def _has_extra_value(extra: dict | None, key: str) -> bool:
    return bool(_extract_extra_str(extra or {}, key))


def _normalize_hex(color_hex: str | None) -> str:
    if not color_hex:
        return ""
    return color_hex.strip().lstrip("#").upper()[:6]


def _builtin_name_for_id(preset_id: str) -> str:
    tray_idx, _setting = normalize_slicer_filament(preset_id)
    return _BUILTIN_FILAMENT_NAMES.get(tray_idx or preset_id, "")


def _variant_key_usable(key: str) -> bool:
    if " " in key or "-" in key or "+" in key:
        return True
    if len(key) >= 6:
        return True
    return key in {"abs", "asa", "pva", "hips", "petg", "pctg", "pc", "tpu", "pa", "pp"}


def _build_variant_index() -> list[_VariantEntry]:
    entries: list[_VariantEntry] = []
    for fid, bname in _BUILTIN_FILAMENT_NAMES.items():
        lower = bname.lower()
        vendors: set[str] = set()
        is_generic = False
        rest = lower
        if lower.startswith("bambu "):
            vendors.add("bambu lab")
            rest = lower[6:].strip()
        elif lower.startswith("generic "):
            is_generic = True
            rest = lower[8:].strip()
        elif lower.startswith("polylite "):
            vendors.update(["polymaker", "polylite"])
            rest = lower[9:].strip()
            rest = f"polylite {rest}" if rest else "polylite"
        elif lower.startswith("polyterra "):
            vendors.update(["polymaker", "polyterra"])
            rest = lower[10:].strip()
            rest = f"polyterra {rest}" if rest else "polyterra"
        elif lower.startswith("esun "):
            vendors.add("esun")
            rest = lower[5:].strip()
            rest = f"esun {rest}" if rest else "esun"
        elif lower.startswith("overture "):
            vendors.add("overture")
            rest = lower[9:].strip()
            rest = f"overture {rest}" if rest else "overture"
        elif lower.startswith("fiberon "):
            vendors.add("fiberon")
            rest = lower[8:].strip()
            rest = f"fiberon {rest}" if rest else "fiberon"
        else:
            rest = lower
        if not _variant_key_usable(rest):
            continue
        entries.append(_VariantEntry(rest, fid, bname, frozenset(vendors), is_generic))
    for variant_key, fid, display_name, vendors in _EXTRA_VARIANT_ALIASES:
        entries.append(_VariantEntry(variant_key, fid, display_name, vendors, False))
    entries.sort(key=lambda e: len(e.variant_key), reverse=True)
    return entries


_VARIANT_INDEX: list[_VariantEntry] = _build_variant_index()


def _vendor_normalized(vendor: str) -> str:
    v = vendor.strip().lower()
    if v in ("bambu lab", "bambu"):
        return "bambu lab"
    if v in ("polymaker", "polylite", "polyterra"):
        return "polymaker"
    return v


def _normalize_spoolman_name(material: str, name: str, vendor: str) -> str:
    """Lowercase search string from Spoolman filament fields (colour suffix kept)."""
    s = " ".join((name or "").split())
    mat = (material or "").strip().upper()
    if mat:
        double = f"{mat} {mat} "
        if s.upper().startswith(double):
            s = s[len(mat) + 1 :].strip()
    # Strip warehouse vendor only — product lines (PolyLite, eSUN, …) stay for variant matching.
    for prefix in ("bambu lab ", "polymaker "):
        if s.lower().startswith(prefix):
            s = s[len(prefix) :].strip()
            break
    return s.lower()


def _name_search_keys(material: str, name: str, vendor: str) -> list[str]:
    """Keys to try for variant-prefix matching (AMS-sync may store subtype-only names)."""
    base = _normalize_spoolman_name(material, name, vendor)
    if not base:
        return []
    keys = [base]
    mat = (material or "").strip().lower()
    if mat and not base.startswith(f"{mat} "):
        keys.append(f"{mat} {base}")
    return keys


def _match_variant_prefix(search_keys: list[str], vendor: str) -> PresetGuess | None:
    vendor_key = _vendor_normalized(vendor)
    generic_hit: _VariantEntry | None = None

    for key in search_keys:
        for entry in _VARIANT_INDEX:
            if not key.startswith(entry.variant_key):
                continue
            tail = key[len(entry.variant_key) :]
            if tail and not tail[0].isspace():
                continue
            if entry.is_generic:
                if generic_hit is None:
                    generic_hit = entry
                continue
            if entry.vendor_hints and vendor_key not in entry.vendor_hints:
                continue
            return PresetGuess(entry.preset_id, entry.display_name, "variant_prefix")

    if generic_hit and vendor_key != "bambu lab":
        return PresetGuess(generic_hit.preset_id, generic_hit.display_name, "generic_material")
    return None


def _match_exact_builtin(candidates: list[str]) -> PresetGuess | None:
    lowered = {c.lower() for c in candidates if c}
    for fid, bname in _BUILTIN_FILAMENT_NAMES.items():
        bl = bname.lower()
        if bl in lowered:
            return PresetGuess(fid, bname, "builtin_name")
        stripped = bl.replace("bambu ", "", 1)
        if stripped in lowered:
            return PresetGuess(fid, bname, "builtin_name")
    return None


def _match_filament_to_builtin(filament: dict) -> PresetGuess | None:
    """Guess a Bambu preset id from Spoolman filament vendor/material/name."""
    material = (filament.get("material") or "").strip().upper()
    name = (filament.get("name") or "").strip()
    vendor = ((filament.get("vendor") or {}).get("name") or "").strip()

    external_id = (filament.get("external_id") or "").strip()
    if external_id and _PRESET_ID_RE.match(external_id.split("_")[0]):
        base = external_id.split("_")[0]
        tray_idx, _ = normalize_slicer_filament(base)
        pid = tray_idx or base
        return PresetGuess(pid, _builtin_name_for_id(pid) or name or pid, "external_id")

    candidates: list[str] = []
    if name:
        candidates.append(name)
        if material:
            candidates.append(f"{material} {name}")
    if vendor and name:
        candidates.append(f"{vendor} {name}")
        if material:
            candidates.append(f"{vendor} {material} {name}")
    if vendor.lower() == "bambu lab" and name and material:
        candidates.append(f"Bambu {material} {name}")

    exact = _match_exact_builtin(candidates)
    if exact:
        return exact

    search_keys = _name_search_keys(material, name, vendor)
    variant = _match_variant_prefix(search_keys, vendor)
    if variant:
        return variant

    # Plain material-only fallback for third-party spools without a recognised product line.
    if material and _vendor_normalized(vendor) != "bambu lab":
        for key, fid in GENERIC_FILAMENT_IDS.items():
            if key.upper() == material or key.replace(" ", "").upper() == material.replace(" ", ""):
                bname = _BUILTIN_FILAMENT_NAMES.get(fid, f"Generic {material}")
                return PresetGuess(fid, bname, "generic_material")

    return None


def _color_suffix_from_variant_match(material: str, name: str, vendor: str, guess: PresetGuess) -> str | None:
    """Colour words after the matched product-line prefix (e.g. 'Mistletoe Green')."""
    for key in _name_search_keys(material, name, vendor):
        for entry in _VARIANT_INDEX:
            if entry.preset_id != guess.preset_id:
                continue
            if not key.startswith(entry.variant_key):
                continue
            tail = key[len(entry.variant_key) :].strip()
            if tail:
                return tail.title()
    return None


def _load_k_profiles(db_path: Path) -> dict[int, PresetGuess]:
    """spoolman_spool_id → preset from calibrated K rows (latest id wins per spool)."""
    engine = create_engine(f"sqlite:///{db_path}")
    out: dict[int, PresetGuess] = {}
    try:
        with Session(engine) as session:
            rows = session.execute(
                select(SpoolmanKProfile)
                .where(SpoolmanKProfile.setting_id.isnot(None))
                .where(SpoolmanKProfile.setting_id != "")
                .order_by(SpoolmanKProfile.spoolman_spool_id, SpoolmanKProfile.id)
            ).scalars()
            for row in rows:
                raw = (row.setting_id or "").strip()
                if not raw:
                    continue
                tray_idx, _ = normalize_slicer_filament(raw)
                pid = tray_idx or raw
                pname = _builtin_name_for_id(pid) or (row.name or "").strip() or pid
                out[row.spoolman_spool_id] = PresetGuess(pid, pname, "k_profile")
    except OperationalError as exc:
        logger.warning("Skipping K profiles (table missing or unreadable): %s", exc)
    return out


def _load_local_preset_map(db_path: Path) -> dict[str, PresetGuess]:
    """Map normalized tray_info_idx → preset from imported local filament presets."""
    engine = create_engine(f"sqlite:///{db_path}")
    by_tray: dict[str, PresetGuess] = {}
    try:
        with Session(engine) as session:
            presets = session.execute(
                select(LocalPreset).where(LocalPreset.preset_type == "filament")
            ).scalars()
            for preset in presets:
                try:
                    setting_data = json.loads(preset.setting) if isinstance(preset.setting, str) else preset.setting
                except (json.JSONDecodeError, TypeError):
                    continue
                if not isinstance(setting_data, dict):
                    continue
                sid = (setting_data.get("setting_id") or "").strip()
                if not sid:
                    continue
                tray_idx, _ = normalize_slicer_filament(sid)
                pid = tray_idx or sid
                pname = (preset.name or "").strip() or _builtin_name_for_id(pid) or pid
                by_tray[pid] = PresetGuess(pid, pname, "local_preset")
    except OperationalError as exc:
        logger.warning("Skipping local presets (table missing or unreadable): %s", exc)
    return by_tray


def _load_color_catalog(db_path: Path) -> dict[tuple[str, str, str], str]:
    """(hex6, material_upper, vendor_lower) → color_name; also (hex6, '', '') fallback."""
    engine = create_engine(f"sqlite:///{db_path}")
    catalog: dict[tuple[str, str, str], str] = {}
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT manufacturer, color_name, hex_color, material "
                    "FROM color_catalog ORDER BY is_default DESC, id ASC"
                )
            ).fetchall()
    except OperationalError as exc:
        logger.warning("Skipping color catalog (table missing or unreadable): %s", exc)
        return catalog
    for manufacturer, color_name, hex_color, material in rows:
        hex6 = _normalize_hex(hex_color)
        if not hex6 or not color_name:
            continue
        mat = (material or "").strip().upper()
        vend = (manufacturer or "").strip().lower()
        catalog[(hex6, mat, vend)] = str(color_name).strip()
        catalog.setdefault((hex6, mat, ""), str(color_name).strip())
        catalog.setdefault((hex6, "", ""), str(color_name).strip())
    return catalog


def _guess_color_name(
    filament: dict,
    catalog: dict[tuple[str, str, str], str] | None,
    *,
    preset_guess: PresetGuess | None = None,
) -> ColorGuess | None:
    hex6 = _normalize_hex(filament.get("color_hex"))
    material = (filament.get("material") or "").strip().upper()
    vendor = ((filament.get("vendor") or {}).get("name") or "").strip()
    if catalog and hex6:
        vendor_l = vendor.lower()
        for key in ((hex6, material, vendor_l), (hex6, material, ""), (hex6, "", "")):
            hit = catalog.get(key)
            if hit:
                return ColorGuess(hit, "color_catalog")
    if preset_guess:
        suffix = _color_suffix_from_variant_match(
            material,
            (filament.get("name") or "").strip(),
            vendor,
            preset_guess,
        )
        if suffix:
            return ColorGuess(suffix, "name_suffix")
    return None


async def _ensure_fields(client: SpoolmanClient, entity_type: str, keys: tuple[str, ...]) -> None:
    for key in keys:
        await client.ensure_extra_field(key, entity_type=entity_type)  # type: ignore[arg-type]


async def _merge_filament_extra(client: SpoolmanClient, filament_id: int, patch: dict[str, str]) -> dict:
    current = await client.get_filament(filament_id)
    merged = {**(current.get("extra") or {}), **patch}
    return await client.patch_filament(filament_id, {"extra": merged})


async def run_backfill(args: argparse.Namespace) -> int:
    client = SpoolmanClient(args.spoolman_url.rstrip("/"))
    only_missing = not args.force

    k_by_spool: dict[int, PresetGuess] = {}
    local_by_tray: dict[str, PresetGuess] = {}
    color_catalog: dict[tuple[str, str, str], str] | None = None
    if args.bambuddy_db:
        db_path = Path(args.bambuddy_db).expanduser().resolve()
        if not db_path.is_file():
            print(f"Bambuddy database not found: {db_path}", file=sys.stderr)
            return 1
        print(f"Loading Bambuddy data from {db_path} ...")
        k_by_spool = _load_k_profiles(db_path)
        local_by_tray = _load_local_preset_map(db_path)
        color_catalog = _load_color_catalog(db_path)
        print(f"  K profiles for {len(k_by_spool)} spool(s), {len(local_by_tray)} local preset(s)")

    await _ensure_fields(client, "filament", SPOOLMAN_FILAMENT_EXTRA_KEYS)
    await _ensure_fields(client, "spool", SPOOLMAN_SPOOL_EXTRA_KEYS)

    try:
        spools = await client.get_all_spools(allow_archived=args.include_archived)
        filaments = await client.get_filaments()
    except SpoolmanUnavailableError as exc:
        await client.close()
        print(f"Cannot reach Spoolman at {args.spoolman_url}: {exc}", file=sys.stderr)
        return 1
    filament_by_id = {int(f["id"]): f for f in filaments if f.get("id") is not None}

    # Filament-level preset guesses (shared by all spools on that filament)
    filament_preset: dict[int, PresetGuess] = {}
    for fid, filament in filament_by_id.items():
        extra = filament.get("extra") or {}
        if only_missing and _has_extra_value(extra, "bambu_slicer_filament"):
            continue
        guess = _match_filament_to_builtin(filament)
        if guess:
            filament_preset[fid] = guess

    stats = {
        "filament_slicer": 0,
        "spool_slicer": 0,
        "spool_color": 0,
        "skipped": 0,
        "errors": 0,
    }

    # --- Filaments ---
    if not args.spools_only:
        print(f"\nFilaments ({len(filament_by_id)} total) ...")
        for fid, filament in sorted(filament_by_id.items()):
            extra = filament.get("extra") or {}
            need_id = not (only_missing and _has_extra_value(extra, "bambu_slicer_filament"))
            need_name = not (only_missing and _has_extra_value(extra, "bambu_slicer_filament_name"))

            guess: PresetGuess | None = filament_preset.get(fid)
            if not guess and need_id:
                guess = _match_filament_to_builtin(filament)

            if not guess or (not need_id and not need_name):
                if not need_id and not need_name:
                    stats["skipped"] += 1
                continue

            patch: dict[str, str] = {}
            if need_id:
                patch["bambu_slicer_filament"] = _encode_extra(guess.preset_id)
            if need_name:
                patch["bambu_slicer_filament_name"] = _encode_extra(guess.preset_name)

            label = f"filament #{fid} {(filament.get('vendor') or {}).get('name', '?')} "
            label += f"{filament.get('material', '?')} {filament.get('name', '?')}"
            print(f"  [{guess.source}] {label}")
            print(f"    -> id={guess.preset_id!r} name={guess.preset_name!r}")

            if args.dry_run:
                stats["filament_slicer"] += 1
                continue
            try:
                await _merge_filament_extra(client, fid, patch)
                stats["filament_slicer"] += 1
            except Exception as exc:
                stats["errors"] += 1
                print(f"    ERROR: {exc}", file=sys.stderr)

    # Refresh filament extras after writes
    if not args.dry_run and stats["filament_slicer"]:
        filaments = await client.get_filaments()
        filament_by_id = {int(f["id"]): f for f in filaments if f.get("id") is not None}

    # --- Spools ---
    if not args.filaments_only:
        print(f"\nSpools ({len(spools)} total) ...")
        for spool in spools:
            spool_id = int(spool["id"])
            extra = spool.get("extra") or {}
            filament = spool.get("filament") or filament_by_id.get((spool.get("filament_id") or 0)) or {}
            filament_extra = filament.get("extra") or {}

            need_id = not (only_missing and _has_extra_value(extra, "bambu_slicer_filament"))
            need_name = not (only_missing and _has_extra_value(extra, "bambu_slicer_filament_name"))
            need_color = not (only_missing and _has_extra_value(extra, "bambu_color_name"))

            if not need_id and not need_name and not need_color:
                stats["skipped"] += 1
                continue

            guess: PresetGuess | None = None
            color_guess: ColorGuess | None = None

            if need_id or need_name:
                if spool_id in k_by_spool:
                    guess = k_by_spool[spool_id]
                elif _has_extra_value(filament_extra, "bambu_slicer_filament"):
                    fid = _extract_extra_str(filament_extra, "bambu_slicer_filament")
                    fname = _extract_extra_str(filament_extra, "bambu_slicer_filament_name") or _builtin_name_for_id(
                        fid
                    )
                    guess = PresetGuess(fid, fname or fid, "filament_extra")
                else:
                    fid_key = ""
                    if filament:
                        fg = _match_filament_to_builtin(filament)
                        if fg:
                            guess = PresetGuess(fg.preset_id, fg.preset_name, f"filament_{fg.source}")
                            fid_key = fg.preset_id
                    if not guess and fid_key and fid_key in local_by_tray:
                        guess = local_by_tray[fid_key]

            if need_color and filament:
                color_guess = _guess_color_name(filament, color_catalog, preset_guess=guess)

            patch: dict[str, str] = {}
            if need_id and guess:
                patch["bambu_slicer_filament"] = _encode_extra(guess.preset_id)
            if need_name and guess:
                patch["bambu_slicer_filament_name"] = _encode_extra(guess.preset_name)
            if need_color and color_guess:
                patch["bambu_color_name"] = _encode_extra(color_guess.color_name)

            if not patch:
                stats["skipped"] += 1
                continue

            vendor = ((filament.get("vendor") or {}).get("name")) if filament else "?"
            label = f"spool #{spool_id} {vendor} {filament.get('material', '?')} {filament.get('name', '?')}"
            parts = []
            if "bambu_slicer_filament" in patch:
                parts.append(f"id={guess.preset_id if guess else '?'}")
            if "bambu_slicer_filament_name" in patch and guess:
                parts.append(f"name={guess.preset_name!r}")
            if "bambu_color_name" in patch and color_guess:
                parts.append(f"color={color_guess.color_name!r}")
            src = guess.source if guess else (color_guess.source if color_guess else "?")
            print(f"  [{src}] {label}")
            print(f"    -> {', '.join(parts)}")

            if args.dry_run:
                if "bambu_slicer_filament" in patch or "bambu_slicer_filament_name" in patch:
                    stats["spool_slicer"] += 1
                if "bambu_color_name" in patch:
                    stats["spool_color"] += 1
                continue
            try:
                await client.merge_spool_extra(spool_id, patch)
                if "bambu_slicer_filament" in patch or "bambu_slicer_filament_name" in patch:
                    stats["spool_slicer"] += 1
                if "bambu_color_name" in patch:
                    stats["spool_color"] += 1
            except Exception as exc:
                stats["errors"] += 1
                print(f"    ERROR: {exc}", file=sys.stderr)

    await client.close()

    mode = "DRY RUN — no changes written" if args.dry_run else "Done"
    print(
        f"\n{mode}: "
        f"{stats['filament_slicer']} filament preset update(s), "
        f"{stats['spool_slicer']} spool preset update(s), "
        f"{stats['spool_color']} spool color name update(s), "
        f"{stats['skipped']} skipped, "
        f"{stats['errors']} error(s)"
    )
    return 1 if stats["errors"] else 0


def _run_self_test() -> int:
    """Quick checks for variant matching (no Spoolman network)."""
    cases: list[tuple[dict, str, str]] = [
        (
            {"material": "PLA", "name": "PLA Basic Mistletoe Green", "vendor": {"name": "Bambu Lab"}},
            "GFA00",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "PLA Matte Ice Blue", "vendor": {"name": "Bambu Lab"}},
            "GFA01",
            "variant_prefix",
        ),
        (
            {"material": "PETG", "name": "PETG HF Black", "vendor": {"name": "Bambu Lab"}},
            "GFG02",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "PLA Glow Glow Green", "vendor": {"name": "Bambu Lab"}},
            "GFA12",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "PLA Marble White Marble", "vendor": {"name": "Bambu Lab"}},
            "GFA07",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "PLA Wood White Oak", "vendor": {"name": "Bambu Lab"}},
            "GFA16",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "Basic Scarlet Red", "vendor": {"name": "Bambu Lab"}},
            "GFA00",
            "variant_prefix",
        ),
        (
            {
                "material": "PLA",
                "name": "PolyLite PLA Silk Magenta",
                "vendor": {"name": "Polymaker"},
            },
            "GFL00",
            "variant_prefix",
        ),
        (
            {"material": "PLA", "name": "Unknown Weird Filament", "vendor": {"name": "Bambu Lab"}},
            "",
            "",
        ),
    ]
    failed = 0
    for filament, want_id, want_source in cases:
        got = _match_filament_to_builtin(filament)
        got_id = got.preset_id if got else ""
        got_source = got.source if got else ""
        ok = got_id == want_id and (not want_source or got_source == want_source)
        label = filament.get("name", "?")
        if ok:
            print(f"  OK  {label} -> {got_id} ({got_source})")
        else:
            failed += 1
            print(f"  FAIL {label}: want {want_id!r} ({want_source}), got {got_id!r} ({got_source})")
    if failed:
        print(f"\n{failed} self-test(s) failed")
        return 1
    print(f"\nAll {len(cases)} self-tests passed")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill Spoolman bambu_slicer_* and bambu_color_name extra fields for Bambuddy matching.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--spoolman-url",
        help="Spoolman base URL (e.g. http://localhost:7912); not required with --self-test",
    )
    parser.add_argument(
        "--bambuddy-db",
        help="Path to bambuddy.db (enables K-profile and color-catalog lookups)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned updates without writing to Spoolman",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing extra values (default: only fill missing fields)",
    )
    parser.add_argument(
        "--include-archived",
        action="store_true",
        help="Include archived spools",
    )
    parser.add_argument(
        "--filaments-only",
        action="store_true",
        help="Update filament entities only",
    )
    parser.add_argument(
        "--spools-only",
        action="store_true",
        help="Update spool entities only",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run built-in matching self-tests and exit (no Spoolman connection)",
    )
    args = parser.parse_args()
    if args.filaments_only and args.spools_only:
        parser.error("Use at most one of --filaments-only and --spools-only")

    if args.self_test:
        sys.exit(_run_self_test())

    if not args.spoolman_url:
        parser.error("--spoolman-url is required unless using --self-test")

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.ERROR)

    if not args.bambuddy_db:
        default_db = Path(__file__).resolve().parent.parent / "bambuddy.db"
        if default_db.is_file():
            args.bambuddy_db = str(default_db)
            print(f"Using default Bambuddy database: {default_db}")

    exit_code = asyncio.run(run_backfill(args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
