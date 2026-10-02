import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VersionComparisonView } from '../../../components/dam/VersionComparisonView';

const versionA = {
  version_id: 'v-a',
  version_number: 1,
  file_size: 1024,
  mime_type: 'image/png',
  created_at: '2025-01-01T00:00:00Z',
  url: '/a.png',
  change_note: 'Initial',
} as never;

const versionB = {
  version_id: 'v-b',
  version_number: 2,
  file_size: 2048,
  mime_type: 'image/png',
  created_at: '2025-01-02T00:00:00Z',
  url: '/b.png',
  change_note: 'Updated',
} as never;

function renderView(mediaType = 'image', overrides?: Partial<Parameters<typeof VersionComparisonView>[0]>) {
  return render(
    <VersionComparisonView
      organizationId="org-1"
      mediaId="m-1"
      versionA={versionA}
      versionB={versionB}
      mediaType={mediaType}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe('VersionComparisonView', () => {
  it('renders header with version numbers', () => {
    renderView();
    expect(screen.getByText(/Comparing Version 1 vs Version 2/)).toBeInTheDocument();
  });

  it('renders both version images for image type', () => {
    renderView('image');
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(images.some((img) => (img as HTMLImageElement).src.includes('a.png'))).toBe(true);
    expect(images.some((img) => (img as HTMLImageElement).src.includes('b.png'))).toBe(true);
  });

  it('renders metadata diff for non-image type', () => {
    renderView('document');
    expect(screen.getAllByText(/Version 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Version 2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/File size/).length).toBeGreaterThan(0);
  });

  it('renders the slider with correct aria attributes', () => {
    renderView('image');
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemin', '5');
    expect(slider).toHaveAttribute('aria-valuemax', '95');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
  });

  it('moves slider on ArrowRight key', () => {
    renderView('image');
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '52');
  });

  it('moves slider on ArrowLeft key', () => {
    renderView('image');
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '48');
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    renderView('image', { onClose });
    fireEvent.click(screen.getByLabelText('Close comparison view'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows file size diff at bottom', () => {
    renderView('image');
    expect(screen.getByText(/v1: 1.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/v2: 2.0 KB/)).toBeInTheDocument();
  });

  it('formats bytes correctly', () => {
    renderView('document');
    expect(screen.getAllByText('1.0 KB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2.0 KB').length).toBeGreaterThan(0);
  });
});
