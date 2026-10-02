import { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from 'lucide-react';

interface SubtitleTrack {
  src: string;
  label: string;
  srclang: string;
  kind?: string;
  default?: boolean;
}

interface VideoPlayerProps {
  url: string;
  mimeType?: string;
  posterUrl?: string;
  /** Subtitle/caption tracks (SRT/VTT) */
  subtitles?: SubtitleTrack[];
  /** Technical metadata for display chips */
  metadata?: {
    width?: number;
    height?: number;
    codec?: string;
    file_format?: string;
    duration_seconds?: number;
    bitrate_kbps?: number;
    frame_rate?: number;
  } | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PLAYBACK_RATES = [0.5, 1, 1.5, 2];

export default function VideoPlayer({ url, mimeType, posterUrl, subtitles, metadata }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(metadata?.duration_seconds || 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setIsReady(true);
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      const code = video.error?.code;
      const messages: Record<number, string> = {
        1: 'Video loading was aborted',
        2: 'A network error occurred while loading the video',
        3: 'Video format is not supported or file is corrupted',
        4: 'Video format is not supported by this browser',
      };
      setError(messages[code ?? 0] || 'Video failed to load');
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [url]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = val;
    setVolume(val);
    if (val === 0) {
      video.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      video.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = fraction * duration;
  }, [duration]);

  const setRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowRateMenu(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
          // Only handle space if the video player area is focused or body
          if (e.target === document.body || containerRef.current?.contains(e.target as Node)) {
            e.preventDefault();
            togglePlay();
          }
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'ArrowLeft':
          if (containerRef.current?.contains(e.target as Node) || e.target === document.body) {
            e.preventDefault();
            video.currentTime = Math.max(0, video.currentTime - 5);
          }
          break;
        case 'ArrowRight':
          if (containerRef.current?.contains(e.target as Node) || e.target === document.body) {
            e.preventDefault();
            video.currentTime = Math.min(video.duration, video.currentTime + 5);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen]);

  // Build metadata chips
  const chips: string[] = [];
  if (metadata?.file_format) chips.push(metadata.file_format.toUpperCase());
  if (metadata?.width && metadata?.height) chips.push(`${metadata.width}x${metadata.height}`);
  if (metadata?.codec) chips.push(metadata.codec);
  if (metadata?.frame_rate) chips.push(`${metadata.frame_rate} fps`);
  if (metadata?.bitrate_kbps) chips.push(`${metadata.bitrate_kbps} kbps`);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-stone rounded-institutional">
        <p className="text-semantic-error">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col bg-ink">
      {/* Video area — click to toggle play */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center cursor-pointer"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          className="w-full max-h-full object-contain"
          poster={posterUrl}
          preload="metadata"
        >
          <source src={url} type={mimeType || undefined} />
          {subtitles?.map((track, i) => (
            <track
              key={`${track.srclang}-${i}`}
              src={track.src}
              kind={track.kind || 'subtitles'}
              label={track.label}
              srcLang={track.srclang}
              default={track.default}
            />
          ))}
        </video>

        {/* Large play overlay when paused and not yet started */}
        {!isPlaying && currentTime === 0 && isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/30">
            <div className="p-5 rounded-full bg-bark/90 text-parchment">
              <Play size={32} className="ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex-shrink-0 px-4 py-2 bg-ink/95">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1.5 bg-parchment/20 rounded-full cursor-pointer mb-3 group"
          onClick={handleProgressClick}
        >
          {/* Buffered */}
          <div
            className="absolute inset-y-0 left-0 bg-parchment/30 rounded-full"
            style={{ width: `${bufferedPercent}%` }}
          />
          {/* Progress */}
          <div
            className="absolute inset-y-0 left-0 bg-bark rounded-full transition-[width] duration-100"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-parchment rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progressPercent}% - 6px)` }}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            disabled={!isReady}
            className="p-1.5 rounded-full bg-bark text-parchment hover:bg-bark/80 disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>

          {/* Time */}
          <span className="text-xs font-mono text-parchment/80 tabular-nums min-w-[90px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Playback rate */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowRateMenu(!showRateMenu); }}
              className="px-2 py-1 text-xs font-medium text-parchment/70 hover:text-parchment bg-parchment/10 hover:bg-parchment/20 rounded transition-colors"
            >
              {playbackRate}x
            </button>
            {showRateMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowRateMenu(false)} />
                <div className="absolute bottom-full mb-1 right-0 bg-ink border border-parchment/20 rounded-lg shadow-lg py-1 z-20">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      onClick={(e) => { e.stopPropagation(); setRate(rate); }}
                      className={`block w-full px-4 py-1.5 text-xs text-left transition-colors ${
                        rate === playbackRate
                          ? 'text-bark bg-bark/10'
                          : 'text-parchment/70 hover:text-parchment hover:bg-parchment/10'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Volume */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              className="p-1 text-parchment/70 hover:text-parchment transition-colors"
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
              onClick={(e) => e.stopPropagation()}
              className="w-16 h-1 accent-bark cursor-pointer"
              aria-label="Volume"
            />
          </div>

          {/* Fullscreen */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            className="p-1 text-parchment/70 hover:text-parchment transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>

      {/* Metadata chips */}
      {chips.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-ink border-t border-parchment/10">
          {chips.map((chip) => (
            <span
              key={chip}
              className="px-2 py-0.5 text-xs font-medium bg-parchment/10 rounded text-parchment/60"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
