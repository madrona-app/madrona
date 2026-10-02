import { useRef, useEffect, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface AudioWaveformPlayerProps {
  url: string;
  /** Duration in seconds from metadata (shown before waveform loads) */
  duration?: number | null;
  /** Pre-computed waveform peaks from server-side processing */
  peaks?: number[] | null;
  /** Technical metadata for display */
  metadata?: {
    bitrate_kbps?: number;
    sample_rate?: number;
    channels?: number;
    file_format?: string;
  } | null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function AudioWaveformPlayer({ url, duration, peaks, metadata }: AudioWaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    setError(null);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgb(var(--color-stone))',       // stone
      progressColor: 'rgb(var(--color-bark))',    // bark
      cursorColor: 'rgb(var(--color-forest))',      // forest
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      normalize: true,
      url,
      // Use pre-computed peaks for instant waveform rendering (audio still streams for playback)
      ...(peaks && peaks.length > 0 ? { peaks: [peaks], duration: duration || undefined } : {}),
    });

    ws.on('ready', () => {
      setTotalDuration(ws.getDuration());
      setIsReady(true);
      ws.setVolume(volume);
    });

    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
    });

    ws.on('error', () => setError('Audio failed to load'));

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
    // Only re-create on URL change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const togglePlay = useCallback(() => {
    wavesurferRef.current?.playPause();
  }, []);

  const toggleMute = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (isMuted) {
      ws.setVolume(volume);
      setIsMuted(false);
    } else {
      ws.setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    wavesurferRef.current?.setVolume(val);
  }, []);

  // Keyboard shortcut: space to play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  // Build metadata chips
  const chips: string[] = [];
  if (metadata?.file_format) chips.push(metadata.file_format);
  if (metadata?.sample_rate) chips.push(`${(metadata.sample_rate / 1000).toFixed(1)} kHz`);
  if (metadata?.bitrate_kbps) chips.push(`${metadata.bitrate_kbps} kbps`);
  if (metadata?.channels) chips.push(metadata.channels === 1 ? 'Mono' : metadata.channels === 2 ? 'Stereo' : `${metadata.channels}ch`);

  return (
    <div className="w-full max-w-2xl mx-auto px-6 py-4">
      {/* Waveform */}
      {error ? (
        <div className="flex items-center justify-center h-20 bg-stone rounded-institutional">
          <p className="text-sm text-semantic-error">{error}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={`w-full rounded-lg transition-opacity ${isReady ? 'opacity-100' : 'opacity-30'}`}
        />
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 mt-3">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          disabled={!isReady}
          className="p-2.5 rounded-full bg-bark text-parchment hover:bg-bark/90 disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        {/* Time */}
        <span className="text-sm font-mono text-ink tabular-nums min-w-[90px]">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="p-1 text-archive hover:text-ink transition-colors"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 accent-bark cursor-pointer"
            aria-label="Volume"
          />
        </div>
      </div>

      {/* Metadata chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          {chips.map((chip) => (
            <span
              key={chip}
              className="px-2 py-0.5 text-xs font-medium bg-stone rounded text-archive"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
