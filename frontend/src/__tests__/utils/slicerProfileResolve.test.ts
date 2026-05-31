import { describe, it, expect } from 'vitest';
import {
  appendBblPrinterTag,
  hasBblPrinterTag,
  matchPresetByProfile,
  resolveProfileForPrinter,
  splitProfileCandidates,
  stripBblPrinterTag,
} from '../../utils/slicerProfileResolve';

// Mirror of backend PRINTER_MODEL_MAP (fetched from /slicer/printer-models).
const PRINTER_MODELS: Record<string, string> = {
  'Bambu Lab X1 Carbon': 'X1C',
  'Bambu Lab P1S': 'P1S',
  'Bambu Lab A1': 'A1',
  'Bambu Lab A1 Mini': 'A1 Mini',
  'Bambu Lab A1 mini': 'A1 Mini',
};

describe('splitProfileCandidates', () => {
  it('returns a single candidate', () => {
    expect(splitProfileCandidates('Bambu PLA Basic @BBL')).toEqual(['Bambu PLA Basic @BBL']);
  });

  it('splits comma-separated candidates', () => {
    expect(splitProfileCandidates('Bambu PLA Basic @BBL, Generic PLA @BBL')).toEqual([
      'Bambu PLA Basic @BBL',
      'Generic PLA @BBL',
    ]);
  });

  it('drops blanks and handles nullish', () => {
    expect(splitProfileCandidates('')).toEqual([]);
    expect(splitProfileCandidates(null)).toEqual([]);
    expect(splitProfileCandidates(' , ,')).toEqual([]);
  });
});

describe('hasBblPrinterTag', () => {
  it('is false for a printer-agnostic base', () => {
    expect(hasBblPrinterTag('Bambu PLA Basic @BBL')).toBe(false);
  });
  it('is true when a model token follows @BBL', () => {
    expect(hasBblPrinterTag('Bambu PLA Basic @BBL X1C')).toBe(true);
  });
  it('is false without the marker', () => {
    expect(hasBblPrinterTag('Bambu PLA Basic')).toBe(false);
  });
});

describe('stripBblPrinterTag', () => {
  it('removes the model token but keeps @BBL', () => {
    expect(stripBblPrinterTag('Bambu PLA Basic @BBL X1C')).toBe('Bambu PLA Basic @BBL');
  });
  it('removes a trailing nozzle segment too', () => {
    expect(stripBblPrinterTag('0.20mm Standard @BBL X1C 0.6 nozzle')).toBe('0.20mm Standard @BBL');
  });
  it('handles a multi-word token', () => {
    expect(stripBblPrinterTag('Bambu PLA Basic @BBL A1 Mini')).toBe('Bambu PLA Basic @BBL');
  });
  it('leaves an already-base name unchanged', () => {
    expect(stripBblPrinterTag('Bambu PLA Basic @BBL')).toBe('Bambu PLA Basic @BBL');
  });
  it('leaves a name without the marker unchanged', () => {
    expect(stripBblPrinterTag('Generic PLA')).toBe('Generic PLA');
  });
});

describe('appendBblPrinterTag', () => {
  it('appends the A1 mini token to a base (headline case)', () => {
    expect(appendBblPrinterTag('Bambu PLA Basic @BBL', 'Bambu Lab A1 mini', PRINTER_MODELS)).toBe(
      'Bambu PLA Basic @BBL A1 Mini',
    );
  });
  it('appends from a full printer-preset name with nozzle suffix', () => {
    expect(
      appendBblPrinterTag('0.20mm Standard @BBL', 'Bambu Lab A1 mini 0.4 nozzle', PRINTER_MODELS),
    ).toBe('0.20mm Standard @BBL A1 Mini');
  });
  it('adds the marker to a plain name', () => {
    expect(appendBblPrinterTag('Bambu PLA Basic', 'Bambu Lab P1S', PRINTER_MODELS)).toBe(
      'Bambu PLA Basic @BBL P1S',
    );
  });
  it('leaves an already-qualified name unchanged', () => {
    expect(appendBblPrinterTag('Bambu PLA Basic @BBL X1C', 'Bambu Lab P1S', PRINTER_MODELS)).toBe(
      'Bambu PLA Basic @BBL X1C',
    );
  });
  it('leaves a bare setting id unchanged', () => {
    expect(appendBblPrinterTag('GFSL05', 'Bambu Lab P1S', PRINTER_MODELS)).toBe('GFSL05');
  });
  it('returns the base when the printer is unknown', () => {
    expect(appendBblPrinterTag('Bambu PLA Basic @BBL', null, PRINTER_MODELS)).toBe('Bambu PLA Basic @BBL');
  });
  it('falls back to stripping the brand prefix without a model map', () => {
    expect(appendBblPrinterTag('Bambu PLA Basic @BBL', 'Bambu Lab P1S')).toBe('Bambu PLA Basic @BBL P1S');
  });
});

describe('resolveProfileForPrinter', () => {
  it('resolves each comma-separated candidate', () => {
    expect(resolveProfileForPrinter('Bambu PLA Basic @BBL, Generic PLA @BBL', 'Bambu Lab P1S', PRINTER_MODELS)).toEqual([
      'Bambu PLA Basic @BBL P1S',
      'Generic PLA @BBL P1S',
    ]);
  });
  it('keeps a bare id intact among candidates', () => {
    expect(resolveProfileForPrinter('Bambu PLA Basic @BBL, GFSL05', 'Bambu Lab A1 mini', PRINTER_MODELS)).toEqual([
      'Bambu PLA Basic @BBL A1 Mini',
      'GFSL05',
    ]);
  });
});

describe('matchPresetByProfile', () => {
  const presets = [
    { source: 'cloud', id: 'GFSL05', name: 'Bambu PLA Basic @BBL P1S' },
    { source: 'cloud', id: 'GFSL06', name: 'Bambu PLA Basic @BBL A1 Mini' },
    { source: 'standard', id: 'Generic PLA @BBL P1S', name: 'Generic PLA @BBL P1S' },
  ];

  it('matches a stored base to the printer-specific preset', () => {
    // Stored "Bambu PLA Basic @BBL"; on a P1S it resolves and lines up with
    // the @BBL P1S preset.
    const match = matchPresetByProfile(presets, 'Bambu PLA Basic @BBL', 'Bambu Lab P1S', PRINTER_MODELS);
    expect(match?.id).toBe('GFSL05');
  });

  it('matches the A1 Mini preset when that printer is selected', () => {
    const match = matchPresetByProfile(presets, 'Bambu PLA Basic @BBL', 'Bambu Lab A1 mini', PRINTER_MODELS);
    expect(match?.id).toBe('GFSL06');
  });

  it('matches a bare setting id against the preset id', () => {
    const match = matchPresetByProfile(presets, 'GFSL05', 'Bambu Lab P1S', PRINTER_MODELS);
    expect(match?.id).toBe('GFSL05');
  });

  it('matches a fully-qualified stored name directly', () => {
    const match = matchPresetByProfile(presets, 'Generic PLA @BBL P1S', 'Bambu Lab P1S', PRINTER_MODELS);
    expect(match?.id).toBe('Generic PLA @BBL P1S');
  });

  it('returns null when nothing matches', () => {
    expect(matchPresetByProfile(presets, 'Polymaker PETG @BBL', 'Bambu Lab P1S', PRINTER_MODELS)).toBeNull();
    expect(matchPresetByProfile(presets, '', 'Bambu Lab P1S', PRINTER_MODELS)).toBeNull();
  });
});
