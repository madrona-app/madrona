import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  NewsletterSignupEditor,
  NewsletterSignupRenderer,
} from '../../../pages/content/components/blocks/NewsletterSignupBlock';

describe('NewsletterSignupEditor', () => {
  it('renders the four input fields', () => {
    render(<NewsletterSignupEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Stay in the loop/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Subscribe to our newsletter/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\., Subscribe/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/mailchimp/i)).toBeInTheDocument();
  });

  it('emits heading edits', () => {
    const onChange = vi.fn();
    render(<NewsletterSignupEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Stay in the loop/i), {
      target: { value: 'Join us' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Join us' }),
    );
  });
});

describe('NewsletterSignupRenderer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders heading and subscribe button', () => {
    render(
      <NewsletterSignupRenderer
        content={{ heading: 'Subscribe', form_action_url: 'https://api.example.com' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Subscribe' })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows success state after submission', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });
    render(
      <NewsletterSignupRenderer
        content={{ form_action_url: 'https://api.example.com/subscribe' }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Enter your email/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter your email/i).closest('form')!);

    await waitFor(() => {
      expect(
        screen.getByText(/Thank you for subscribing/i),
      ).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/subscribe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows error message when fetch fails', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });
    render(
      <NewsletterSignupRenderer
        content={{ form_action_url: 'https://api.example.com/subscribe' }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Enter your email/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter your email/i).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Subscription failed/i)).toBeInTheDocument();
    });
  });
});
