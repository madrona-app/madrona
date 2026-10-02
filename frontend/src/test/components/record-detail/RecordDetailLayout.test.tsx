import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RecordDetailLayout, useRecordDetailLayout } from '../../../components/record-detail/RecordDetailLayout';

function ContextProbe() {
  const { isSectionNavCollapsed, isRailCollapsed, setSectionNavCollapsed, setRailCollapsed } =
    useRecordDetailLayout();
  return (
    <div>
      <span data-testid="nav">{String(isSectionNavCollapsed)}</span>
      <span data-testid="rail">{String(isRailCollapsed)}</span>
      <button onClick={() => setSectionNavCollapsed(!isSectionNavCollapsed)}>toggle-nav</button>
      <button onClick={() => setRailCollapsed(!isRailCollapsed)}>toggle-rail</button>
    </div>
  );
}

describe('RecordDetailLayout', () => {
  it('renders children inside the layout', () => {
    render(
      <RecordDetailLayout>
        <div>child content</div>
      </RecordDetailLayout>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('adds the body class on mount and removes on unmount', () => {
    const { unmount } = render(
      <RecordDetailLayout>
        <div />
      </RecordDetailLayout>,
    );
    expect(document.body.classList.contains('has-record-detail-layout')).toBe(true);
    unmount();
    expect(document.body.classList.contains('has-record-detail-layout')).toBe(false);
  });

  it('starts with section nav not collapsed by default', () => {
    render(
      <RecordDetailLayout>
        <ContextProbe />
      </RecordDetailLayout>,
    );
    expect(screen.getByTestId('nav')).toHaveTextContent('false');
  });

  it('respects initialRailCollapsed', () => {
    render(
      <RecordDetailLayout initialRailCollapsed>
        <ContextProbe />
      </RecordDetailLayout>,
    );
    expect(screen.getByTestId('rail')).toHaveTextContent('true');
  });

  it('toggles section nav state via context', () => {
    render(
      <RecordDetailLayout>
        <ContextProbe />
      </RecordDetailLayout>,
    );
    act(() => {
      screen.getByText('toggle-nav').click();
    });
    expect(screen.getByTestId('nav')).toHaveTextContent('true');
  });

  it('toggles rail state via context', () => {
    render(
      <RecordDetailLayout>
        <ContextProbe />
      </RecordDetailLayout>,
    );
    act(() => {
      screen.getByText('toggle-rail').click();
    });
    expect(screen.getByTestId('rail')).toHaveTextContent('true');
  });

  it('throws when useRecordDetailLayout is called outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ContextProbe />)).toThrow();
    spy.mockRestore();
  });

  it('applies layout classes on the wrapping div', () => {
    const { container } = render(
      <RecordDetailLayout className="extra">
        <ContextProbe />
      </RecordDetailLayout>,
    );
    const wrap = container.querySelector('.record-detail-layout') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.className).toContain('extra');
  });

  it('applies nav-collapsed class when section nav is collapsed', () => {
    const { container } = render(
      <RecordDetailLayout>
        <ContextProbe />
      </RecordDetailLayout>,
    );
    act(() => {
      screen.getByText('toggle-nav').click();
    });
    expect(container.querySelector('.record-detail-layout--nav-collapsed')).not.toBeNull();
  });
});

import { vi } from 'vitest';
