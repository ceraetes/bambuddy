/**
 * Tests for SliceModal.
 *
 * The modal handles preset selection across three tiers (cloud / local /
 * standard) + enqueueing a slice job. After enqueue success it hands the
 * job_id off to SliceJobTrackerProvider (which lives at app level) and
 * calls onClose. Polling, toasts, and query invalidation all happen in
 * the tracker — not here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils';
import { SliceModal } from '../../components/SliceModal';
import { SliceJobTrackerProvider } from '../../contexts/SliceJobTrackerContext';
import { api, type UnifiedPresetsResponse } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    getSlicerPresets: vi.fn(),
    sliceLibraryFile: vi.fn(),
    sliceArchive: vi.fn(),
    getSliceJob: vi.fn(),
    getLibraryFilePlates: vi.fn(),
    getArchivePlates: vi.fn(),
    getLibraryFileFilamentRequirements: vi.fn(),
    getArchiveFilamentRequirements: vi.fn(),
    listSlicerBundles: vi.fn(),
    getSlicerPrinterModels: vi.fn().mockResolvedValue({
      'Bambu Lab X1 Carbon': 'X1C',
      'Bambu Lab P1S': 'P1S',
      'Bambu Lab A1 mini': 'A1 Mini',
    }),
    getSpoolmanSettings: vi.fn().mockResolvedValue({ spoolman_enabled: 'false', spoolman_url: '' }),
    getSpools: vi.fn().mockResolvedValue([]),
    getSpoolmanInventorySpools: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
  },
}));

const mockApi = api as unknown as {
  getSlicerPresets: ReturnType<typeof vi.fn>;
  sliceLibraryFile: ReturnType<typeof vi.fn>;
  sliceArchive: ReturnType<typeof vi.fn>;
  getSliceJob: ReturnType<typeof vi.fn>;
  getLibraryFilePlates: ReturnType<typeof vi.fn>;
  getArchivePlates: ReturnType<typeof vi.fn>;
  getLibraryFileFilamentRequirements: ReturnType<typeof vi.fn>;
  getArchiveFilamentRequirements: ReturnType<typeof vi.fn>;
  listSlicerBundles: ReturnType<typeof vi.fn>;
  getSlicerPrinterModels: ReturnType<typeof vi.fn>;
  getSpoolmanSettings: ReturnType<typeof vi.fn>;
  getSpools: ReturnType<typeof vi.fn>;
  getSpoolmanInventorySpools: ReturnType<typeof vi.fn>;
};

function nativeSelects(): HTMLSelectElement[] {
  return screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT') as HTMLSelectElement[];
}

function presetComboInputs(): HTMLInputElement[] {
  return screen.getAllByRole('combobox').filter((el) => el.tagName === 'INPUT') as HTMLInputElement[];
}

async function selectPresetByName(
  user: ReturnType<typeof userEvent.setup>,
  comboIndex: number,
  name: string | RegExp,
) {
  const input = presetComboInputs()[comboIndex];
  await user.click(input);
  await user.click(screen.getByRole('option', { name }));
}

/** fullThreeTier auto-pick lands on local (Imported) entries in the comboboxes. */
async function waitForDefaultPresets() {
  await waitFor(() => {
    expect(screen.getByDisplayValue('Imported X1C 0.4')).toBeDefined();
  });
}

async function waitForPresetDisplay(value: string) {
  await waitFor(() => {
    expect(screen.getByDisplayValue(value)).toBeDefined();
  });
}

function makeUnified(overrides: Partial<UnifiedPresetsResponse> = {}): UnifiedPresetsResponse {
  return {
    orca_cloud: { printer: [], process: [], filament: [] },
    cloud: { printer: [], process: [], filament: [] },
    local: { printer: [], process: [], filament: [] },
    standard: { printer: [], process: [], filament: [] },
    cloud_status: 'ok',
    orca_cloud_status: 'ok',
    ...overrides,
  };
}

const fullThreeTier: UnifiedPresetsResponse = makeUnified({
  cloud: {
    printer: [{ id: 'PFUcloud-printer', name: 'My Custom X1C', source: 'cloud' }],
    process: [{ id: 'PFUcloud-process', name: 'My 0.16mm Tweaked', source: 'cloud' }],
    filament: [{ id: 'PFUcloud-filament', name: 'My PLA Black', source: 'cloud' }],
  },
  local: {
    printer: [{ id: '1', name: 'Imported X1C 0.4', source: 'local' }],
    process: [{ id: '2', name: 'Imported 0.20mm', source: 'local' }],
    filament: [{ id: '3', name: 'Imported PLA Basic', source: 'local' }],
  },
  standard: {
    printer: [{ id: 'Bambu Lab X1 Carbon 0.4 nozzle', name: 'Bambu Lab X1 Carbon 0.4 nozzle', source: 'standard' }],
    process: [{ id: '0.20mm Standard', name: '0.20mm Standard', source: 'standard' }],
    filament: [{ id: 'Bambu PLA Basic', name: 'Bambu PLA Basic', source: 'standard' }],
  },
});

function renderWithTracker(props: Parameters<typeof SliceModal>[0]) {
  return render(
    <SliceJobTrackerProvider>
      <SliceModal {...props} />
    </SliceJobTrackerProvider>,
  );
}

describe('SliceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getSlicerPresets.mockResolvedValue(fullThreeTier);
    mockApi.getSliceJob.mockResolvedValue({
      job_id: 42,
      status: 'running',
      kind: 'library_file',
      source_id: 100,
      source_name: 'Cube.stl',
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
    });
    // Default: single-plate (or non-3MF). Multi-plate tests override this.
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Cube.stl',
      plates: [],
      is_multi_plate: false,
    });
    mockApi.getArchivePlates.mockResolvedValue({
      archive_id: 100,
      filename: 'Cube.3mf',
      plates: [],
      is_multi_plate: false,
    });
    // Default: no per-plate filament metadata available (mirrors STL or
    // unsliced source). Multi-color tests override this.
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Cube.stl',
      plate_id: 1,
      filaments: [],
    });
    mockApi.getArchiveFilamentRequirements.mockResolvedValue({
      archive_id: 100,
      filename: 'Cube.3mf',
      plate_id: 1,
      filaments: [],
    });
    // Default: no bundles imported. Bundle-tier tests override this with a
    // populated array; everything else inherits the empty default so the
    // modal renders the original (preset-only) layout.
    mockApi.listSlicerBundles.mockResolvedValue([]);
  });

  it('auto-selects the highest-priority tier per slot on first load', async () => {
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    // SliceModal-specific tier priority: imported (local) wins over cloud
    // and standard so the user's curated picks come first.
    await waitForDefaultPresets();
    // 3 preset comboboxes (printer, process, filament) + 1 bed-type select.
    await waitFor(() => {
      const combos = presetComboInputs();
      expect(combos).toHaveLength(3);
      expect(combos[0].value).toBe('Imported X1C 0.4');
      expect(combos[1].value).toBe('Imported 0.20mm');
      expect(combos[2].value).toBe('Imported PLA Basic');
      expect(nativeSelects()).toHaveLength(1);
      expect(nativeSelects()[0].value).toBe('');
    });

    // Slice button is enabled because all three slots auto-defaulted and
    // the preview-slice query has resolved (mock returns immediately).
    const sliceBtn = screen.getByRole('button', { name: /^Slice$/ });
    expect((sliceBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders Imported / Cloud / Standard tier headers in the preset list', async () => {
    const user = userEvent.setup();
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForDefaultPresets();

    await user.click(presetComboInputs()[0]);
    expect(screen.getByText('Imported')).toBeDefined();
    expect(screen.getByText('Bambu Cloud')).toBeDefined();
    expect(screen.getByText('Standard')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Imported X1C 0.4' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'My Custom X1C' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Bambu Lab X1 Carbon 0.4 nozzle' })).toBeDefined();
  });

  it('falls back to local when cloud is empty (auto-pick respects priority)', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        local: fullThreeTier.local,
        standard: fullThreeTier.standard,
      }),
    );
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForDefaultPresets();
    expect(presetComboInputs()[0].value).toBe('Imported X1C 0.4');
  });

  it('falls back to standard when both cloud and local are empty', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({ standard: fullThreeTier.standard }),
    );
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('Bambu Lab X1 Carbon 0.4 nozzle');
    expect(presetComboInputs()[0].value).toBe('Bambu Lab X1 Carbon 0.4 nozzle');
  });

  it('sends source-aware refs (not legacy bare ints) on submit', async () => {
    const onClose = vi.fn();
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      // SliceModal-specific tier priority puts imported (local) above cloud,
      // so the auto-pick lands on the local entries even when a cloud entry
      // with the same slot is also available in the listing.
      expect(mockApi.sliceLibraryFile).toHaveBeenCalledWith(100, {
        printer_preset: { source: 'local', id: '1' },
        process_preset: { source: 'local', id: '2' },
        filament_preset: { source: 'local', id: '3' },
        filament_presets: [{ source: 'local', id: '3' }],
      });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('includes bed_type in the request when the user picks a non-auto plate (#1337)', async () => {
    const onClose = vi.fn();
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    const bedSelect = nativeSelects()[0];
    expect(bedSelect.options[0]?.textContent?.toLowerCase()).toContain('auto');
    await user.selectOptions(bedSelect, 'Textured PEI Plate');
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      expect(mockApi.sliceLibraryFile).toHaveBeenCalledWith(
        100,
        expect.objectContaining({ bed_type: 'Textured PEI Plate' }),
      );
    });
  });

  it('omits bed_type when the user leaves it on Auto (no override)', async () => {
    const onClose = vi.fn();
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = vi.mocked(mockApi.sliceLibraryFile).mock.calls[0];
      expect(body).not.toHaveProperty('bed_type');
    });
  });

  it('lets the user override the default and pick a Standard preset', async () => {
    const onClose = vi.fn();
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await selectPresetByName(user, 0, 'Bambu Lab X1 Carbon 0.4 nozzle');
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      expect(mockApi.sliceLibraryFile).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          printer_preset: { source: 'standard', id: 'Bambu Lab X1 Carbon 0.4 nozzle' },
        }),
      );
    });
  });

  it('routes archive sources to sliceArchive instead of sliceLibraryFile', async () => {
    const onClose = vi.fn();
    mockApi.sliceArchive.mockResolvedValue({
      job_id: 7,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/7',
    });

    renderWithTracker({
      source: { kind: 'archive', id: 86, filename: 'orca.3mf' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      expect(mockApi.sliceArchive).toHaveBeenCalledWith(86, expect.any(Object));
      expect(mockApi.sliceLibraryFile).not.toHaveBeenCalled();
    });
  });

  it('surfaces enqueue errors inline and keeps the modal open', async () => {
    const onClose = vi.fn();
    mockApi.sliceLibraryFile.mockRejectedValue(new Error('Server says no'));

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose,
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server says no');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a friendly notice when getSlicerPresets fails', async () => {
    mockApi.getSlicerPresets.mockRejectedValue(new Error('500'));

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load presets/i);
    });
  });

  it('renders a "sign in" banner when cloud_status is not_authenticated', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud_status: 'not_authenticated',
        local: fullThreeTier.local,
        standard: fullThreeTier.standard,
      }),
    );
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Sign in to Bambu Cloud/i);
    });
  });

  it('renders an "expired" banner when cloud_status is expired', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud_status: 'expired',
        local: fullThreeTier.local,
      }),
    );
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/expired/i);
    });
  });

  it('omits the banner entirely when cloud_status is ok', async () => {
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });
    await waitForDefaultPresets();
    // No status-role banner should be rendered on the happy path.
    expect(screen.queryByRole('status')).toBeNull();
  });

  // ----- Multi-plate flow -----------------------------------------------

  function makeMultiPlateLibraryResponse() {
    return {
      file_id: 100,
      filename: 'Multi.3mf',
      is_multi_plate: true,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: ['Cube'],
          object_count: 1,
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: 600,
          filament_used_grams: 10,
          filaments: [],
        },
        {
          index: 2,
          name: 'Plate 2',
          objects: ['Pyramid'],
          object_count: 1,
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: 800,
          filament_used_grams: 12,
          filaments: [],
        },
      ],
    };
  }

  it('shows the plate picker first for multi-plate library files', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiPlateLibraryResponse());
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Multi.3mf' },
      onClose: vi.fn(),
    });

    // Plate picker renders one button per plate — the accessible name
    // joins the heading ("Plate N — name") with the object summary line.
    await screen.findByRole('button', { name: /Plate 1.*Cube/ });
    expect(screen.getByRole('button', { name: /Plate 2.*Pyramid/ })).toBeDefined();
    // Profile dropdowns must NOT be visible yet — the user has to pick a
    // plate first.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('skips the plate picker for single-plate sources', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Single.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: [],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: null,
          filament_used_grams: null,
          filaments: [],
        },
      ],
    });
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Single.3mf' },
      onClose: vi.fn(),
    });

    // Should jump straight to the profile dropdowns.
    await waitForDefaultPresets();
  });

  it('passes the picked plate to the slice request', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiPlateLibraryResponse());
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Multi.3mf' },
      onClose: vi.fn(),
    });

    const user = userEvent.setup();
    // Step 1: pick Plate 2.
    const plate2Button = await screen.findByRole('button', { name: /Plate 2.*Pyramid/ });
    await user.click(plate2Button);

    // Step 2: profile dropdowns are now visible.
    await waitForDefaultPresets();

    // Step 3: submit and verify the plate index made it into the body.
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));
    await waitFor(() => {
      expect(mockApi.sliceLibraryFile).toHaveBeenCalledWith(
        100,
        expect.objectContaining({ plate: 2 }),
      );
    });
  });

  it('"Slice all plates" toggle sends plate=0 sentinel to the backend (#1493)', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiPlateLibraryResponse());
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Multi.3mf' },
      onClose: vi.fn(),
    });

    const user = userEvent.setup();
    const plate1Button = await screen.findByRole('button', { name: /Plate 1.*Cube/ });
    await user.click(plate1Button);

    await waitForDefaultPresets();

    // The "Slice all plates" checkbox only appears for multi-plate sources.
    const toggle = await screen.findByRole('checkbox', { name: /Slice all 2 plates/i });
    await user.click(toggle);

    // The action button's label flips to the "Slice all" form. Click it.
    await user.click(screen.getByRole('button', { name: /Slice all 2 plates/i }));

    await waitFor(() => {
      expect(mockApi.sliceLibraryFile).toHaveBeenCalledTimes(1);
    });
    const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
    // ``plate=0`` is the BS CLI's all-plates sentinel — one slice call,
    // one output 3MF with every plate's gcode inside, one archive.
    expect((body as { plate?: number }).plate).toBe(0);
  });

  it('"Slice all plates" toggle is hidden for single-plate sources', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Single.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: [],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: null,
          filament_used_grams: null,
          filaments: [],
        },
      ],
    });
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Single.3mf' },
      onClose: vi.fn(),
    });

    await waitForDefaultPresets();
    expect(screen.queryByRole('checkbox', { name: /Slice all/i })).toBeNull();
  });

  it('routes the plate fetch through getArchivePlates for archive sources', async () => {
    mockApi.getArchivePlates.mockResolvedValue({
      ...makeMultiPlateLibraryResponse(),
      archive_id: 100,
      filename: 'Multi.3mf',
    });
    renderWithTracker({
      source: { kind: 'archive', id: 100, filename: 'Multi.3mf' },
      onClose: vi.fn(),
    });

    await screen.findByRole('button', { name: /Plate 1.*Cube/ });
    expect(mockApi.getArchivePlates).toHaveBeenCalledWith(100);
    expect(mockApi.getLibraryFilePlates).not.toHaveBeenCalled();
  });

  it('cancelling the plate picker closes the entire slice flow', async () => {
    const onClose = vi.fn();
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiPlateLibraryResponse());
    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Multi.3mf' },
      onClose,
    });

    await screen.findByRole('button', { name: /Plate 1.*Cube/ });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('omits the plate field when the source is single-plate', async () => {
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
      expect(body).not.toHaveProperty('plate');
    });
  });

  // ----- Multi-color flow ------------------------------------------------

  function makeMultiColorPlateResponse() {
    // Single-plate 3MF that uses two filament slots — mirrors the realistic
    // "I have a multi-color file with one plate" case. Multi-plate is a
    // separate axis that's already covered above.
    return {
      file_id: 100,
      filename: 'TwoColor.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: ['Logo'],
          object_count: 1,
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: 600,
          filament_used_grams: 20,
          filaments: [],
        },
      ],
    };
  }

  function makeMultiColorRequirementsResponse() {
    return {
      file_id: 100,
      filename: 'TwoColor.3mf',
      plate_id: 1,
      filaments: [
        { slot_id: 1, type: 'PLA', color: '#000000', used_grams: 10, used_meters: 3 },
        { slot_id: 2, type: 'PLA', color: '#FFFFFF', used_grams: 10, used_meters: 3 },
      ],
    };
  }

  function makeColorAwarePresets(): UnifiedPresetsResponse {
    // Two filament presets in cloud: one black PLA, one white PLA. Pre-pick
    // should match each plate slot to the same-colour preset so the user
    // doesn't have to manually align them.
    return {
      orca_cloud: { printer: [], process: [], filament: [] },
      cloud: {
        printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
        process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
        filament: [
          { id: 'F-BLACK', name: 'Cloud PLA Black', source: 'cloud', filament_type: 'PLA', filament_colour: '#000000' },
          { id: 'F-WHITE', name: 'Cloud PLA White', source: 'cloud', filament_type: 'PLA', filament_colour: '#FFFFFF' },
        ],
      },
      local: { printer: [], process: [], filament: [] },
      standard: { printer: [], process: [], filament: [] },
      cloud_status: 'ok',
      orca_cloud_status: 'ok',
    };
  }

  it('pre-picks embedded filament_settings_id instead of the first listed preset', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Watch.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: ['Watch'],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: null,
          filament_used_grams: null,
          filaments: [],
        },
      ],
    });
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Watch.3mf',
      plate_id: 1,
      filaments: [
        {
          slot_id: 1,
          type: 'PLA',
          color: '#FFFFFF',
          preset_name: 'Bambu PLA Basic @BBL A1',
          used_grams: 0,
          used_meters: 0,
          used_in_plate: true,
        },
      ],
    });
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        local: {
          printer: [],
          process: [],
          filament: [
            { id: 'CR-PLA', name: 'CR-PLA', source: 'local', filament_type: 'PLA', filament_colour: '#FFFFFF' },
          ],
        },
        cloud: {
          printer: [{ id: 'P1', name: 'Bambu Lab A1 0.4 nozzle', source: 'cloud' }],
          process: [{ id: 'PR1', name: '0.20mm Standard @BBL A1', source: 'cloud' }],
          filament: [
            {
              id: 'bambu-pla-basic',
              name: 'Bambu PLA Basic @BBL A1',
              source: 'cloud',
              filament_type: 'PLA',
              filament_colour: '#FFFFFF',
            },
          ],
        },
      }),
    );
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Watch.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('Bambu PLA Basic @BBL A1');
    expect(screen.queryByDisplayValue('CR-PLA')).toBeNull();
  });

  it('renders one filament dropdown per plate slot when the source is multi-color', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiColorPlateResponse());
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue(makeMultiColorRequirementsResponse());
    mockApi.getSlicerPresets.mockResolvedValue(makeColorAwarePresets());

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'TwoColor.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');
    // 4 preset comboboxes + 1 bed-type select.
    expect(presetComboInputs()).toHaveLength(4);
    expect(nativeSelects()).toHaveLength(1);
  });

  it('pre-picks each filament slot by matching colour metadata', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiColorPlateResponse());
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue(makeMultiColorRequirementsResponse());
    mockApi.getSlicerPresets.mockResolvedValue(makeColorAwarePresets());
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'TwoColor.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
      // Slot 1 was black plate → cloud black preset; slot 2 was white →
      // cloud white preset. Pre-pick aligns them by metadata so the user
      // doesn't have to swap them manually.
      expect(body.filament_presets).toEqual([
        { source: 'cloud', id: 'F-BLACK' },
        { source: 'cloud', id: 'F-WHITE' },
      ]);
    });
  });

  it('still sends the legacy filament_preset for single-color flows', async () => {
    // Backwards-compat with backends / proxies that read the singular field.
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForDefaultPresets();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
      // Single-color path mirrors the array's first entry into the legacy
      // singular so older backend clients that only know about
      // `filament_preset` still work.
      expect(body.filament_preset).toEqual(body.filament_presets[0]);
      expect(body.filament_presets).toHaveLength(1);
    });
  });

  it('lets the user override a pre-picked filament slot', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue(makeMultiColorPlateResponse());
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue(makeMultiColorRequirementsResponse());
    mockApi.getSlicerPresets.mockResolvedValue(makeColorAwarePresets());
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 42,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/42',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'TwoColor.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    const filamentInput = presetComboInputs()[2];
    // Swap filament slot 1 from auto-picked black to white via the combobox.
    await user.click(filamentInput);
    await user.click(screen.getByRole('option', { name: 'Cloud PLA White' }));
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
      expect(body.filament_presets[0]).toEqual({ source: 'cloud', id: 'F-WHITE' });
      // Slot 1 stayed at the auto-picked white.
      expect(body.filament_presets[1]).toEqual({ source: 'cloud', id: 'F-WHITE' });
    });
  });

  // Cross-printer re-slicing is a normal, supported operation as of
  // 2026-05-20 (Step 0 empirical test: sidecar overrides printer / process
  // / bed / kinematics from the picked bundle, producing valid target-
  // printer G-code). No banner, no warning — the picker UI already shows
  // which printer the user picked, and that's enough.
  it('does not surface any cross-printer banner and keeps Slice enabled when models differ', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'A1Original.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: [],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: null,
          filament_used_grams: null,
          filaments: [],
        },
      ],
    });
    // Standard tier offers an X1C profile — the user picks (auto-picks) it.
    mockApi.getSlicerPresets.mockResolvedValue(makeUnified({
      standard: {
        printer: [{ id: 'Bambu Lab X1 Carbon 0.4 nozzle', name: 'Bambu Lab X1 Carbon 0.4 nozzle', source: 'standard' }],
        process: [{ id: '0.20mm Standard', name: '0.20mm Standard', source: 'standard' }],
        filament: [{ id: 'Bambu PLA Basic', name: 'Bambu PLA Basic', source: 'standard' }],
      },
    }));

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'A1Original.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('Bambu Lab X1 Carbon 0.4 nozzle');

    // No banner, no alert — re-slicing across printers is just a normal slice now.
    expect(screen.queryByRole('alert')).toBeNull();
    const sliceButton = screen.getByRole('button', { name: /^Slice$/ }) as HTMLButtonElement;
    expect(sliceButton.disabled).toBe(false);
  });

  // The `used_in_plate` flag tells the modal which AMS slots are
  // actually consumed by the picked plate. Slots flagged as unused
  // are still rendered (the slicer CLI needs a profile per project
  // slot, otherwise it silently fills the gap from embedded defaults
  // and unwanted colours leak into the output) but disabled in the UI
  // so the user only interacts with the dropdowns that matter.
  it('disables filament dropdowns for slots not used by the picked plate', async () => {
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Helmet.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: ['Helmet'],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: 1200,
          filament_used_grams: 80,
          filaments: [],
        },
      ],
    });
    // Project has 2 AMS slots configured (white + grey support), but
    // plate 1 only paints with white (slot 1). The backend now returns
    // BOTH slots with used_in_plate flagging the difference.
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Helmet.3mf',
      plate_id: 1,
      filaments: [
        { slot_id: 1, type: 'PLA', color: '#FFFFFF', used_grams: 80, used_meters: 27, used_in_plate: true },
        { slot_id: 2, type: 'PLA', color: '#808080', used_grams: 0, used_meters: 0, used_in_plate: false },
      ],
    });
    mockApi.getSlicerPresets.mockResolvedValue({
      cloud: {
        printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
        process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
        filament: [
          { id: 'F-WHITE', name: 'Cloud PLA White', source: 'cloud', filament_type: 'PLA', filament_colour: '#FFFFFF' },
          { id: 'F-GREY', name: 'Cloud PLA Grey', source: 'cloud', filament_type: 'PLA', filament_colour: '#808080' },
        ],
      },
      local: { printer: [], process: [], filament: [] },
      standard: { printer: [], process: [], filament: [] },
      cloud_status: 'ok',
      orca_cloud: { printer: [], process: [], filament: [] },
      orca_cloud_status: 'ok',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Helmet.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    // 4 preset comboboxes (printer, process, 2× filament) + bed-type select.
    expect(presetComboInputs()).toHaveLength(4);
    expect(nativeSelects()).toHaveLength(1);
    const filamentInputs = presetComboInputs().slice(2);
    expect(filamentInputs).toHaveLength(2);
    // Slot 1 (used) is editable, slot 2 (not used) is disabled.
    expect(filamentInputs[0].disabled).toBe(false);
    expect(filamentInputs[1].disabled).toBe(true);
    // The disabled row's label calls out why it's disabled.
    expect(screen.getByText(/not used by this plate/i)).toBeDefined();
  });

  it('still sends both filaments to the backend even when one slot is disabled', async () => {
    // The auto-pick scoring fills the disabled slot from project
    // metadata — the slicer CLI requires a profile for every project
    // slot, otherwise it silently fills the gap. The disabled UI is
    // purely cosmetic; the wire format must include the full list.
    mockApi.getLibraryFilePlates.mockResolvedValue({
      file_id: 100,
      filename: 'Helmet.3mf',
      is_multi_plate: false,
      plates: [
        {
          index: 1,
          name: 'Plate 1',
          objects: ['Helmet'],
          has_thumbnail: false,
          thumbnail_url: null,
          print_time_seconds: 1200,
          filament_used_grams: 80,
          filaments: [],
        },
      ],
    });
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Helmet.3mf',
      plate_id: 1,
      filaments: [
        { slot_id: 1, type: 'PLA', color: '#FFFFFF', used_grams: 80, used_meters: 27, used_in_plate: true },
        { slot_id: 2, type: 'PLA', color: '#808080', used_grams: 0, used_meters: 0, used_in_plate: false },
      ],
    });
    mockApi.getSlicerPresets.mockResolvedValue({
      cloud: {
        printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
        process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
        filament: [
          { id: 'F-WHITE', name: 'Cloud PLA White', source: 'cloud', filament_type: 'PLA', filament_colour: '#FFFFFF' },
          { id: 'F-GREY', name: 'Cloud PLA Grey', source: 'cloud', filament_type: 'PLA', filament_colour: '#808080' },
        ],
      },
      local: { printer: [], process: [], filament: [] },
      standard: { printer: [], process: [], filament: [] },
      cloud_status: 'ok',
      orca_cloud: { printer: [], process: [], filament: [] },
      orca_cloud_status: 'ok',
    });
    mockApi.sliceLibraryFile.mockResolvedValue({
      job_id: 50,
      status: 'pending',
      status_url: '/api/v1/slice-jobs/50',
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Helmet.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Slice$/ }));

    await waitFor(() => {
      const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
      // Both slots populated: slot 1 with the user's white pick, slot
      // 2 auto-picked with grey from the colour-match scoring.
      expect(body.filament_presets).toHaveLength(2);
      expect(body.filament_presets[0]).toEqual({ source: 'cloud', id: 'F-WHITE' });
      expect(body.filament_presets[1]).toEqual({ source: 'cloud', id: 'F-GREY' });
    });
  });

  // -------------------------------------------------------------------------
  // Bundle tier — picking an imported .bbscfg replaces the cloud/local/standard
  // dropdown set with bundle-scoped pickers and routes the slice through the
  // backend's bundle dispatch shape (no PresetRefs in the body).
  // -------------------------------------------------------------------------

  describe('Bundle tier', () => {
    const sampleBundle = {
      id: 'abc123def456abcd',
      printer_preset_name: '# Bambu Lab H2D 0.4 nozzle',
      printer: ['# Bambu Lab H2D 0.4 nozzle'],
      process: [
        '# 0.20mm Standard @BBL H2D',
        '# 0.16mm Standard @BBL H2D',
      ],
      filament: [
        '# Bambu PLA Basic @BBL H2D',
        '# Bambu PETG HF @BBL H2D 0.4 nozzle',
      ],
      version: '02.06.00.50',
    };

    it('hides the bundle picker when no bundles are imported', async () => {
      // Default beforeEach already returns []; assert the picker isn't
      // rendered so users without bundles see the original layout.
      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
        onClose: vi.fn(),
      });
      await waitForDefaultPresets();
      expect(screen.queryByText(/slicer bundle/i)).toBeNull();
    });

    it('renders the bundle picker when at least one bundle is imported', async () => {
      mockApi.listSlicerBundles.mockResolvedValue([sampleBundle]);
      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
        onClose: vi.fn(),
      });
      await waitFor(() =>
        expect(screen.getByText(/slicer bundle/i)).toBeDefined(),
      );
      // The bundle option is in the dropdown.
      const bundleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      expect(
        Array.from(bundleSelect.options).map((o) => o.textContent),
      ).toContain('# Bambu Lab H2D 0.4 nozzle');
    });

    it('replaces preset dropdowns with bundle-scoped pickers when a bundle is selected', async () => {
      mockApi.listSlicerBundles.mockResolvedValue([sampleBundle]);
      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
        onClose: vi.fn(),
      });
      await waitForDefaultPresets();

      const user = userEvent.setup();
      const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
      // First select is the bundle picker (new top-of-modal dropdown).
      await user.selectOptions(selects[0], sampleBundle.id);

      // Wait for the bundle-mode UI to take over: process options should
      // now reflect the bundle's process names.
      await waitFor(() => {
        expect(
          screen.getByDisplayValue('# 0.20mm Standard @BBL H2D'),
        ).toBeDefined();
      });

      // The static printer label shows the bundle's printer. Both the
      // <option> in the bundle picker and the read-only <div> below
      // contain this text, so use getAllByText.
      const printerNameMatches = screen.getAllByText('# Bambu Lab H2D 0.4 nozzle');
      expect(printerNameMatches.length).toBeGreaterThanOrEqual(2);

      // Cloud/local/standard preset names from the original tier no longer
      // appear in the visible dropdowns (the bundle replaced them).
      const visibleSelects = screen.getAllByRole('combobox').filter(
        (el) => el.tagName === 'SELECT',
      ) as HTMLSelectElement[];
      const allOptionTexts = visibleSelects.flatMap((sel) =>
        Array.from(sel.options).map((o) => o.textContent ?? ''),
      );
      // Cloud printer name shouldn't be in any visible dropdown anymore.
      expect(allOptionTexts).not.toContain('My Custom X1C');
    });

    it('submits bundle dispatch shape (no PresetRefs) when a bundle is selected', async () => {
      mockApi.listSlicerBundles.mockResolvedValue([sampleBundle]);
      mockApi.sliceLibraryFile.mockResolvedValue({
        job_id: 99,
        status: 'pending',
        status_url: '/api/v1/slice-jobs/99',
      });

      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
        onClose: vi.fn(),
      });
      await waitForDefaultPresets();

      const user = userEvent.setup();
      const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
      await user.selectOptions(selects[0], sampleBundle.id);

      // Wait for bundle-mode dropdowns to render.
      await waitFor(() =>
        expect(screen.getByDisplayValue('# 0.20mm Standard @BBL H2D')).toBeDefined(),
      );
      await user.click(screen.getByRole('button', { name: /^Slice$/ }));

      await waitFor(() => {
        const [fileId, body] = mockApi.sliceLibraryFile.mock.calls[0];
        expect(fileId).toBe(100);
        expect(body.bundle).toEqual({
          bundle_id: sampleBundle.id,
          printer_name: '# Bambu Lab H2D 0.4 nozzle',
          process_name: '# 0.20mm Standard @BBL H2D',
          filament_names: ['# Bambu PLA Basic @BBL H2D'],
        });
        // The preset triplet must NOT be in the body — bundle dispatch
        // skips PresetRef resolution entirely on the backend.
        expect(body.printer_preset).toBeUndefined();
        expect(body.process_preset).toBeUndefined();
        expect(body.filament_presets).toBeUndefined();
      });
    });

    it('switching back to "None" restores the preset triplet path', async () => {
      mockApi.listSlicerBundles.mockResolvedValue([sampleBundle]);
      mockApi.sliceLibraryFile.mockResolvedValue({
        job_id: 100,
        status: 'pending',
        status_url: '/api/v1/slice-jobs/100',
      });

      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
        onClose: vi.fn(),
      });
      await waitForDefaultPresets();

      const user = userEvent.setup();
      const bundleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      await user.selectOptions(bundleSelect, sampleBundle.id);
      await waitFor(() =>
        expect(screen.getByDisplayValue('# 0.20mm Standard @BBL H2D')).toBeDefined(),
      );

      // Flip back to None — triplet returns with local-tier auto-pick.
      await user.selectOptions(bundleSelect, '');
      await waitFor(() => {
        expect(presetComboInputs()[0].value).toBe('Imported X1C 0.4');
      });
      await user.click(presetComboInputs()[0]);
      expect(screen.getByRole('option', { name: 'My Custom X1C' })).toBeDefined();

      await user.click(screen.getByRole('button', { name: /^Slice$/ }));
      await waitFor(() => {
        const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
        expect(body.bundle).toBeUndefined();
        expect(body.printer_preset).toBeDefined();
      });
    });
  });

  it('auto-selects filament from Spoolman profile when it matches a Tier-1 preset', async () => {
    mockApi.getSpoolmanSettings.mockResolvedValue({
      spoolman_enabled: 'true',
      spoolman_url: 'http://spoolman.local',
    });
    mockApi.getSpoolmanInventorySpools.mockResolvedValue([
      {
        id: 99,
        material: 'PLA',
        subtype: 'Basic',
        color_name: 'Black',
        rgba: '000000FF',
        slicer_filament: 'GFSL05',
        slicer_filament_name: 'Bambu PLA Basic @BBL',
        slicer_filament_source: 'spool',
        label_weight: 1000,
        core_weight: 250,
        weight_used: 0,
        archived_at: null,
      },
    ] as never);
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud: {
          printer: [{ id: 'P-P1S', name: 'Bambu Lab P1S 0.4 nozzle', source: 'cloud' }],
          process: [{ id: 'PR1', name: '0.20mm Standard @BBL P1S', source: 'cloud' }],
          filament: [
            {
              id: 'F-P1S',
              name: 'Bambu PLA Basic @BBL P1S',
              source: 'cloud',
              filament_type: 'PLA',
              filament_colour: '#000000',
            },
            {
              id: 'F-X1C',
              name: 'Bambu PLA Basic @BBL X1C',
              source: 'cloud',
              filament_type: 'PLA',
              filament_colour: '#000000',
            },
          ],
        },
        local: { printer: [], process: [], filament: [] },
        standard: { printer: [], process: [], filament: [] },
      }),
    );
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Cube.stl',
      plate_id: 1,
      filaments: [{ slot_id: 1, type: 'PLA', color: '#000000', used_grams: 10, used_meters: 3 }],
    });

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Bambu PLA Basic @BBL P1S')).toBeDefined();
    });
    expect(presetComboInputs()[0].value).toBe('Bambu Lab P1S 0.4 nozzle');
    expect(presetComboInputs()[2].value).toBe('Bambu PLA Basic @BBL P1S');
  });

  it('filters filament by preset name when inventory spool is linked (not shared spool text)', async () => {
    mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
      file_id: 100,
      filename: 'Cube.3mf',
      plate_id: 1,
      filaments: [{ slot_id: 1, type: 'PLA', color: '#000000', used_grams: 10, used_meters: 3 }],
    });
    mockApi.getSpools.mockResolvedValue([
      {
        id: 1,
        material: 'PLA',
        color_name: 'Black',
        rgba: '#000000',
        slicer_filament_name: 'Bambu PLA Basic Black',
        slicer_filament: 'GFB00',
        subtype: null,
        brand: null,
        label_weight: 1000,
        core_weight: 0,
        core_weight_catalog_id: null,
        weight_used: 0,
        extra_colors: null,
        effect_type: null,
        nozzle_temp_min: null,
        nozzle_temp_max: null,
        note: null,
        added_full: null,
        archived_at: null,
      },
    ]);
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud: {
          printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
          process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
          filament: [
            { id: 'F-BLACK', name: 'Bambu PLA Basic Black', source: 'cloud', filament_type: 'PLA' },
            { id: 'F-PETG', name: 'Bambu PETG HF', source: 'cloud', filament_type: 'PETG' },
          ],
        },
      }),
    );

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.3mf' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    const input = presetComboInputs()[2];
    await user.click(input);
    // "bas" appears in the linked spool profile and would match every preset if
    // spool fields were merged into each option's haystack; only the PLA name has it.
    await user.type(input, 'bas');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Bambu PLA Basic Black' })).toBeDefined();
      expect(screen.queryByRole('option', { name: 'Bambu PETG HF' })).toBeNull();
    });
  });

  it('fuzzy-filters filament presets in the combobox as the user types', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud: {
          printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
          process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
          filament: [
            { id: 'F-BLACK', name: 'Bambu PLA Basic Black', source: 'cloud', filament_type: 'PLA' },
            { id: 'F-PETG', name: 'Bambu PETG Basic', source: 'cloud', filament_type: 'PETG' },
          ],
        },
      }),
    );

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    const input = presetComboInputs()[2];
    await user.click(input);
    // "plabk" fuzzy-matches "Bambu PLA Basic Black" but not "Bambu PETG Basic"
    await user.type(input, 'plabk');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Bambu PLA Basic Black' })).toBeDefined();
      expect(screen.queryByRole('option', { name: 'Bambu PETG Basic' })).toBeNull();
    });
  });

  it('filters filament presets in the combobox as the user types', async () => {
    mockApi.getSlicerPresets.mockResolvedValue(
      makeUnified({
        cloud: {
          printer: [{ id: 'P1', name: 'X1C', source: 'cloud' }],
          process: [{ id: 'PR1', name: '0.20mm', source: 'cloud' }],
          filament: [
            { id: 'F-BLACK', name: 'Bambu PLA Basic Black', source: 'cloud', filament_type: 'PLA' },
            { id: 'F-PETG', name: 'Bambu PETG Basic', source: 'cloud', filament_type: 'PETG' },
          ],
        },
      }),
    );

    renderWithTracker({
      source: { kind: 'libraryFile', id: 100, filename: 'Cube.stl' },
      onClose: vi.fn(),
    });

    await waitForPresetDisplay('X1C');

    const user = userEvent.setup();
    const input = presetComboInputs()[2];
    await user.click(input);
    await user.type(input, 'PETG');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Bambu PETG Basic' })).toBeDefined();
      expect(screen.queryByRole('option', { name: 'Bambu PLA Basic Black' })).toBeNull();
    });
  });

  describe('3MF project overrides', () => {
    it('shows the embedded 3MF process and override toggles', async () => {
      mockApi.getLibraryFilePlates.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        is_multi_plate: false,
        embedded_printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
        embedded_process: '0.20mm Standard @BBL X1C',
        project_process_overrides: [
          { key: 'enable_support', value: '1' },
          { key: 'support_type', value: 'tree(auto)' },
        ],
        plates: [
          {
            index: 1,
            name: 'Plate 1',
            objects: ['Helmet'],
            has_thumbnail: false,
            thumbnail_url: null,
            print_time_seconds: null,
            filament_used_grams: null,
            filaments: [],
          },
        ],
      });
      mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        plate_id: 1,
        filaments: [{ slot_id: 1, type: 'PLA', color: '#FFFFFF', used_grams: 80, used_meters: 27 }],
      });
      mockApi.getSlicerPresets.mockResolvedValue(makeUnified({
        standard: {
          printer: [
            { id: 'Bambu Lab X1 Carbon 0.4 nozzle', name: 'Bambu Lab X1 Carbon 0.4 nozzle', source: 'standard' },
            { id: 'Bambu Lab A1 mini 0.4 nozzle', name: 'Bambu Lab A1 mini 0.4 nozzle', source: 'standard' },
          ],
          process: [
            { id: '0.20mm Standard @BBL X1C', name: '0.20mm Standard @BBL X1C', source: 'standard' },
            { id: '0.20mm Standard @BBL A1 Mini', name: '0.20mm Standard @BBL A1 Mini', source: 'standard' },
          ],
          filament: [{ id: 'Bambu PLA Basic', name: 'Bambu PLA Basic', source: 'standard' }],
        },
      }));
      mockApi.sliceLibraryFile.mockResolvedValue({
        job_id: 50,
        status: 'pending',
        status_url: '/api/v1/slice-jobs/50',
      });

      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Helmet.3mf' },
        onClose: vi.fn(),
      });

      await waitForPresetDisplay('Bambu Lab X1 Carbon 0.4 nozzle');
      expect(screen.getByText(/Use 3MF process overrides/i)).toBeDefined();
      expect(screen.getByText(/2 of 2 overrides/i)).toBeDefined();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^Slice$/ }));

      await waitFor(() => {
        const [, body] = mockApi.sliceLibraryFile.mock.calls[0];
        expect(body.use_project_overrides).toBe(true);
        expect(body.disabled_project_override_keys).toBeUndefined();
      });
    });

    it('re-picks the mapped process when the printer changes', async () => {
      mockApi.getLibraryFilePlates.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        is_multi_plate: false,
        embedded_printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
        embedded_process: '0.20mm Standard @BBL X1C',
        project_process_overrides: [],
        plates: [
          {
            index: 1,
            name: 'Plate 1',
            objects: ['Helmet'],
            has_thumbnail: false,
            thumbnail_url: null,
            print_time_seconds: null,
            filament_used_grams: null,
            filaments: [],
          },
        ],
      });
      mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        plate_id: 1,
        filaments: [{ slot_id: 1, type: 'PLA', color: '#FFFFFF', used_grams: 80, used_meters: 27 }],
      });
      mockApi.getSlicerPresets.mockResolvedValue(makeUnified({
        standard: {
          printer: [
            { id: 'Bambu Lab X1 Carbon 0.4 nozzle', name: 'Bambu Lab X1 Carbon 0.4 nozzle', source: 'standard' },
            { id: 'Bambu Lab A1 mini 0.4 nozzle', name: 'Bambu Lab A1 mini 0.4 nozzle', source: 'standard' },
          ],
          process: [
            { id: '0.20mm Standard @BBL X1C', name: '0.20mm Standard @BBL X1C', source: 'standard' },
            { id: '0.20mm Standard @BBL A1 Mini', name: '0.20mm Standard @BBL A1 Mini', source: 'standard' },
          ],
          filament: [{ id: 'Bambu PLA Basic', name: 'Bambu PLA Basic', source: 'standard' }],
        },
      }));

      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Helmet.3mf' },
        onClose: vi.fn(),
      });

      await waitForPresetDisplay('Bambu Lab X1 Carbon 0.4 nozzle');
      await waitForPresetDisplay('0.20mm Standard @BBL X1C');

      const user = userEvent.setup();
      await selectPresetByName(user, 0, 'Bambu Lab A1 mini 0.4 nozzle');

      await waitForPresetDisplay('0.20mm Standard @BBL A1 Mini');
      await waitFor(() => {
        expect(screen.getByText(/Suggested match on this printer/i)).toBeDefined();
        expect(screen.getByText(/0\.20mm Standard @BBL A1M/i)).toBeDefined();
      });
    });

    it('shows the catalog @BBL A1M name in the suggested match hint', async () => {
      mockApi.getLibraryFilePlates.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        is_multi_plate: false,
        embedded_printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
        embedded_process: '0.20mm Standard @BBL X1C',
        project_process_overrides: [],
        plates: [
          {
            index: 1,
            name: 'Plate 1',
            objects: ['Helmet'],
            has_thumbnail: false,
            thumbnail_url: null,
            print_time_seconds: null,
            filament_used_grams: null,
            filaments: [],
          },
        ],
      });
      mockApi.getLibraryFileFilamentRequirements.mockResolvedValue({
        file_id: 100,
        filename: 'Helmet.3mf',
        plate_id: 1,
        filaments: [{ slot_id: 1, type: 'PLA', color: '#FFFFFF', used_grams: 80, used_meters: 27 }],
      });
      mockApi.getSlicerPresets.mockResolvedValue(makeUnified({
        cloud: {
          printer: [
            { id: 'Bambu Lab X1 Carbon 0.4 nozzle', name: 'Bambu Lab X1 Carbon 0.4 nozzle', source: 'cloud' },
            { id: 'Bambu Lab A1 mini 0.4 nozzle', name: 'Bambu Lab A1 mini 0.4 nozzle', source: 'cloud' },
          ],
          process: [
            { id: '0.20mm Standard @BBL X1C', name: '0.20mm Standard @BBL X1C', source: 'cloud' },
            { id: '0.20mm Standard @BBL A1M', name: '0.20mm Standard @BBL A1M', source: 'cloud' },
          ],
          filament: [{ id: 'Bambu PLA Basic', name: 'Bambu PLA Basic', source: 'cloud' }],
        },
      }));

      renderWithTracker({
        source: { kind: 'libraryFile', id: 100, filename: 'Helmet.3mf' },
        onClose: vi.fn(),
      });

      await waitForPresetDisplay('Bambu Lab X1 Carbon 0.4 nozzle');
      const user = userEvent.setup();
      await selectPresetByName(user, 0, 'Bambu Lab A1 mini 0.4 nozzle');

      await waitForPresetDisplay('0.20mm Standard @BBL A1M');
      await waitFor(() => {
        expect(screen.getByText(/Suggested match on this printer/i)).toBeDefined();
        expect(screen.getByText(/0\.20mm Standard @BBL A1M/i)).toBeDefined();
      });
    });
  });
});
