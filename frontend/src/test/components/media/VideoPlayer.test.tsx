import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoPlayer from '../../../components/media/VideoPlayer';

describe('VideoPlayer', () => {
  it('renders the video element', () => {
    const { container } = render(<VideoPlayer url="http://x/v.mp4" mimeType="video/mp4" />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
  });

  it('renders source element with given URL and MIME type', () => {
    const { container } = render(<VideoPlayer url="http://x/v.mp4" mimeType="video/mp4" />);
    const source = container.querySelector('source');
    expect(source).toHaveAttribute('src', 'http://x/v.mp4');
    expect(source).toHaveAttribute('type', 'video/mp4');
  });

  it('renders subtitle tracks when given', () => {
    const { container } = render(
      <VideoPlayer
        url="http://x/v.mp4"
        subtitles={[{ src: '/en.vtt', label: 'English', srclang: 'en', default: true }]}
      />,
    );
    const tracks = container.querySelectorAll('track');
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toHaveAttribute('src', '/en.vtt');
    expect(tracks[0]).toHaveAttribute('label', 'English');
  });

  it('shows play button initially', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('renders metadata chips', () => {
    render(
      <VideoPlayer
        url="http://x/v.mp4"
        metadata={{
          width: 1920,
          height: 1080,
          codec: 'h264',
          file_format: 'mp4',
          frame_rate: 30,
          bitrate_kbps: 5000,
        }}
      />,
    );
    expect(screen.getByText('MP4')).toBeInTheDocument();
    expect(screen.getByText('1920x1080')).toBeInTheDocument();
    expect(screen.getByText('h264')).toBeInTheDocument();
    expect(screen.getByText('30 fps')).toBeInTheDocument();
    expect(screen.getByText('5000 kbps')).toBeInTheDocument();
  });

  it('initial time display shows 0:00 / 0:00', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument();
  });

  it('starts with 1x playback rate', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    expect(screen.getByText('1x')).toBeInTheDocument();
  });

  it('opens playback rate menu when 1x clicked', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    fireEvent.click(screen.getByText('1x'));
    expect(screen.getByText('0.5x')).toBeInTheDocument();
    expect(screen.getByText('2x')).toBeInTheDocument();
  });

  it('renders volume slider with default 0.8', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    expect(slider.value).toBe('0.8');
  });

  it('renders mute button by default', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    expect(screen.getByLabelText('Mute')).toBeInTheDocument();
  });

  it('renders fullscreen button', () => {
    render(<VideoPlayer url="http://x/v.mp4" />);
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('renders poster URL on the video element', () => {
    const { container } = render(<VideoPlayer url="http://x/v.mp4" posterUrl="/poster.jpg" />);
    expect(container.querySelector('video')).toHaveAttribute('poster', '/poster.jpg');
  });
});
