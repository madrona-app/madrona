import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlideOver } from '../../components/ui/SlideOver';

function renderSlide(extra: Partial<React.ComponentProps<typeof SlideOver>> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <SlideOver isOpen onClose={onClose} title="My Panel" {...extra}>
        <p>panel body</p>
      </SlideOver>,
    ),
  };
}

describe('SlideOver', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <SlideOver isOpen={false} onClose={() => {}} title="X">
        body
      </SlideOver>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('is a modal dialog named by its title', () => {
    renderSlide();
    const dialog = screen.getByRole('dialog', { name: 'My Panel' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('is described by its subtitle when there is one', () => {
    renderSlide({ subtitle: 'A small descriptor' });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('A small descriptor');
  });

  it('has no description without a subtitle', () => {
    renderSlide();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('names each of two open panels by its own title', () => {
    render(
      <>
        <SlideOver isOpen onClose={() => {}} title="First">a</SlideOver>
        <SlideOver isOpen onClose={() => {}} title="Second">b</SlideOver>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'First' })).toHaveTextContent('a');
    expect(screen.getByRole('dialog', { name: 'Second' })).toHaveTextContent('b');
  });

  it('moves focus to the dialog when it opens', () => {
    renderSlide();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('renders the title', () => {
    renderSlide();
    expect(screen.getByText('My Panel')).toBeInTheDocument();
  });

  it('renders the subtitle when provided', () => {
    renderSlide({ subtitle: 'A small descriptor' });
    expect(screen.getByText('A small descriptor')).toBeInTheDocument();
  });

  it('renders the body content', () => {
    renderSlide();
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('renders the footer when provided', () => {
    renderSlide({ footer: <button>Save</button> });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('clicking the close button calls onClose', () => {
    const { onClose } = renderSlide();
    fireEvent.click(screen.getByText('Close panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('pressing Escape calls onClose', () => {
    const { onClose } = renderSlide();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose on Escape when a higher modal layer is present', () => {
    const { onClose } = renderSlide();
    const layer = document.createElement('div');
    layer.setAttribute('data-modal-layer', '1');
    document.body.appendChild(layer);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(layer);
  });

  it('locks body scroll while open', () => {
    renderSlide();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll on unmount', () => {
    const { unmount } = renderSlide();
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders panel via portal into document.body', () => {
    const { container } = renderSlide();
    // Container is the React-rendered fragment; the actual content lives in body
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.contains(screen.getByText('My Panel'))).toBe(true);
  });

  it('uses the supplied width class', () => {
    renderSlide({ width: 'xl' });
    expect(document.body.querySelector('.max-w-xl')).not.toBeNull();
  });
});
