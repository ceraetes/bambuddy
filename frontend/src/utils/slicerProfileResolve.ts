// Printer-aware @BBL profile resolution for Spoolman-stored slicer presets.
// Spoolman keeps the @BBL marker but omits the printer-model token; append it
// back when the active printer is known. Mirror of
// backend/app/utils/slicer_profile_resolve.py (shared test vectors).

const BBL_MARKER = '@BBL';
const NOZZLE_SUFFIX_RE = /\s+\d+(?:\.\d+)?\s*nozzle\s*$/i;
const SETTING_ID_RE = /^[A-Za-z0-9]+$/;

// PRINTER_MODEL_MAP uses display names (e.g. "A1 Mini"); Bambu cloud process
// presets suffix @BBL with compact tokens (e.g. "A1M").
const BBL_PRESET_TAG_OVERRIDES: Record<string, string> = {
  'A1 Mini': 'A1M',
};

function bblPresetTag(token: string): string {
  return BBL_PRESET_TAG_OVERRIDES[token] ?? token;
}

/** Alternate @BBL suffixes for the same printer (cloud A1M vs bundled A1 Mini). */
const BBL_PRESET_TAG_ALTERNATES: Record<string, string> = {
  A1M: 'A1 Mini',
  'A1 Mini': 'A1M',
};

function bblTagAfterMarker(name: string): string | null {
  const idx = bblMarkerIndex(name);
  if (idx < 0) return null;
  const tag = name.slice(idx + BBL_MARKER.length).trim();
  return tag || null;
}

function swapBblTag(name: string, newTag: string): string {
  const idx = bblMarkerIndex(name);
  if (idx < 0) return name;
  return `${name.slice(0, idx + BBL_MARKER.length).trimEnd()} ${newTag}`;
}

/** Primary resolved names plus equivalent @BBL suffix variants, in order. */
function expandBblTagCandidates(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      out.push(candidate);
      seen.add(candidate);
    }
    const tag = bblTagAfterMarker(candidate);
    const alt = tag ? BBL_PRESET_TAG_ALTERNATES[tag] : null;
    if (!alt) continue;
    const variant = swapBblTag(candidate, alt);
    if (!seen.has(variant)) {
      out.push(variant);
      seen.add(variant);
    }
  }
  return out;
}

export type PrinterModelMap = Record<string, string>;

function bblMarkerIndex(name: string): number {
  return name.toUpperCase().indexOf(BBL_MARKER);
}

function looksLikeSettingId(name: string): boolean {
  return SETTING_ID_RE.test(name) && bblMarkerIndex(name) < 0;
}

/** Split a stored profile value into its comma-separated candidates. */
export function splitProfileCandidates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** True when `name` carries `@BBL` followed by a model token. */
export function hasBblPrinterTag(name: string): boolean {
  if (!name) return false;
  const idx = bblMarkerIndex(name);
  if (idx < 0) return false;
  return name.slice(idx + BBL_MARKER.length).trim().length > 0;
}

/** Reduce a fully-qualified preset name to its printer-agnostic base. */
export function stripBblPrinterTag(name: string): string {
  if (!name) return '';
  const idx = bblMarkerIndex(name);
  if (idx < 0) return name.trim();
  return name.slice(0, idx + BBL_MARKER.length).trimEnd();
}

/** Normalise a model / printer-preset string to its `@BBL` short token. */
function canonicalToken(printerModel: string | null | undefined, models?: PrinterModelMap): string | null {
  if (!printerModel) return null;
  let cleaned = printerModel.trim();
  if (cleaned.startsWith('# ')) cleaned = cleaned.slice(2).trim();
  cleaned = cleaned.replace(NOZZLE_SUFFIX_RE, '').trim();
  if (!cleaned) return null;
  if (models && cleaned in models) return bblPresetTag(models[cleaned]);
  const stripped = cleaned.replace(/^Bambu Lab\s+/i, '').trim();
  return stripped ? bblPresetTag(stripped) : null;
}

/** Append the active printer's `@BBL` token to a printer-agnostic base. */
export function appendBblPrinterTag(
  baseName: string,
  printerModel: string | null | undefined,
  models?: PrinterModelMap,
): string {
  if (!baseName) return baseName;
  if (looksLikeSettingId(baseName)) return baseName;
  if (hasBblPrinterTag(baseName)) return baseName;

  const token = canonicalToken(printerModel, models);
  if (!token) return baseName;

  const idx = bblMarkerIndex(baseName);
  if (idx < 0) return `${baseName.trimEnd()} ${BBL_MARKER} ${token}`;
  const head = baseName.slice(0, idx + BBL_MARKER.length).trimEnd();
  return `${head} ${token}`;
}

/** Resolve a stored profile value into printer-qualified candidates, in order. */
export function resolveProfileForPrinter(
  raw: string | null | undefined,
  printerModel: string | null | undefined,
  models?: PrinterModelMap,
): string[] {
  return splitProfileCandidates(raw).map((candidate) => appendBblPrinterTag(candidate, printerModel, models));
}

function normalizeForMatch(name: string): string {
  return name
    .replace(/^#\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Find a unified preset for a spool's stored profile on the active printer.
 * Tries each resolved candidate by id / full name first, then by printer-agnostic base.
 */
export function matchPresetByProfile<T extends { id: string; name: string }>(
  presets: readonly T[],
  storedProfile: string | null | undefined,
  printerModel: string | null | undefined,
  models?: PrinterModelMap,
): T | null {
  const candidates = expandBblTagCandidates(
    resolveProfileForPrinter(storedProfile, printerModel, models),
  );
  if (candidates.length === 0) return null;

  // Prefer the printer-qualified name (or setting id) over a looser base match.
  for (const candidate of candidates) {
    const fullKey = normalizeForMatch(candidate);
    const isSettingId = looksLikeSettingId(candidate);
    for (const preset of presets) {
      if (isSettingId && preset.id.toLowerCase() === candidate.toLowerCase()) return preset;
      if (normalizeForMatch(preset.name) === fullKey) return preset;
    }
  }

  for (const candidate of candidates) {
    const baseKey = normalizeForMatch(stripBblPrinterTag(candidate));
    for (const preset of presets) {
      if (normalizeForMatch(stripBblPrinterTag(preset.name)) === baseKey) return preset;
    }
  }
  return null;
}

