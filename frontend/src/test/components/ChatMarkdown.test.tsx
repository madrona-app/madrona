import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatMarkdown } from '../../components/ui/ChatMarkdown';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderMd(text: string, isStreaming = false) {
  return render(
    <MemoryRouter>
      <ChatMarkdown text={text} isStreaming={isStreaming} />
    </MemoryRouter>,
  );
}

describe('ChatMarkdown', () => {
  it('renders plain text in a paragraph', async () => {
    renderMd('hello world');
    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('renders bold strong text', async () => {
    renderMd('**bold**');
    const strong = await screen.findByText('bold');
    expect(strong.tagName).toBe('STRONG');
  });

  it('renders unordered list items', async () => {
    renderMd('- a\n- b');
    expect(await screen.findByText('a')).toBeInTheDocument();
    expect(await screen.findByText('b')).toBeInTheDocument();
  });

  it('renders ordered list items', async () => {
    renderMd('1. one\n2. two');
    expect(await screen.findByText('one')).toBeInTheDocument();
    expect(await screen.findByText('two')).toBeInTheDocument();
  });

  it('renders inline code', async () => {
    renderMd('Use `npm install` to install');
    const code = await screen.findByText('npm install');
    expect(code.tagName).toBe('CODE');
  });

  it('renders external links with target=_blank', async () => {
    renderMd('See [external](https://example.com) for more');
    const link = await screen.findByRole('link', { name: 'external' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('clicks on internal links call navigate instead of full reload', async () => {
    renderMd('Go [home](/dashboard)');
    const link = await screen.findByRole('link', { name: 'home' });
    fireEvent.click(link);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('hides incomplete trailing markdown links while streaming', async () => {
    const { container } = renderMd('Hello [click', true);
    await waitFor(() => {
      expect(container.textContent).toContain('Hello');
    });
    expect(container.textContent).not.toContain('[click');
  });

  it('shows complete links when not streaming', async () => {
    renderMd('See [the docs](https://x.com)', false);
    const link = await screen.findByRole('link', { name: 'the docs' });
    expect(link).toBeInTheDocument();
  });

  it('renders block code with language class', async () => {
    renderMd('```javascript\nconst x = 1;\n```');
    expect(await screen.findByText(/const x = 1/)).toBeInTheDocument();
  });
});
