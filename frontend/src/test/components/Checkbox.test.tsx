import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import Checkbox, { CHECKBOX_CLASSES } from '../../components/Checkbox';

describe('Checkbox', () => {
  it('renders a checkbox input', () => {
    render(<Checkbox aria-label="agree" />);
    const input = screen.getByRole('checkbox', { name: 'agree' });
    expect(input).toHaveAttribute('type', 'checkbox');
  });

  it('applies the standard Madrona classes', () => {
    render(<Checkbox aria-label="agree" />);
    const input = screen.getByRole('checkbox', { name: 'agree' });
    expect(input.className).toContain('form-checkbox');
    expect(input.className).toContain('text-bark');
    expect(input.className).toContain('border-stone');
  });

  it('merges custom className with standard classes', () => {
    render(<Checkbox aria-label="agree" className="custom-class" />);
    const input = screen.getByRole('checkbox', { name: 'agree' });
    expect(input.className).toContain('custom-class');
    expect(input.className).toContain('form-checkbox');
  });

  it('forwards the ref to the underlying input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="agree" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.type).toBe('checkbox');
  });

  it('calls onChange when toggled', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="agree" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('respects the checked prop', () => {
    render(<Checkbox aria-label="agree" checked readOnly />);
    expect(screen.getByRole('checkbox', { name: 'agree' })).toBeChecked();
  });

  it('respects the disabled prop', () => {
    render(<Checkbox aria-label="agree" disabled />);
    expect(screen.getByRole('checkbox', { name: 'agree' })).toBeDisabled();
  });

  it('exports the standard class string', () => {
    expect(CHECKBOX_CLASSES).toContain('form-checkbox');
    expect(CHECKBOX_CLASSES).toContain('text-bark');
  });

  it('sets the displayName for devtools', () => {
    expect(Checkbox.displayName).toBe('Checkbox');
  });

  it('passes arbitrary HTML attributes through', () => {
    render(<Checkbox aria-label="agree" data-testid="my-cb" name="terms" />);
    const input = screen.getByTestId('my-cb');
    expect(input).toHaveAttribute('name', 'terms');
  });
});
