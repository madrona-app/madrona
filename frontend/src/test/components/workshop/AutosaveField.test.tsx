import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AutosaveField } from '../../../components/workshop/AutosaveField';

describe('AutosaveField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with initial value', () => {
    render(
      <AutosaveField value="hello" onChange={() => {}} onSave={async () => {}} />,
    );
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('renders the label and required indicator', () => {
    render(
      <AutosaveField
        value=""
        onChange={() => {}}
        onSave={async () => {}}
        label="Title"
        required
      />,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders helpText below the input', () => {
    render(
      <AutosaveField
        value=""
        onChange={() => {}}
        onSave={async () => {}}
        helpText="Use letters only"
      />,
    );
    expect(screen.getByText('Use letters only')).toBeInTheDocument();
  });

  it('renders a textarea when multiline=true', () => {
    const { container } = render(
      <AutosaveField value="x" onChange={() => {}} onSave={async () => {}} multiline />,
    );
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('typing fires onChange immediately', () => {
    const onChange = vi.fn();
    render(<AutosaveField value="" onChange={onChange} onSave={async () => {}} />);
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('triggers onSave after debounce delay', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutosaveField value="" onChange={() => {}} onSave={onSave} debounceMs={500} />);
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'new' } });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onSave).toHaveBeenCalledWith('new');
  });

  it('saves immediately on blur', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutosaveField value="old" onChange={() => {}} onSave={onSave} />);
    const input = screen.getByDisplayValue('old');
    fireEvent.change(input, { target: { value: 'new' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(onSave).toHaveBeenCalledWith('new');
  });

  it('does not call onSave when value is unchanged on blur', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutosaveField value="x" onChange={() => {}} onSave={onSave} />);
    await act(async () => {
      fireEvent.blur(screen.getByDisplayValue('x'));
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows error message when save throws', async () => {
    vi.useRealTimers();
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    render(<AutosaveField value="" onChange={() => {}} onSave={onSave} />);
    const input = screen.getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('respects disabled prop', () => {
    render(
      <AutosaveField
        value="x"
        onChange={() => {}}
        onSave={async () => {}}
        disabled
      />,
    );
    const input = screen.getByDisplayValue('x') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('uses the supplied input type', () => {
    render(
      <AutosaveField
        value="2024-01-01"
        onChange={() => {}}
        onSave={async () => {}}
        type="date"
      />,
    );
    const input = screen.getByDisplayValue('2024-01-01') as HTMLInputElement;
    expect(input.type).toBe('date');
  });

  it('syncs local value when prop changes externally', () => {
    const { rerender } = render(
      <AutosaveField value="a" onChange={() => {}} onSave={async () => {}} />,
    );
    expect(screen.getByDisplayValue('a')).toBeInTheDocument();
    rerender(<AutosaveField value="b" onChange={() => {}} onSave={async () => {}} />);
    expect(screen.getByDisplayValue('b')).toBeInTheDocument();
  });

  it('renders the placeholder', () => {
    render(
      <AutosaveField
        value=""
        onChange={() => {}}
        onSave={async () => {}}
        placeholder="Type here"
      />,
    );
    expect(screen.getByPlaceholderText('Type here')).toBeInTheDocument();
  });
});
