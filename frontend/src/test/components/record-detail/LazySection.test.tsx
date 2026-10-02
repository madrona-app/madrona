import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  LazySection,
  shouldVirtualize,
  VIRTUALIZATION_THRESHOLDS,
} from '../../../components/record-detail/LazySection';

describe('LazySection', () => {
  it('renders children immediately when eager is true', () => {
    render(
      <LazySection eager>
        <p>Hello eager content</p>
      </LazySection>,
    );
    expect(screen.getByText('Hello eager content')).toBeInTheDocument();
  });

  it('renders a loading placeholder when not eager and not visible', () => {
    render(
      <LazySection>
        <p>Hidden content</p>
      </LazySection>,
    );
    // sr-only "Loading..." should be present in the placeholder
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    // The actual content should not have rendered yet (intersection observer not triggered)
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('applies a custom className when eager', () => {
    const { container } = render(
      <LazySection eager className="my-eager-class">
        <p>Eager body</p>
      </LazySection>,
    );
    expect(container.querySelector('.my-eager-class')).not.toBeNull();
  });

  it('respects custom minHeight on the placeholder container', () => {
    const { container } = render(
      <LazySection minHeight={250}>
        <p>Hidden</p>
      </LazySection>,
    );
    const wrapper = container.querySelector('.lazy-section') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Style should propagate through
    expect(wrapper?.style.minHeight).toBe('250px');
  });
});

describe('shouldVirtualize', () => {
  it('returns false when count is below the threshold', () => {
    expect(shouldVirtualize('relatedObjects', VIRTUALIZATION_THRESHOLDS.relatedObjects)).toBe(false);
    expect(shouldVirtualize('relatedObjects', 0)).toBe(false);
  });

  it('returns true when count exceeds the threshold', () => {
    expect(
      shouldVirtualize('relatedObjects', VIRTUALIZATION_THRESHOLDS.relatedObjects + 1),
    ).toBe(true);
  });

  it('uses different thresholds per list type', () => {
    expect(shouldVirtualize('citations', VIRTUALIZATION_THRESHOLDS.citations + 1)).toBe(true);
    expect(shouldVirtualize('mediaItems', VIRTUALIZATION_THRESHOLDS.mediaItems)).toBe(false);
  });
});
