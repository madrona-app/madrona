import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IIIFViewer from '../../components/IIIFViewer';

// Mock fetch (used to load manifests)
beforeEach(() => {
  vi.restoreAllMocks();
  // Provide fetch mock returning a basic manifest
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      label: 'Test Image',
      summary: 'A test image manifest',
      items: [{ items: [{ items: [{ body: { id: 'http://x/img', service: [{ id: 'http://x', profile: 'level2' }], width: 100, height: 100 } }] }] }],
    }),
  }) as never;
});

describe('IIIFViewer', () => {
  it('shows error when no source provided', async () => {
    render(<IIIFViewer />);
    expect(await screen.findByText('Failed to load image')).toBeInTheDocument();
  });

  it('renders close button when modal=true and onClose given', async () => {
    render(<IIIFViewer modal onClose={vi.fn()} imageUrl="http://x/i.png" />);
    // The close button renders even while the viewer is loading
    expect(screen.getByRole('button', { name: 'Close viewer' })).toBeInTheDocument();
  });

  it('does not render close button when not modal', async () => {
    render(<IIIFViewer imageUrl="http://x/i.png" />);
    expect(screen.queryByRole('button', { name: 'Close viewer' })).toBeNull();
    // Should not render as a portal modal — verify outer container isn't fixed
    const fixedModal = document.querySelector('.fixed.inset-0.z-50.bg-black');
    expect(fixedModal).toBeNull();
  });

  it('triggers onClose when modal close clicked', async () => {
    const onClose = vi.fn();
    render(<IIIFViewer modal onClose={onClose} imageUrl="http://x/i.png" />);
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows loading state while initializing', async () => {
    render(<IIIFViewer imageUrl="http://x/i.png" />);
    expect(screen.getByText('Loading viewer...')).toBeInTheDocument();
  });

  it('handles failed manifest fetch with network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as never;
    render(<IIIFViewer manifestUrl="http://x/manifest.json" />);
    expect(await screen.findByText('Failed to load image')).toBeInTheDocument();
  });

  it('handles non-OK manifest response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never;
    render(<IIIFViewer manifestUrl="http://x/manifest.json" />);
    expect(await screen.findByText('Failed to load image')).toBeInTheDocument();
  });

  it('uses className prop in non-modal mode', async () => {
    const { container } = render(<IIIFViewer className="my-custom-cls" imageUrl="http://x/i.png" />);
    expect(container.querySelector('.my-custom-cls')).toBeInTheDocument();
  });
});
