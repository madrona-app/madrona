import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MinimalTopBar } from '../../components/MinimalTopBar';

const { useSidebarMock, toggleMobileOpenMock } = vi.hoisted(() => ({
  useSidebarMock: vi.fn(),
  toggleMobileOpenMock: vi.fn(),
}));

vi.mock('../../contexts/SidebarContext', () => ({
  useSidebar: useSidebarMock,
}));

vi.mock('../../components/ActiveContextIndicator', () => ({
  ActiveContextIndicator: () => <div data-testid="active-context-indicator">ctx</div>,
}));

vi.mock('../../components/navigation/ProductSwitcher', () => ({
  ProductSwitcher: () => <div data-testid="product-switcher">switcher</div>,
}));

vi.mock('../../components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell">bell</div>,
}));

describe('MinimalTopBar', () => {
  beforeEach(() => {
    useSidebarMock.mockReset();
    toggleMobileOpenMock.mockReset();
    useSidebarMock.mockReturnValue({
      isMobileOpen: false,
      toggleMobileOpen: toggleMobileOpenMock,
    });
  });

  it('renders the hamburger menu button', () => {
    render(<MinimalTopBar />);
    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
  });

  it('clicking the hamburger calls toggleMobileOpen', () => {
    render(<MinimalTopBar />);
    fireEvent.click(screen.getByLabelText('Open navigation menu'));
    expect(toggleMobileOpenMock).toHaveBeenCalled();
  });

  it('hamburger has aria-expanded reflecting mobile open state', () => {
    render(<MinimalTopBar />);
    const btn = screen.getByLabelText('Open navigation menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded becomes true when mobile drawer is open', () => {
    useSidebarMock.mockReturnValue({
      isMobileOpen: true,
      toggleMobileOpen: toggleMobileOpenMock,
    });
    render(<MinimalTopBar />);
    expect(
      screen.getByLabelText('Open navigation menu').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('renders ProductSwitcher', () => {
    render(<MinimalTopBar />);
    expect(screen.getByTestId('product-switcher')).toBeInTheDocument();
  });

  it('renders NotificationBell', () => {
    render(<MinimalTopBar />);
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('renders ActiveContextIndicator', () => {
    render(<MinimalTopBar />);
    expect(screen.getByTestId('active-context-indicator')).toBeInTheDocument();
  });

  it('renders inside a header element', () => {
    const { container } = render(<MinimalTopBar />);
    expect(container.querySelector('header')).not.toBeNull();
  });
});
