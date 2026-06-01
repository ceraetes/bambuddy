import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  InventorySpool,
  PresetRef,
  UnifiedPreset,
  UnifiedPresetsBySlot,
  UnifiedPresetsResponse,
} from '../api/client';
import { fuzzyMatchesHaystack } from '../utils/fuzzyMatch';
import { highlightFuzzyMatch } from '../utils/highlightMatch';
import {
  EMPTY_COMPATIBILITY_INDEX,
  sortPresetsByPrinterTier,
  type PrinterCompatibilityIndex,
} from '../utils/slicerPrinterMatch';

const SLICE_MODAL_TIER_ORDER = ['local', 'cloud', 'standard'] as const;

export type PresetComboboxSlot = 'printer' | 'process' | 'filament';

export interface PresetComboboxProps {
  label: string;
  slot: PresetComboboxSlot;
  data: UnifiedPresetsResponse;
  value: PresetRef | null;
  onChange: (ref: PresetRef | null) => void;
  disabled?: boolean;
  swatchColor?: string;
  selectedPrinterName?: string | null;
  compatIndex?: PrinterCompatibilityIndex;
  slotSpool?: InventorySpool | null;
}

function findPresetInData(
  data: UnifiedPresetsResponse,
  slot: PresetComboboxSlot,
  value: PresetRef | null,
): UnifiedPreset | null {
  if (!value) return null;
  for (const tier of SLICE_MODAL_TIER_ORDER) {
    const found = (data[tier] as UnifiedPresetsBySlot)[slot].find(
      (p) => p.source === value.source && p.id === value.id,
    );
    if (found) return found;
  }
  return null;
}

function presetSearchHaystack(p: UnifiedPreset, slotSpool?: InventorySpool | null): string {
  const parts = [p.name, p.filament_type ?? '', p.filament_colour ?? ''];
  if (slotSpool) {
    parts.push(
      slotSpool.slicer_filament_name ?? '',
      slotSpool.slicer_filament ?? '',
      slotSpool.color_name ?? '',
      slotSpool.material ?? '',
    );
  }
  return parts.join(' ').toLowerCase();
}

function matchesQuery(p: UnifiedPreset, query: string, slotSpool?: InventorySpool | null): boolean {
  return fuzzyMatchesHaystack(presetSearchHaystack(p, slotSpool), query);
}

export function PresetCombobox({
  label,
  slot,
  data,
  value,
  onChange,
  disabled,
  swatchColor,
  selectedPrinterName,
  compatIndex = EMPTY_COMPATIBILITY_INDEX,
  slotSpool,
}: PresetComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedPreset = useMemo(
    () => findPresetInData(data, slot, value),
    [data, slot, value],
  );

  const hasAnyPresets = totalEntriesAcrossTiers(data, slot) > 0;
  const placeholder = hasAnyPresets ? t('slice.selectPreset') : t('slice.noPresetsForSlot');
  const displayValue = open ? query : (selectedPreset?.name ?? '');

  const sections = useMemo(() => {
    const tiers: { key: keyof UnifiedPresetsResponse; labelKey: string; fallback: string }[] = [
      { key: 'local', labelKey: 'slice.tier.local', fallback: 'Imported' },
      { key: 'cloud', labelKey: 'slice.tier.cloud', fallback: 'Cloud' },
      { key: 'standard', labelKey: 'slice.tier.standard', fallback: 'Standard' },
    ];
    const q = query.trim().toLowerCase();
    const out: { tierLabel: string; entries: UnifiedPreset[] }[] = [];
    for (const { key, labelKey, fallback } of tiers) {
      let entries = (data[key] as UnifiedPresetsBySlot)[slot];
      if (q) {
        entries = entries.filter((p: UnifiedPreset) => matchesQuery(p, q, slotSpool));
      }
      if (slot !== 'printer') {
        entries = sortPresetsByPrinterTier(
          entries,
          slot,
          selectedPrinterName ?? null,
          compatIndex,
        );
      }
      if (entries.length > 0) {
        out.push({ tierLabel: t(labelKey, fallback), entries });
      }
    }
    return out;
  }, [data, query, slot, selectedPrinterName, compatIndex, slotSpool, t]);

  const totalEntries = sections.reduce((sum, s) => sum + s.entries.length, 0);

  const updatePanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPanelRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelRect(null);
      return;
    }
    updatePanelPosition();
    const onScrollOrResize = () => updatePanelPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const handleSelect = (p: UnifiedPreset) => {
    onChange({ source: p.source, id: p.id });
    close();
  };

  const listPanel =
    open && panelRect
      ? createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: panelRect.top,
              left: panelRect.left,
              width: panelRect.width,
              zIndex: 10000,
            }}
            className="bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded-md shadow-lg max-h-64 overflow-y-auto"
          >
            {totalEntries === 0 ? (
              <div className="px-3 py-2 text-sm text-bambu-gray">
                {t('slice.noPresetsMatch', 'No presets match')}
              </div>
            ) : (
              sections.map((section) => (
                <div key={section.tierLabel}>
                  <div className="px-3 py-1.5 text-xs font-medium text-bambu-gray bg-bambu-dark-tertiary/40 sticky top-0">
                    {section.tierLabel}
                  </div>
                  {section.entries.map((p) => {
                    const selected = value?.source === p.source && value?.id === p.id;
                    return (
                      <button
                        key={`${p.source}:${p.id}`}
                        type="button"
                        role="option"
                        aria-label={p.name}
                        aria-selected={selected}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-bambu-dark-tertiary truncate ${
                          selected ? 'bg-bambu-green/10 text-bambu-green' : 'text-white'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelect(p)}
                      >
                        {highlightFuzzyMatch(p.name, query)}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <label className="block">
      <span className="flex items-center gap-2 text-xs text-bambu-gray mb-1">
        {swatchColor && (
          <span
            className="inline-block w-3 h-3 rounded-full border border-bambu-dark-tertiary"
            style={{ backgroundColor: swatchColor || 'transparent' }}
            aria-hidden
          />
        )}
        <span>{label}</span>
      </span>
      <div className="relative" ref={anchorRef}>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled || !hasAnyPresets}
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (!open) setQuery('');
          }}
          className="w-full px-3 py-2 pr-9 rounded-md bg-bambu-dark border border-bambu-dark-tertiary text-white text-sm placeholder:text-bambu-gray/50 focus:outline-none focus:border-bambu-gray disabled:opacity-50"
        />
        <ChevronDown
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bambu-gray pointer-events-none"
          aria-hidden
        />
        {listPanel}
      </div>
    </label>
  );
}

function totalEntriesAcrossTiers(data: UnifiedPresetsResponse, slot: PresetComboboxSlot): number {
  return SLICE_MODAL_TIER_ORDER.reduce(
    (sum, tier) => sum + (data[tier] as UnifiedPresetsBySlot)[slot].length,
    0,
  );
}
