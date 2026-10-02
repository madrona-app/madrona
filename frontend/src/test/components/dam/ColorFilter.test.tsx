import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorFilter } from '../../../components/dam/ColorFilter';

describe('ColorFilter', () => {
  const defaultProps = {
    selectedColor: null as string | null,
    onColorSelect: vi.fn(),
  };

  it('renders 12 color swatches', () => {
    render(<ColorFilter {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    // 12 color swatches, no clear button when nothing selected
    expect(buttons).toHaveLength(12);
  });

  it('calls onColorSelect with color key on click', () => {
    const onColorSelect = vi.fn();
    render(<ColorFilter {...defaultProps} onColorSelect={onColorSelect} />);
    const redButton = screen.getByTitle('Red');
    fireEvent.click(redButton);
    expect(onColorSelect).toHaveBeenCalledWith('r');
  });

  it('calls onColorSelect with null when clicking selected color', () => {
    const onColorSelect = vi.fn();
    render(<ColorFilter selectedColor="r" onColorSelect={onColorSelect} />);
    const redButton = screen.getByTitle('Red');
    fireEvent.click(redButton);
    expect(onColorSelect).toHaveBeenCalledWith(null);
  });

  it('applies active style to selected swatch', () => {
    render(<ColorFilter selectedColor="b" onColorSelect={vi.fn()} />);
    const blueButton = screen.getByTitle('Blue');
    expect(blueButton.className).toContain('border-bark');
  });

  it('shows clear button when color is selected', () => {
    render(<ColorFilter selectedColor="g" onColorSelect={vi.fn()} />);
    expect(screen.getByText(/Clear color filter/)).toBeInTheDocument();
  });

  it('hides clear button when no color selected', () => {
    render(<ColorFilter {...defaultProps} />);
    expect(screen.queryByText('Clear color filter')).not.toBeInTheDocument();
  });
});
