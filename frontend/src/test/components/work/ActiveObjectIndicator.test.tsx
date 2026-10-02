import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActiveObjectIndicator } from '../../../components/work/ActiveObjectIndicator';

const { useWorkMock, useOrganizationMock, clearActiveObjectMock } = vi.hoisted(() => ({
  useWorkMock: vi.fn(),
  useOrganizationMock: vi.fn(),
  clearActiveObjectMock: vi.fn(),
}));

vi.mock('../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

function setActive(active: object | null = {
  object_id: 'obj-1',
  accession_number: '2024.1.1',
  title: 'A Beautiful Painting Of A Mountain',
  thumbnail_url: null,
}) {
  useWorkMock.mockReturnValue({
    activeObject: active,
    clearActiveObject: clearActiveObjectMock,
  });
  useOrganizationMock.mockReturnValue({
    activeOrganization: { organization_id: 'org-1' },
  });
}

function renderIt(props: Parameters<typeof ActiveObjectIndicator>[0] = {}) {
  return render(
    <MemoryRouter>
      <ActiveObjectIndicator {...props} />
    </MemoryRouter>,
  );
}

describe('ActiveObjectIndicator', () => {
  beforeEach(() => {
    useWorkMock.mockReset();
    useOrganizationMock.mockReset();
    clearActiveObjectMock.mockReset();
  });

  it('renders nothing when there is no active object', () => {
    setActive(null);
    const { container } = renderIt();
    expect(container.firstChild).toBeNull();
  });

  it('renders the accession number in full mode', () => {
    setActive();
    renderIt();
    expect(screen.getByText('2024.1.1')).toBeInTheDocument();
  });

  it('truncates long titles in full mode', () => {
    setActive({
      object_id: 'o',
      accession_number: 'A',
      title: 'A'.repeat(100),
      thumbnail_url: null,
    });
    renderIt();
    expect(screen.getByText(/^A{35}\.\.\.$/)).toBeInTheDocument();
  });

  it('renders thumbnail image when present', () => {
    setActive({
      object_id: 'o',
      accession_number: 'A',
      title: 'A short title',
      thumbnail_url: 'https://example.com/x.jpg',
    });
    const { container } = renderIt();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/x.jpg');
  });

  it('renders a placeholder icon when no thumbnail is present', () => {
    setActive();
    const { container } = renderIt();
    expect(container.querySelector('img')).toBeNull();
  });

  it('Clear button calls clearActiveObject', () => {
    setActive();
    renderIt();
    fireEvent.click(screen.getByText('Clear'));
    expect(clearActiveObjectMock).toHaveBeenCalledTimes(1);
  });

  it('shows Change link only when onChangeRequest is provided and showChangeOption=true', () => {
    setActive();
    const onChange = vi.fn();
    const { rerender } = renderIt({ onChangeRequest: onChange });
    expect(screen.getByText('Change')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ActiveObjectIndicator showChangeOption={false} onChangeRequest={onChange} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Change')).toBeNull();
  });

  it('Change button calls onChangeRequest', () => {
    setActive();
    const onChange = vi.fn();
    renderIt({ onChangeRequest: onChange });
    fireEvent.click(screen.getByText('Change'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders compact pill in compact mode', () => {
    setActive();
    renderIt({ compact: true });
    expect(screen.getByText('2024.1.1')).toBeInTheDocument();
    // Compact mode does not render "Clear" or "Change" labels
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('compact mode clear button still works', () => {
    setActive();
    renderIt({ compact: true });
    const clearBtn = screen.getByTitle('Clear active object');
    fireEvent.click(clearBtn);
    expect(clearActiveObjectMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to "#" link when there is no active organization', () => {
    useWorkMock.mockReturnValue({
      activeObject: {
        object_id: 'o',
        accession_number: 'A',
        title: 'short',
        thumbnail_url: null,
      },
      clearActiveObject: clearActiveObjectMock,
    });
    useOrganizationMock.mockReturnValue({ activeOrganization: null });
    const { container } = render(
      <MemoryRouter>
        <ActiveObjectIndicator />
      </MemoryRouter>,
    );
    // No active org → href is "#" → React Router resolves to '/'
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/');
  });
});
