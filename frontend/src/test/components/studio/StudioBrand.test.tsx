import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudioWordmark } from '../../../components/studio/StudioWordmark';
import { StudioAvatar } from '../../../components/studio/StudioAvatar';
import { StudioSessionHeader } from '../../../components/studio/StudioSessionHeader';
import { StudioAttribution } from '../../../components/studio/StudioAttribution';
import { GuideWordmark } from '../../../components/studio/GuideWordmark';
import { StudioLauncherCard } from '../../../components/studio/StudioLauncherCard';

describe('StudioWordmark', () => {
  it('renders the short form "Studio" in copper, roman (not italic)', () => {
    render(<StudioWordmark />);
    const studio = screen.getByText('Studio');
    expect(studio).toHaveClass('not-italic');
    // Outer span carries the brand color + display face.
    const root = studio.parentElement!;
    expect(root).toHaveClass('text-copper');
    expect(root).toHaveClass('font-display');
    expect(root).not.toHaveClass('text-bark');
  });

  it('full lockup sets "Guide" italic and "Studio" roman (voice vs production)', () => {
    render(<StudioWordmark variant="full" />);
    expect(screen.getByText('Guide')).toHaveClass('italic');
    expect(screen.getByText('Studio')).toHaveClass('not-italic');
  });

  it('muted variant uses bark (muted copper) for high-density contexts', () => {
    render(<StudioWordmark muted />);
    const root = screen.getByText('Studio').parentElement!;
    expect(root).toHaveClass('text-bark');
    expect(root).not.toHaveClass('text-copper');
  });
});

describe('StudioAvatar', () => {
  it('renders a labeled "S" mark in the display face', () => {
    render(<StudioAvatar />);
    const avatar = screen.getByRole('img', { name: 'Studio' });
    expect(avatar).toHaveClass('bg-forest');
    expect(avatar).toHaveClass('text-copper');
    expect(avatar).toHaveClass('font-display');
    expect(avatar).toHaveTextContent('S');
  });

  it('scales the letter with the circle and accepts a custom label', () => {
    render(<StudioAvatar size={48} title="Guide Studio" />);
    const avatar = screen.getByRole('img', { name: 'Guide Studio' });
    expect(avatar).toHaveStyle({ width: '48px', height: '48px' });
    const letter = avatar.querySelector('span')!;
    expect(letter).toHaveStyle({ fontSize: '29px' }); // round(48 * 0.6)
  });
});

describe('StudioSessionHeader', () => {
  it('renders the status label and the avatar', () => {
    render(<StudioSessionHeader label="Currently drafting" />);
    expect(screen.getByText('Currently drafting')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Studio' })).toBeInTheDocument();
  });

  it('renders the agent count + roles as mono metadata', () => {
    render(
      <StudioSessionHeader label="Currently drafting" agentCount={2} roles={['Registrar', 'Conservator']} />,
    );
    const meta = screen.getByText('2 agents · Registrar, Conservator');
    expect(meta).toHaveClass('font-mono');
  });

  it('singularizes one agent', () => {
    render(<StudioSessionHeader label="x" agentCount={1} roles={['Registrar']} />);
    expect(screen.getByText('1 agent · Registrar')).toBeInTheDocument();
  });

  it('omits the meta line when no count is given', () => {
    render(<StudioSessionHeader label="Awaiting your input" />);
    expect(screen.queryByText(/agent/)).not.toBeInTheDocument();
  });
});

describe('GuideWordmark', () => {
  it('renders "Guide" in copper, italic (voice — vs Studio roman)', () => {
    render(<GuideWordmark />);
    const el = screen.getByText('Guide');
    expect(el).toHaveClass('italic');
    expect(el).toHaveClass('text-copper');
    expect(el).toHaveClass('font-display');
  });

  it('muted variant uses bark', () => {
    render(<GuideWordmark muted />);
    const el = screen.getByText('Guide');
    expect(el).toHaveClass('text-bark');
    expect(el).not.toHaveClass('text-copper');
  });
});

describe('StudioLauncherCard', () => {
  it('renders the forest card with the parchment wordmark + descriptor', () => {
    render(<StudioLauncherCard descriptor="Studio drafts records for review." />);
    const card = screen.getByRole('note', { name: 'Studio' });
    expect(card).toHaveClass('bg-forest');
    const wordmark = screen.getByText('Studio');
    expect(wordmark).toHaveClass('text-parchment'); // parchment on dark, not copper
    expect(wordmark).toHaveClass('font-display');
    expect(screen.getByText('Studio drafts records for review.')).toBeInTheDocument();
  });
});

describe('StudioAttribution', () => {
  it('names Studio as the actor with the active verb', () => {
    render(<StudioAttribution />);
    expect(screen.getByText('Drafted by Studio')).toBeInTheDocument();
  });

  it('composes reviewer and approval into operational metadata', () => {
    render(<StudioAttribution reviewedBy="A. Curator" decidedAt="Apr 3" />);
    expect(
      screen.getByText('Drafted by Studio · reviewed by A. Curator · approved Apr 3'),
    ).toBeInTheDocument();
  });
});
