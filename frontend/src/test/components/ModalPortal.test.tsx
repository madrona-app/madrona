import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModalPortal } from '../../components/ModalPortal';

describe('ModalPortal', () => {
  it('renders children into document.body', () => {
    render(
      <ModalPortal>
        <div data-testid="portal-content">portal child</div>
      </ModalPortal>,
    );
    const child = screen.getByTestId('portal-content');
    expect(child).toBeInTheDocument();
    // The child should not be inside the React-test-utils wrapper, but in document.body
    expect(document.body.contains(child)).toBe(true);
  });

  it('renders multiple children', () => {
    render(
      <ModalPortal>
        <span data-testid="a">A</span>
        <span data-testid="b">B</span>
      </ModalPortal>,
    );
    expect(screen.getByTestId('a')).toHaveTextContent('A');
    expect(screen.getByTestId('b')).toHaveTextContent('B');
  });

  it('renders text nodes', () => {
    render(<ModalPortal>just text</ModalPortal>);
    expect(screen.getByText('just text')).toBeInTheDocument();
  });

  it('removes portal content from DOM on unmount', () => {
    const { unmount } = render(
      <ModalPortal>
        <div data-testid="cleanup-target">bye</div>
      </ModalPortal>,
    );
    expect(screen.queryByTestId('cleanup-target')).toBeInTheDocument();
    unmount();
    expect(screen.queryByTestId('cleanup-target')).toBeNull();
  });

  it('preserves child element attributes', () => {
    render(
      <ModalPortal>
        <button type="button" aria-label="test-btn" data-testid="b">click</button>
      </ModalPortal>,
    );
    const btn = screen.getByTestId('b');
    expect(btn.getAttribute('aria-label')).toBe('test-btn');
    expect(btn.tagName).toBe('BUTTON');
  });
});
