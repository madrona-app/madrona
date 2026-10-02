import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '../../contexts/SidebarContext';

const STORAGE_KEY = 'madrona.sidebar.collapsed';
const SECTIONS_KEY = 'madrona.sidebar.sections';

function wrapper({ children }: { children: React.ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

describe('SidebarContext', () => {
  beforeEach(() => {
    localStorage.clear();
    // Default to a desktop-ish viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1280,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders children', () => {
    render(
      <SidebarProvider>
        <div data-testid="child">content</div>
      </SidebarProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('content');
  });

  it('initializes with default state on desktop', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.isMobileOpen).toBe(false);
    expect(result.current.expandedSections).toBeInstanceOf(Set);
    expect(result.current.expandedSections.size).toBe(0);
  });

  it('reads collapsed state from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isCollapsed).toBe(true);
  });

  it('reads expanded sections from localStorage', () => {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(['care', 'transactions']));
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.expandedSections.has('care')).toBe(true);
    expect(result.current.expandedSections.has('transactions')).toBe(true);
  });

  it('handles malformed expanded-sections JSON gracefully', () => {
    localStorage.setItem(SECTIONS_KEY, 'not json{');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.expandedSections.size).toBe(0);
  });

  it('toggleCollapsed flips isCollapsed', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isCollapsed).toBe(false);
    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.isCollapsed).toBe(true);
    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.isCollapsed).toBe(false);
  });

  it('setCollapsed sets the value directly', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.setCollapsed(true);
    });
    expect(result.current.isCollapsed).toBe(true);
  });

  it('persists collapsed state to localStorage', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.setCollapsed(true);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('toggleMobileOpen flips isMobileOpen', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.toggleMobileOpen();
    });
    expect(result.current.isMobileOpen).toBe(true);
    act(() => {
      result.current.toggleMobileOpen();
    });
    expect(result.current.isMobileOpen).toBe(false);
  });

  it('setMobileOpen sets the value directly', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.setMobileOpen(true);
    });
    expect(result.current.isMobileOpen).toBe(true);
  });

  it('toggleSection adds a section when not present', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.toggleSection('care');
    });
    expect(result.current.isSectionExpanded('care')).toBe(true);
  });

  it('toggleSection removes a section when present', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.toggleSection('care');
    });
    expect(result.current.isSectionExpanded('care')).toBe(true);
    act(() => {
      result.current.toggleSection('care');
    });
    expect(result.current.isSectionExpanded('care')).toBe(false);
  });

  it('isSectionExpanded returns false for unknown section', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.isSectionExpanded('nonexistent')).toBe(false);
  });

  it('persists expanded sections to localStorage', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.toggleSection('care');
    });
    const stored = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '[]');
    expect(stored).toContain('care');
  });

  it('throws when useSidebar called outside provider', () => {
    expect(() => renderHook(() => useSidebar())).toThrow(
      /useSidebar must be used within a SidebarProvider/
    );
  });

  it('Escape key closes mobile drawer when open', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => {
      result.current.setMobileOpen(true);
    });
    expect(result.current.isMobileOpen).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.isMobileOpen).toBe(false);
  });
});
