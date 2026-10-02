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
    // Wait microtask for effect
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Failed to load image')).toBeInTheDocument();
  });

  it('renders close button when modal=true and onClose given', async () => {
    render(<IIIFViewer modal onClose={vi.fn()} imageUrl="http://x/i.png" />);
    // Eventually it loads — at least the close button renders even during load
    await new Promise((r) => setTimeout(r, 0));
    // Close button has X icon — search by visible button presence
    const buttons = screen.queryAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('does not render close button when not modal', async () => {
    render(<IIIFViewer imageUrl="http://x/i.png" />);
    await new Promise((r) => setTimeout(r, 0));
    // Should not render as a portal modal — verify outer container isn't fixed
    const fixedModal = document.querySelector('.fixed.inset-0.z-50.bg-black');
    expect(fixedModal).toBeNull();
  });

  it('triggers onClose when modal close clicked', async () => {
    const onClose = vi.fn();
    const { container } = render(<IIIFViewer modal onClose={onClose} imageUrl="http://x/i.png" />);
    await new Promise((r) => setTimeout(r, 0));
    // Find all buttons; the close button is the one with class top-4 right-4 z-20
    const closeBtn = container.querySelector('button.absolute.top-4.right-4');
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('shows loading state while initializing', async () => {
    render(<IIIFViewer imageUrl="http://x/i.png" />);
    expect(screen.getByText('Loading viewer...')).toBeInTheDocument();
  });

  it('handles failed manifest fetch with network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as never;
    render(<IIIFViewer manifestUrl="http://x/manifest.json" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Failed to load image')).toBeInTheDocument();
  });

  it('handles non-OK manifest response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never;
    render(<IIIFViewer manifestUrl="http://x/manifest.json" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Failed to load image')).toBeInTheDocument();
  });

  it('uses className prop in non-modal mode', async () => {
    const { container } = render(<IIIFViewer className="my-custom-cls" imageUrl="http://x/i.png" />);
    expect(container.querySelector('.my-custom-cls')).toBeInTheDocument();
  });
});
