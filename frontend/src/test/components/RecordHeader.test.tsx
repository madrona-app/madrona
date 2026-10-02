import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecordHeader } from '../../components/record-detail/RecordHeader';

function renderHeader(props: Parameters<typeof RecordHeader>[0]) {
  return render(
    <MemoryRouter>
      <RecordHeader {...props} />
    </MemoryRouter>
  );
}

describe('RecordHeader', () => {
  it('renders title', () => {
    renderHeader({ title: 'Terracotta Warrior' });
    expect(
      screen.getByRole('heading', { name: /Terracotta Warrior/ })
    ).toBeInTheDocument();
  });

  it('renders object number alongside title', () => {
    renderHeader({ title: 'Vase', objectNumber: '2023.005' });
    expect(screen.getByText('2023.005')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    renderHeader({ title: 'Vase', subtitle: 'Ming Dynasty ceramic piece' });
    expect(
      screen.getByText('Ming Dynasty ceramic piece')
    ).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    renderHeader({ title: 'Vase' });
    const subtitle = screen.queryByText(/Ming Dynasty/);
    expect(subtitle).not.toBeInTheDocument();
  });

  it('renders back link with default label', () => {
    renderHeader({ title: 'Vase' });
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('renders back link with custom label', () => {
    renderHeader({ title: 'Vase', backLabel: 'Back to Collection' });
    expect(screen.getByText('Back to Collection')).toBeInTheDocument();
  });

  it('uses backUrl as href when provided', () => {
    renderHeader({ title: 'V', backUrl: '/collections' });
    const link = screen.getByRole('link', { name: /Back/ });
    expect(link).toHaveAttribute('href', '/collections');
  });

  it('renders delete button when canDelete and onDelete provided', () => {
    renderHeader({
      title: 'V',
      canDelete: true,
      onDelete: vi.fn(),
    });
    expect(screen.getByLabelText('Delete record')).toBeInTheDocument();
  });

  it('does not render delete button when canDelete is false', () => {
    renderHeader({ title: 'V', canDelete: false, onDelete: vi.fn() });
    expect(screen.queryByLabelText('Delete record')).not.toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    renderHeader({ title: 'V', canDelete: true, onDelete });
    fireEvent.click(screen.getByLabelText('Delete record'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders ActionMenu trigger when actions are available', () => {
    renderHeader({
      title: 'V',
      canCreateTask: true,
      onCreateTask: vi.fn(),
    });
    // ActionMenu renders a "More actions" button
    expect(screen.getByLabelText('More actions')).toBeInTheDocument();
  });

  it('does not render ActionMenu when no actions available', () => {
    renderHeader({ title: 'V' });
    expect(screen.queryByLabelText('More actions')).not.toBeInTheDocument();
  });
});
