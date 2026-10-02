import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MapEditor,
  MapRenderer,
} from '../../../pages/content/components/blocks/MapBlock';

describe('MapEditor', () => {
  it('renders lat/lng/zoom/marker inputs with defaults', () => {
    render(<MapEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('40.7794')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('-73.9632')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Metropolitan/i)).toBeInTheDocument();
  });

  it('emits onChange when lat is edited', () => {
    const onChange = vi.fn();
    render(<MapEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('40.7794'), {
      target: { value: '34.05' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 34.05 }),
    );
  });

  it('clamps zoom level to allowed range', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MapEditor content={{ zoom: 15 }} onChange={onChange} />,
    );
    const numInputs = container.querySelectorAll('input[type="number"]');
    // Inputs: lat, lng, zoom (3rd)
    fireEvent.change(numInputs[2], { target: { value: '99' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 19 }),
    );
  });

  it('emits onChange for marker label', () => {
    const onChange = vi.fn();
    render(<MapEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Metropolitan/i), {
      target: { value: 'Visit Us' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ marker_label: 'Visit Us' }),
    );
  });
});

describe('MapRenderer', () => {
  it('renders nothing when lat/lng are zero', () => {
    const { container } = render(
      <MapRenderer content={{ lat: 0, lng: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an iframe and marker label', () => {
    const { container } = render(
      <MapRenderer content={{ lat: 40.7794, lng: -73.9632, marker_label: 'The Met' }} />,
    );
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(screen.getByText('The Met')).toBeInTheDocument();
  });

  it('renders a "View larger map" link', () => {
    render(
      <MapRenderer content={{ lat: 1.5, lng: 2.5, zoom: 12 }} />,
    );
    const link = screen.getByRole('link', { name: /View larger map/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('mlat=1.5'));
  });
});
