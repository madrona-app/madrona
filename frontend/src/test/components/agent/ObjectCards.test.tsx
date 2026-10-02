import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObjectCards } from '../../../components/agent/ObjectCards';
import type { ObjectCardData } from '../../../components/agent/ObjectCards';

const CARDS: ObjectCardData[] = [
  {
    object_id: 'obj-1',
    object_number: 'MET-39799',
    title: 'Under the Wave off Kanagawa',
    creator: 'Katsushika Hokusai',
    date: 'ca. 1830',
    path: '/c/madrona-museum/objects/obj-1',
    thumbnail_url: 'https://cdn.example/thumb1.webp',
  },
  {
    object_id: 'obj-2',
    title: 'Untitled Vessel',
    path: '/c/madrona-museum/objects/obj-2',
    thumbnail_url: null,
  },
];

describe('ObjectCards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a card per object with title and maker/date meta', () => {
    render(<ObjectCards objects={CARDS} />);
    expect(screen.getByText('Under the Wave off Kanagawa')).toBeInTheDocument();
    expect(screen.getByText('Katsushika Hokusai · ca. 1830')).toBeInTheDocument();
    expect(screen.getByText('Untitled Vessel')).toBeInTheDocument();
  });

  it('renders a placeholder when there is no thumbnail', () => {
    render(<ObjectCards objects={[CARDS[1]]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<ObjectCards objects={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('expanding fetches the public detail and shows the description', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ full_description: 'The iconic woodblock print.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ObjectCards objects={[CARDS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /under the wave/i }));

    await waitFor(() => {
      expect(screen.getByText('The iconic woodblock print.')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/discover/madrona-museum/objects/obj-1'),
    );
    // Full record stays available as a secondary, new-tab link
    const link = screen.getByRole('link', { name: /full record/i });
    expect(link).toHaveAttribute('href', '/c/madrona-museum/objects/obj-1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('failed detail fetch degrades gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('nope')));
    render(<ObjectCards objects={[CARDS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /under the wave/i }));
    await waitFor(() => {
      expect(screen.getByText(/details unavailable/i)).toBeInTheDocument();
    });
  });
});
