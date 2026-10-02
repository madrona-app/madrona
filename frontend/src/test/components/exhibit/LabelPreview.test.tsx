import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelPreview } from '../../../components/exhibit/LabelPreview';
import type { ExhibitionLabel } from '../../../lib/api';

vi.mock('../../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../lib/formatters', () => ({
  formatDateShort: (v: string) => `fmt:${v}`,
}));

const baseLabel: ExhibitionLabel = {
  label_id: 'label-1',
  label_type: 'tombstone',
  generated_text: 'Generated Tombstone text',
  display_text: 'Generated Tombstone text',
  status: 'draft',
  print_count: 0,
};

function renderPreview(
  overrides: Partial<Parameters<typeof LabelPreview>[0]> = {},
  label: ExhibitionLabel = baseLabel,
) {
  const props = {
    isOpen: true,
    label,
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LabelPreview {...props} />) };
}

describe('LabelPreview', () => {
  it('renders nothing when closed', () => {
    const { container } = renderPreview({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders label type subtitle', () => {
    renderPreview();
    expect(screen.getByText(/tombstone label/i)).toBeInTheDocument();
  });

  it('renders generated text when no custom text', () => {
    renderPreview();
    expect(screen.getByText('Generated Tombstone text')).toBeInTheDocument();
  });

  it('prefers custom_text over generated_text', () => {
    renderPreview({}, { ...baseLabel, custom_text: 'Hand-edited copy' });
    expect(screen.getByText('Hand-edited copy')).toBeInTheDocument();
    expect(screen.queryByText('Generated Tombstone text')).not.toBeInTheDocument();
  });

  it('shows status and print count', () => {
    renderPreview({}, { ...baseLabel, status: 'approved', print_count: 7 });
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows approved date when provided', () => {
    renderPreview({}, { ...baseLabel, approved_at: '2026-01-02' });
    expect(screen.getByText('fmt:2026-01-02')).toBeInTheDocument();
  });

  it('shows last printed date when provided', () => {
    renderPreview({}, { ...baseLabel, last_printed_at: '2026-03-15' });
    expect(screen.getByText('fmt:2026-03-15')).toBeInTheDocument();
  });

  it('shows custom text indicator only when custom_text exists', () => {
    const { rerender } = render(
      <LabelPreview isOpen label={baseLabel} onClose={vi.fn()} />,
    );
    expect(
      screen.queryByText(/custom text that overrides/i),
    ).not.toBeInTheDocument();

    rerender(
      <LabelPreview
        isOpen
        label={{ ...baseLabel, custom_text: 'Override' }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/custom text that overrides/i),
    ).toBeInTheDocument();
  });

  it('calls onClose when the close (X) button is clicked', () => {
    const { props } = renderPreview();
    // X close button at top; find by the only svg-icon-button with no name
    const buttons = screen.getAllByRole('button');
    // First button is the X icon close
    fireEvent.click(buttons[0]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the footer Close button is clicked', () => {
    const { props } = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
