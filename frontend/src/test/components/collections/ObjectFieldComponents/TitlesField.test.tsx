import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitlesField } from '../../../../components/collections/ObjectFieldComponents/TitlesField';

function defaults(o: Partial<Parameters<typeof TitlesField>[0]> = {}) {
  return {
    titles: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('TitlesField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<TitlesField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders titles in a table in view mode', () => {
    render(
      <TitlesField
        {...defaults({
          titles: [
            { title: 'Sunset', is_preferred: true, title_type: 'preferred', language: 'en' },
            { title: 'Couché de soleil', is_preferred: false, title_type: 'alternate', language: 'fr' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Sunset')).toBeInTheDocument();
    expect(screen.getByText('Couché de soleil')).toBeInTheDocument();
  });

  it('marks the preferred title with (display) hint', () => {
    render(
      <TitlesField
        {...defaults({
          titles: [
            { title: 'Display Title', is_preferred: true, title_type: null, language: null },
          ],
        })}
      />,
    );
    expect(screen.getByText('(display)')).toBeInTheDocument();
  });

  it('renders Add title button in edit mode', () => {
    render(<TitlesField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add title')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<TitlesField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add title'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows empty state in edit mode', () => {
    render(<TitlesField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No titles added yet')).toBeInTheDocument();
  });

  it('changing the radio button to a different title sets it as preferred', () => {
    const onChange = vi.fn();
    render(
      <TitlesField
        {...defaults({
          isEditing: true,
          titles: [
            { title: 'A', is_preferred: true, title_type: null, language: null },
            { title: 'B', is_preferred: false, title_type: null, language: null },
          ],
          onChange,
        })}
      />,
    );
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]);
    const newTitles = onChange.mock.calls[0][0] as Array<{ is_preferred: boolean }>;
    expect(newTitles[0].is_preferred).toBe(false);
    expect(newTitles[1].is_preferred).toBe(true);
  });

  it('typing in the title input updates onChange', () => {
    const onChange = vi.fn();
    render(
      <TitlesField
        {...defaults({
          isEditing: true,
          titles: [{ title: 'old', is_preferred: true, title_type: null, language: null }],
          onChange,
        })}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('removing a title fires onChange with filtered list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <TitlesField
        {...defaults({
          isEditing: true,
          titles: [
            { title: 'a', is_preferred: true, title_type: null, language: null },
            { title: 'b', is_preferred: false, title_type: null, language: null },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add title'),
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
  });
});
