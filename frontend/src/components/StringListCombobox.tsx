import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fuzzyMatchesHaystack } from '../utils/fuzzyMatch';
import { highlightFuzzyMatch } from '../utils/highlightMatch';

export interface StringListComboboxProps {
  label: string;
  options: string[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  swatchColor?: string;
  emptyLabel?: string;
  placeholder?: string;
}

export function StringListCombobox({
  label,
  options,
  value,
  onChange,
  disabled,
  swatchColor,
  emptyLabel,
  placeholder,
}: StringListComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const displayValue = open ? query : (value ?? '');
  const hasOptions = options.length > 0;
  const resolvedPlaceholder =
    placeholder ??
    (hasOptions ? t('slice.selectPreset') : (emptyLabel ?? t('slice.noPresetsForSlot')));

  const filteredOptions = useMemo(() => {
    const q = query.trim();
    if (!q) return options;
    return options.filter((name) => fuzzyMatchesHaystack(name.toLowerCase(), q));
  }, [options, query]);

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
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-bambu-gray">
                {t('slice.noPresetsMatch', 'No presets match')}
              </div>
            ) : (
              filteredOptions.map((name) => {
                const selected = value === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-label={name}
                    aria-selected={selected}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-bambu-dark-tertiary truncate ${
                      selected ? 'bg-bambu-green/10 text-bambu-green' : 'text-white'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(name);
                      close();
                    }}
                  >
                    {highlightFuzzyMatch(name, query)}
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <label className="block">
      <span className="block text-sm text-bambu-gray mb-1 inline-flex items-center gap-1.5">
        {swatchColor && (
          <span
            className="inline-block w-3 h-3 rounded-sm border border-black/20"
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
          disabled={disabled || !hasOptions}
          placeholder={resolvedPlaceholder}
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
