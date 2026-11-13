import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { checkA11y, formatViolations } from '../../a11y';
import { StatusDropdown } from '../../../components/exhibit/ExhibitionChecklistTab/StatusDropdown';

describe('StatusDropdown', () => {
  it('renders current status label closed', () => {
    render(
      <StatusDropdown currentStatus="todo" onStatusChange={vi.fn()} />,
    );
    expect(screen.getByText('To Do')).toBeInTheDocument();
  });

  it('aria-haspopup menu and aria-expanded starts false', () => {
    render(
      <StatusDropdown currentStatus="todo" onStatusChange={vi.fn()} />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the dropdown on click and shows all statuses', () => {
    render(
      <StatusDropdown currentStatus="todo" onStatusChange={vi.fn()} />,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    // Closed button shows one "To Do"; open dropdown adds second occurrence,
    // plus: In Progress, Blocked, Done, N/A
    expect(screen.getAllByText('To Do').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('invokes onStatusChange with the chosen status and closes the menu', () => {
    const onStatusChange = vi.fn();
    render(
      <StatusDropdown currentStatus="todo" onStatusChange={onStatusChange} />,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(screen.getByText('In Progress'));
    expect(onStatusChange).toHaveBeenCalledWith('in_progress');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not open when disabled', () => {
    render(
      <StatusDropdown
        currentStatus="done"
        onStatusChange={vi.fn()}
        disabled
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Dropdown items should not be rendered
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('closes when clicking outside the dropdown', () => {
    render(
      <div>
        <StatusDropdown currentStatus="todo" onStatusChange={vi.fn()} />
        <button data-testid="outside">outside</button>
      </div>,
    );
    const button = screen.getByRole('button', { name: /To Do/i });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports the menu button keyboard pattern and has no axe violations', async () => {
    const onStatusChange = vi.fn();
    const { container } = render(
      <StatusDropdown currentStatus="todo" onStatusChange={onStatusChange} label="Book shippers" />,
    );
    const button = screen.getByRole('button', { name: 'Book shippers: status To Do' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const checked = screen.getByRole('menuitemradio', { name: 'To Do' });
    expect(checked).toHaveAttribute('aria-checked', 'true');
    expect(checked).toHaveFocus();
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'In Progress' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
