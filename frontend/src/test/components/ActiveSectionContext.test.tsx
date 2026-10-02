import { describe, it, expect } from 'vitest';
import { render, renderHook, act, screen } from '@testing-library/react';
import {
  ActiveSectionProvider,
  useActiveSection,
  useActiveSectionRequired,
} from '../../components/record-detail/ActiveSectionContext';

function Consumer() {
  const ctx = useActiveSection();
  return (
    <div>
      <span data-testid="active">{ctx?.activeSection ?? 'none'}</span>
      <button onClick={() => ctx?.setActiveSection('identification')}>
        Set
      </button>
    </div>
  );
}

describe('ActiveSectionContext', () => {
  it('useActiveSection returns null outside of provider', () => {
    const { result } = renderHook(() => useActiveSection());
    expect(result.current).toBeNull();
  });

  it('Provider supplies initial empty activeSection', () => {
    render(
      <ActiveSectionProvider>
        <Consumer />
      </ActiveSectionProvider>
    );
    expect(screen.getByTestId('active')).toHaveTextContent('');
  });

  it('setActiveSection updates context value', () => {
    render(
      <ActiveSectionProvider>
        <Consumer />
      </ActiveSectionProvider>
    );
    act(() => {
      screen.getByText('Set').click();
    });
    expect(screen.getByTestId('active')).toHaveTextContent('identification');
  });

  it('useActiveSectionRequired throws when not inside provider', () => {
    // Suppress React error boundary console output for this expected throw
    expect(() => {
      renderHook(() => useActiveSectionRequired());
    }).toThrow(/must be used within ActiveSectionProvider/);
  });

  it('useActiveSectionRequired returns context when inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ActiveSectionProvider>{children}</ActiveSectionProvider>
    );
    const { result } = renderHook(() => useActiveSectionRequired(), { wrapper });
    expect(result.current.activeSection).toBe('');
    expect(typeof result.current.setActiveSection).toBe('function');
  });

  it('setActiveSection retains stable identity across renders', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ActiveSectionProvider>{children}</ActiveSectionProvider>
    );
    const { result, rerender } = renderHook(() => useActiveSectionRequired(), {
      wrapper,
    });
    const firstSetter = result.current.setActiveSection;
    rerender();
    expect(result.current.setActiveSection).toBe(firstSetter);
  });
});
