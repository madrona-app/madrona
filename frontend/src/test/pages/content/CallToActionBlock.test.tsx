import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CallToActionEditor,
  CallToActionRenderer,
} from '../../../pages/content/components/blocks/CallToActionBlock';

describe('CallToActionEditor', () => {
  it('renders heading + button text inputs', () => {
    render(<CallToActionEditor content={{}} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText('Call to action heading'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Learn More/i)).toBeInTheDocument();
  });

  it('updates heading via onChange', () => {
    const onChange = vi.fn();
    render(<CallToActionEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('Call to action heading'), {
      target: { value: 'Donate Now' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Donate Now' }),
    );
  });

  it('toggles style buttons', () => {
    const onChange = vi.fn();
    render(<CallToActionEditor content={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Secondary/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'secondary' }),
    );
  });
});

describe('CallToActionRenderer', () => {
  it('returns null when heading is missing', () => {
    const { container } = render(<CallToActionRenderer content={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders heading and button when provided', () => {
    render(
      <CallToActionRenderer
        content={{
          heading: 'Become a Member',
          text: 'Support our mission',
          button_text: 'Join',
          button_url: '/join',
          style: 'primary',
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Become a Member' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Join' });
    expect(link).toHaveAttribute('href', '/join');
  });

  it('omits the button when text or url is missing', () => {
    render(
      <CallToActionRenderer
        content={{ heading: 'Title only', button_text: 'X', button_url: '' }}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
