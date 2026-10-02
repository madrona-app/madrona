import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock matchMedia
let mockMatchesDark = false;
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

Object.defineProperty(window, 'matchMedia', {
  value: vi.fn(() => ({
    matches: mockMatchesDark,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  })),
});

// Test component
function ThemeConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockMatchesDark = false;
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('useTheme hook', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ThemeConsumer />);
      }).toThrow('useTheme must be used within a ThemeProvider');

      spy.mockRestore();
    });

    it('returns context when used inside provider', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toBeInTheDocument();
    });
  });

  describe('ThemeProvider', () => {
    describe('initialization', () => {
      it('defaults to system theme when no localStorage value', () => {
        localStorageMock.getItem.mockReturnValue(null);

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('system');
      });

      it('restores light theme from localStorage', () => {
        localStorageMock.getItem.mockReturnValue('light');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('light');
      });

      it('restores dark theme from localStorage', () => {
        localStorageMock.getItem.mockReturnValue('dark');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      });

      it('restores system theme from localStorage', () => {
        localStorageMock.getItem.mockReturnValue('system');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('system');
      });

      it('defaults to system for invalid localStorage value', () => {
        localStorageMock.getItem.mockReturnValue('invalid');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('system');
      });
    });

    describe('setTheme', () => {
      it('updates theme to light', async () => {
        const user = userEvent.setup();

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Light'));

        expect(screen.getByTestId('theme')).toHaveTextContent('light');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('madrona-theme', 'light');
      });

      it('updates theme to dark', async () => {
        const user = userEvent.setup();

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Dark'));

        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('madrona-theme', 'dark');
      });

      it('updates theme to system', async () => {
        const user = userEvent.setup();
        localStorageMock.getItem.mockReturnValue('light');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set System'));

        expect(screen.getByTestId('theme')).toHaveTextContent('system');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('madrona-theme', 'system');
      });
    });

    describe('resolvedTheme', () => {
      it('returns light when theme is light', async () => {
        const user = userEvent.setup();

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Light'));

        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
      });

      it('returns dark when theme is dark', async () => {
        const user = userEvent.setup();

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Dark'));

        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
      });

      it('returns light when theme is system and system is light', () => {
        mockMatchesDark = false;

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
      });

      it('returns dark when theme is system and system is dark', () => {
        mockMatchesDark = true;

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
      });
    });

    describe('document class', () => {
      it('adds dark class to document when resolved theme is dark', async () => {
        const user = userEvent.setup();

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Dark'));

        expect(document.documentElement.classList.contains('dark')).toBe(true);
      });

      it('removes dark class from document when resolved theme is light', async () => {
        const user = userEvent.setup();
        document.documentElement.classList.add('dark');

        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        await user.click(screen.getByText('Set Light'));

        expect(document.documentElement.classList.contains('dark')).toBe(false);
      });
    });

    describe('system color scheme listener', () => {
      it('subscribes to color scheme changes', () => {
        render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      });

      it('unsubscribes on unmount', () => {
        const { unmount } = render(
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        );

        unmount();

        expect(mockRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      });
    });
  });
});
