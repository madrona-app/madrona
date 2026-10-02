import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Folder } from 'lucide-react';
import { SectionGroupDivider } from '../../../components/workspace/SectionGroupDivider';

describe('SectionGroupDivider', () => {
  it('renders the label text', () => {
    render(<SectionGroupDivider label="Identification" />);
    expect(screen.getByText('Identification')).toBeInTheDocument();
  });

  it('renders without an icon when none is supplied', () => {
    const { container } = render(<SectionGroupDivider label="No Icon" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the supplied icon', () => {
    const { container } = render(<SectionGroupDivider label="With Icon" icon={Folder} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses role="separator"', () => {
    render(<SectionGroupDivider label="Sep" />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <SectionGroupDivider label="X" className="custom-divider-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-divider-class');
  });

  it('uses uppercase tracking style on the label', () => {
    render(<SectionGroupDivider label="Cool" />);
    const label = screen.getByText('Cool');
    expect(label.className).toContain('uppercase');
    expect(label.className).toContain('tracking-wider');
  });

  it('renders a divider line element', () => {
    const { container } = render(<SectionGroupDivider label="X" />);
    expect(container.querySelector('.border-t')).not.toBeNull();
  });
});
