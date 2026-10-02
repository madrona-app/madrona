import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPlayPause = vi.fn();
const mockDestroy = vi.fn();
const mockSetVolume = vi.fn();

vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => {
      const handlers: Record<string, () => void> = {};
      return {
        on: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
          // Fire 'ready' immediately so isReady becomes true and Play button is enabled
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        destroy: mockDestroy,
        playPause: mockPlayPause,
        setVolume: mockSetVolume,
        getDuration: () => 120,
      };
    }),
  },
}));

import AudioWaveformPlayer from '../../../components/media/AudioWaveformPlayer';

describe('AudioWaveformPlayer', () => {
  beforeEach(() => {
    mockPlayPause.mockClear();
    mockDestroy.mockClear();
    mockSetVolume.mockClear();
  });

  it('renders the play button', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('renders mute button', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    expect(screen.getByLabelText('Mute')).toBeInTheDocument();
  });

  it('renders volume slider with default 0.8', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    expect(slider.value).toBe('0.8');
  });

  it('shows initial 0:00 / 0:00 time when no duration', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument();
  });

  it('shows pre-known duration in time display', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" duration={185} />);
    expect(screen.getByText('0:00 / 3:05')).toBeInTheDocument();
  });

  it('triggers playPause when Play button clicked', async () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    // Wait for the ready handler to fire and the Play button to become enabled
    await waitFor(() => {
      const btn = screen.getByLabelText('Play') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByLabelText('Play'));
    expect(mockPlayPause).toHaveBeenCalled();
  });

  it('renders metadata chips', () => {
    render(
      <AudioWaveformPlayer
        url="http://x/a.mp3"
        metadata={{
          file_format: 'mp3',
          sample_rate: 44100,
          bitrate_kbps: 320,
          channels: 2,
        }}
      />,
    );
    expect(screen.getByText('mp3')).toBeInTheDocument();
    expect(screen.getByText('44.1 kHz')).toBeInTheDocument();
    expect(screen.getByText('320 kbps')).toBeInTheDocument();
    expect(screen.getByText('Stereo')).toBeInTheDocument();
  });

  it('shows Mono for single-channel audio', () => {
    render(
      <AudioWaveformPlayer
        url="http://x/a.mp3"
        metadata={{ channels: 1 }}
      />,
    );
    expect(screen.getByText('Mono')).toBeInTheDocument();
  });

  it('shows multi-channel suffix for 5+ channels', () => {
    render(
      <AudioWaveformPlayer
        url="http://x/a.mp3"
        metadata={{ channels: 6 }}
      />,
    );
    expect(screen.getByText('6ch')).toBeInTheDocument();
  });

  it('updates volume on slider change', () => {
    render(<AudioWaveformPlayer url="http://x/a.mp3" />);
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(slider.value).toBe('0.5');
    expect(mockSetVolume).toHaveBeenCalledWith(0.5);
  });
});
