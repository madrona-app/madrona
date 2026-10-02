import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MadronaLoader, MadronaProgressBar } from '../../../components/ui/MadronaLoader';

describe('MadronaLoader', () => {
  it('renders default primary variant with a status role', () => {
    render(<MadronaLoader />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses "Loading" as the default aria-label', () => {
    render(<MadronaLoader />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('uses the custom label as both aria-label and visible text', () => {
    render(<MadronaLoader label="Fetching data" />);
    expect(screen.getByLabelText('Fetching data')).toBeInTheDocument();
    expect(screen.getByText('Fetching data')).toBeInTheDocument();
  });

  it('renders the dots variant with three dots', () => {
    const { container } = render(<MadronaLoader variant="dots" />);
    const dots = container.querySelectorAll('.animate-madrona-pulse');
    expect(dots.length).toBe(3);
  });

  it('renders inline variant with a label', () => {
    render(<MadronaLoader variant="inline" label="Saving" />);
    expect(screen.getByText('Saving')).toBeInTheDocument();
    expect(screen.getByLabelText('Saving')).toBeInTheDocument();
  });

  it('renders overlay variant with proper backdrop classes', () => {
    const { container } = render(<MadronaLoader variant="overlay" />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('inset-0');
  });

  it('applies a custom className wrapper', () => {
    const { container } = render(<MadronaLoader className="my-loader" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('my-loader');
  });

  it('omits the visible label span when label is not provided', () => {
    const { container } = render(<MadronaLoader />);
    // No <span> elements when no label is given
    expect(container.querySelector('span')).toBeNull();
  });
});

describe('MadronaProgressBar', () => {
  it('renders with role="progressbar" and clamped value', () => {
    render(<MadronaProgressBar value={42} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('shows the percent text', () => {
    render(<MadronaProgressBar value={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('clamps values above 100', () => {
    render(<MadronaProgressBar value={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('clamps negative values to 0', () => {
    render(<MadronaProgressBar value={-10} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders the optional label', () => {
    render(<MadronaProgressBar value={30} label="Uploading" />);
    expect(screen.getByText('Uploading')).toBeInTheDocument();
  });

  it('applies the custom className', () => {
    const { container } = render(
      <MadronaProgressBar value={20} className="custom-bar" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('custom-bar');
  });
});
