import { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, RefreshCw, Play, Loader2, Bug, CheckCircle2, XCircle, SlidersHorizontal } from 'lucide-react';
import type { CollisionGrid, TrackingState, DebugInfo, LevelConfig } from '@/types';
import { downsampleToGrid, extractCollisionGrid, countSolidPixels } from '@/utils/imageProcessor';
import { PhaserGameManager } from '@/game/PhaserGameManager';

interface CameraARViewProps {
  threshold: number;
  levelConfig: LevelConfig;
  onDebugUpdate: (info: Partial<DebugInfo>) => void;
  onGridReady: (grid: CollisionGrid | null, previewUrl: string | null) => void;
  onThresholdChange: (value: number) => void;
}

export function CameraARView({
  threshold,
  levelConfig,
  onDebugUpdate,
  onGridReady,
  onThresholdChange,
}: CameraARViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const phaserRef = useRef<PhaserGameManager | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });
  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const [showDebug, setShowDebug] = useState(false);
  const [showThreshold, setShowThreshold] = useState(false);
  const [hasGrid, setHasGrid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setTrackingState('searching');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera access failed';
      setError(msg);
      setTrackingState('idle');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setTrackingState('idle');
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (phaserRef.current) {
        phaserRef.current.destroy();
        phaserRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensurePhaser = useCallback(async () => {
    if (phaserRef.current || !gameContainerRef.current) return phaserRef.current;
    const manager = new PhaserGameManager(gameContainerRef.current);
    await manager.init();
    manager.setOnPositionUpdate((pos) => {
      onDebugUpdate({ characterPos: pos });
    });
    phaserRef.current = manager;
    return manager;
  }, [onDebugUpdate]);

  const processCanvas = useCallback(
    async (sourceCanvas: HTMLCanvasElement, thresh: number) => {
      const downsampled = downsampleToGrid(sourceCanvas, 128);
      const result = extractCollisionGrid(downsampled, thresh);
      const solidCount = countSolidPixels(result.grid);

      onDebugUpdate({
        gridResolution: '128×128',
        solidPixels: solidCount,
        threshold: thresh,
      });

      onGridReady(result.grid, result.previewCanvas.toDataURL());

      const manager = await ensurePhaser();
      manager?.setCollisionGrid(result.grid, result.gridCanvas);

      setHasGrid(true);
      setTrackingState('tracking');
    },
    [onDebugUpdate, onGridReady, ensurePhaser]
  );

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !videoRef.current.videoWidth) return;

    setIsCapturing(true);
    setError(null);

    try {
      const video = videoRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const minDim = Math.min(vw, vh);
      const offX = (vw - minDim) / 2;
      const offY = (vh - minDim) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, offX, offY, minDim, minDim, 0, 0, 512, 512);

      lastCaptureCanvasRef.current = canvas;
      await processCanvas(canvas, threshold);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capture failed';
      setError(msg);
    } finally {
      setIsCapturing(false);
    }
  }, [threshold, processCanvas]);

  // Re-process when threshold changes after a capture (debounced feel via direct call)
  useEffect(() => {
    if (hasGrid && lastCaptureCanvasRef.current) {
      processCanvas(lastCaptureCanvasRef.current, threshold);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  const retakePhoto = useCallback(() => {
    if (phaserRef.current) {
      phaserRef.current.destroy();
      phaserRef.current = null;
    }
    if (gameContainerRef.current) {
      gameContainerRef.current.innerHTML = '';
    }
    setHasGrid(false);
    setShowThreshold(false);
    setTrackingState('searching');
    lastCaptureCanvasRef.current = null;
    onGridReady(null, null);
    onDebugUpdate({ gridResolution: '—', solidPixels: 0, characterPos: null });
  }, [onDebugUpdate, onGridReady]);

  useEffect(() => {
    let rafId: number;

    const updateFps = () => {
      const now = performance.now();
      const { frames, lastTime } = fpsRef.current;
      const elapsed = now - lastTime;

      if (elapsed >= 500) {
        const fps = (frames / elapsed) * 1000;
        onDebugUpdate({ fps, trackingState });
        fpsRef.current = { frames: 0, lastTime: now };
      }
      fpsRef.current.frames = frames + 1;
      rafId = requestAnimationFrame(updateFps);
    };

    if (cameraReady) {
      rafId = requestAnimationFrame(updateFps);
    }

    return () => cancelAnimationFrame(rafId);
  }, [cameraReady, trackingState, onDebugUpdate]);

  const trackingBadge = {
    idle: { text: 'Idle', icon: XCircle, color: 'bg-ink-500/80' },
    searching: { text: 'Searching…', icon: Loader2, color: 'bg-amber-600/80' },
    tracking: { text: 'Tracking', icon: CheckCircle2, color: 'bg-green-700/80' },
    lost: { text: 'Lost', icon: XCircle, color: 'bg-red-600/80' },
  }[trackingState];

  return (
    <div className="flex flex-col h-full bg-ink-900 relative overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        {/* Camera always present; dimmed when playing */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            hasGrid ? 'opacity-20' : 'opacity-100'
          }`}
        />

        {!hasGrid && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 sm:w-72 sm:h-72 border-2 border-dashed border-paper-100/50 rounded-2xl" />
          </div>
        )}

        {/* Game canvas — always in DOM so ref is valid; fills entire area when active */}
        <div
          ref={gameContainerRef}
          className={`absolute inset-0 z-[5] ${
            hasGrid ? 'block' : 'hidden'
          }`}
          style={{ width: '100%', height: '100%' }}
        />

        <div className="absolute top-3 left-3 right-3 flex items-center justify-between safe-top z-10">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-paper-100 text-xs font-hand font-bold ${trackingBadge.color}`}>
            <trackingBadge.icon size={14} className={trackingState === 'searching' ? 'animate-spin' : ''} />
            {trackingBadge.text}
          </div>
          <div className="flex items-center gap-2">
            {hasGrid && (
              <button
                onClick={() => setShowThreshold(!showThreshold)}
                className={`p-2 rounded-full transition-colors ${
                  showThreshold ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/50 text-paper-100/70'
                }`}
                aria-label="Toggle threshold"
              >
                <SlidersHorizontal size={18} />
              </button>
            )}
            <button
              onClick={() => setShowDebug(!showDebug)}
              className={`p-2 rounded-full transition-colors ${
                showDebug ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/50 text-paper-100/70'
              }`}
              aria-label="Toggle debug"
            >
              <Bug size={18} />
            </button>
          </div>
        </div>

        {showDebug && (
          <div className="absolute top-14 left-3 right-3 max-w-xs animate-fade-in z-20">
            <div className="bg-paper-300/70 backdrop-blur-md border-2 border-ink-800/20 rounded-lg p-3 space-y-2 text-xs font-hand">
              <div className="flex justify-between text-ink-700">
                <span>Camera:</span>
                <span className="font-bold">{cameraReady ? 'ON' : 'OFF'}</span>
              </div>
              <div className="flex justify-between text-ink-700">
                <span>Threshold:</span>
                <span className="font-bold tabular-nums">{threshold}</span>
              </div>
              <div className="flex justify-between text-ink-700">
                <span>State:</span>
                <span className="font-bold">{trackingState}</span>
              </div>
              <div className="flex justify-between text-ink-700">
                <span>Grid:</span>
                <span className="font-bold">{hasGrid ? '128×128' : '—'}</span>
              </div>
            </div>
          </div>
        )}

        {showThreshold && hasGrid && (
          <div className="absolute bottom-24 left-3 right-3 z-20 animate-fade-in">
            <div className="bg-paper-200/95 backdrop-blur-md border-2 border-ink-800/25 rounded-xl p-4 space-y-2 shadow-lg">
              <div className="flex items-center justify-between">
                <label className="text-sm font-hand font-bold text-ink-800 flex items-center gap-2">
                  <SlidersHorizontal size={16} />
                  Threshold
                </label>
                <span className="text-sm font-hand font-bold text-ink-700 tabular-nums">{threshold}</span>
              </div>
              <input
                type="range"
                min={20}
                max={200}
                value={threshold}
                onChange={(e) => onThresholdChange(Number(e.target.value))}
                className="w-full"
              />
              <p className="text-[11px] font-hand text-ink-500 leading-tight">
                Lower = more platforms · Higher = only darkest lines
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80 p-6 z-30">
            <div className="text-center space-y-3 max-w-xs">
              <XCircle size={40} className="text-red-400 mx-auto" />
              <p className="text-paper-100 font-hand text-sm">{error}</p>
              <button onClick={startCamera} className="btn-sketch text-sm">
                Try Again
              </button>
            </div>
          </div>
        )}

        {!cameraReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900 z-30">
            <div className="text-center space-y-3">
              <Loader2 size={32} className="text-paper-100/60 animate-spin mx-auto" />
              <p className="text-paper-100/60 font-hand text-sm">Starting camera…</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-ink-900 safe-bottom px-4 py-3 flex flex-col gap-2 z-10">
        {hasGrid && !showThreshold && (
          <div className="flex items-center gap-3 px-1">
            <SlidersHorizontal size={14} className="text-paper-100/70 shrink-0" />
            <input
              type="range"
              min={20}
              max={200}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-paper-100/80 text-xs font-hand tabular-nums w-8 text-right">{threshold}</span>
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          {!hasGrid ? (
            <button
              onClick={capturePhoto}
              disabled={!cameraReady || isCapturing}
              className="btn-sketch flex items-center gap-2 disabled:opacity-40"
            >
              {isCapturing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Camera size={18} />
              )}
              <span>{isCapturing ? 'Processing…' : 'Capture Paper'}</span>
            </button>
          ) : (
            <>
              <button
                onClick={retakePhoto}
                className="btn-sketch-outline flex items-center gap-2 text-paper-100 border-paper-100"
              >
                <RefreshCw size={18} />
                <span>Retake</span>
              </button>
              <div className="flex items-center gap-1.5 text-paper-100/80 text-xs font-hand">
                <Play size={14} />
                <span>Tap sides to walk, center to jump</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
