import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationSection } from '../../../pages/collections/CollectionObjectWorkspacePage/LocationSection';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../components/collections/LocationPickerModal', () => ({
  EditableLocationPicker: ({ label, value, displayValue }: { label: string; value: string | null; displayValue?: string }) => (
    <div data-testid="location-picker">
      {label}:{value || 'none'}:{displayValue || ''}
    </div>
  ),
}));

// bwip-js dynamic import — make import succeed but not render anything visible
vi.mock('bwip-js', () => ({
  default: { toCanvas: () => {} },
}));

const baseFormData = {
  current_location_id: 'loc-1',
  home_location_id: null,
  current_location_fitness: '',
  current_location_note: '',
  is_discoverable: false,
} as unknown as FormData;

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    object: makeCollectionObject(),
    formData: baseFormData,
    isEditing: false,
    isCreateMode: false,
    updateField: vi.fn(),
    handleFieldBlur: vi.fn(),
    onMovementClick: vi.fn(),
    sectionHint: 'Current: Building / Gallery A',
    isEmpty: false,
    expandedSections: { location: true },
    toggleSection: vi.fn(),
    sectionRefs: { current: {} },
    getSectionOrder: () => 1,
    ...overrides,
  } as Parameters<typeof LocationSection>[0];
}

describe('LocationSection', () => {
  it('returns null in create mode (location requires a saved record)', () => {
    const { container } = render(<LocationSection {...makeProps({ isCreateMode: true })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the "Location" title', () => {
    render(<LocationSection {...makeProps()} />);
    expect(screen.getByText('Location')).toBeInTheDocument();
  });

  it('renders the current location path when set', () => {
    render(<LocationSection {...makeProps()} />);
    expect(screen.getByText('Main Building / Floor 2 / Gallery A')).toBeInTheDocument();
  });

  it('shows the "Move" CTA when a current location is set', () => {
    render(<LocationSection {...makeProps()} />);
    expect(screen.getByRole('button', { name: /Move/i })).toBeInTheDocument();
  });

  it('shows "Set Location" CTA when no current location is set', () => {
    render(
      <LocationSection
        {...makeProps({
          object: makeCollectionObject({ current_location: null, current_location_id: null }),
        })}
      />,
    );
    expect(screen.getByText('Set Location')).toBeInTheDocument();
  });

  it('calls onMovementClick when Move CTA is clicked', () => {
    const onMovementClick = vi.fn();
    render(<LocationSection {...makeProps({ onMovementClick })} />);
    fireEvent.click(screen.getByRole('button', { name: /Move/i }));
    expect(onMovementClick).toHaveBeenCalledTimes(1);
  });

  it('renders the EditableLocationPicker for Home Location', () => {
    render(<LocationSection {...makeProps()} />);
    expect(screen.getByTestId('location-picker')).toHaveTextContent('Home Location');
  });

  it('renders the per-part location summary for a multi-part object', () => {
    render(
      <LocationSection
        {...makeProps({
          object: makeCollectionObject({
            object_number: '2024.001',
            parts: [
              {
                part_id: 'p-1',
                part_number: '1',
                name: 'Body',
                current_location_path: 'Storage A',
              } as never,
              {
                part_id: 'p-2',
                part_number: '2',
                name: 'Lid',
                current_location_path: null,
                current_location_name: null,
              } as never,
            ],
          }),
        })}
      />,
    );
    expect(screen.getByText('2024.001.1 Body')).toBeInTheDocument();
    expect(screen.getByText('Storage A')).toBeInTheDocument();
    expect(screen.getByText('No location')).toBeInTheDocument();
  });

  it('renders the section hint when collapsed', () => {
    render(<LocationSection {...makeProps({ expandedSections: { location: false } })} />);
    expect(screen.getByText('Current: Building / Gallery A')).toBeInTheDocument();
  });

  it('calls toggleSection when collapsed header is clicked', () => {
    const toggleSection = vi.fn();
    render(
      <LocationSection
        {...makeProps({
          expandedSections: { location: false },
          toggleSection,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Location'));
    expect(toggleSection).toHaveBeenCalledWith('location');
  });
});
