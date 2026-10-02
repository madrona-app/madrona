import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeasurementsField } from '../../../../components/collections/ObjectFieldComponents/MeasurementsField';

function defaults(o: Partial<Parameters<typeof MeasurementsField>[0]> = {}) {
  return {
    measurements: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('MeasurementsField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<MeasurementsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders measurements in view mode', () => {
    render(
      <MeasurementsField
        {...defaults({
          measurements: [
            { dimension: 'Height', value: 30, unit: 'cm', part: null },
            { dimension: 'Width', value: 20, unit: 'cm', part: null },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Height: 30 cm/)).toBeInTheDocument();
    expect(screen.getByText(/Width: 20 cm/)).toBeInTheDocument();
  });

  it('renders Add button in edit mode', () => {
    render(<MeasurementsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add measurement')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<MeasurementsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add measurement'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows empty state in edit mode', () => {
    render(<MeasurementsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No measurements added')).toBeInTheDocument();
  });

  it('shows missing-dimension warning when dimension is empty', () => {
    render(
      <MeasurementsField
        {...defaults({
          isEditing: true,
          measurements: [{ dimension: '', value: 10, unit: 'cm', part: null }],
        })}
      />,
    );
    expect(screen.getByText(/Select a dimension to save/i)).toBeInTheDocument();
  });

  it('changing the value triggers onChange and onSave', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <MeasurementsField
        {...defaults({
          isEditing: true,
          measurements: [{ dimension: 'Height', value: 1, unit: 'cm', part: null }],
          onChange,
          onSave,
        })}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith([
      { dimension: 'Height', value: 2.5, unit: 'cm', part: null },
    ]);
    expect(onSave).toHaveBeenCalled();
  });

  it('removing a row updates the array', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <MeasurementsField
        {...defaults({
          isEditing: true,
          measurements: [
            { dimension: 'Height', value: 1, unit: 'cm', part: null },
            { dimension: 'Width', value: 2, unit: 'cm', part: null },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    // Find delete buttons (the buttons that aren't the "Add measurement" button)
    const buttons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add measurement'),
    );
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith([
      { dimension: 'Width', value: 2, unit: 'cm', part: null },
    ]);
  });
});
