import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Camera, RefreshCw, Play, Loader2, Bug, CheckCircle2, XCircle,
  SlidersHorizontal, RotateCcw, Pause, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { CollisionGrid, TrackingState, DebugInfo, LevelConfig } from '@/types';
import {
  downsampleToLetter,
  extractCollisionGrid,
  countSolidPixels,
  GRID_WIDTH,
  GRID_HEIGHT,
  CAPTURE_WIDTH,
  CAPTURE_HEIGHT,
} from '@/utils/imageProcessor';
import { PhaserGameManager } from '@/game/PhaserGameManager';

interface CameraARViewProps {
  threshold: number;
  levelConfig: LevelConfig;
  onDebugUpdate: (info: Partial<DebugInfo>) => void;
  onGridReady: (
    grid: CollisionGrid | null,
    previewUrl: string | null,
    captureDataUrl?: string | null
  ) => void;
  onThresholdChange: (value: number) => void;
  savedCaptureDataUrl?: string | null;
}

type ControlId = 'left' | 'right' | 'run' | 'jump';

interface ControlPos {
  x: number; // % of viewport width
  y: number; // % of viewport height
}

const DEFAULT_LAYOUT: Record<ControlId, ControlPos> = {
  left:  { x: 8,  y: 72 },
  right: { x: 22, y: 72 },
  run:   { x: 72, y: 72 },
  jump:  { x: 86, y: 72 },
};

const LAYOUT_KEY = 'sketchbook-ar-control-layout';

function loadLayout(): Record<ControlId, ControlPos> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_LAYOUT };
}

export function CameraARView({
  threshold,
  levelConfig,
  onDebugUpdate,
  onGridReady,
  onThresholdChange,
  savedCaptureDataUrl = null,
}: CameraARViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const phaserRef = useRef<PhaserGameManager | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isFirstProcessRef = useRef(true);
  const restoredRef = useRef(false);
  const fpsRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const [showDebug, setShowDebug] = useState(false);
  const [showThreshold, setShowThreshold] = useState(false);
  const [hasGrid, setHasGrid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Play controls
  const [playerScale, setPlayerScale] = useState(1);
  const [worldScale, setWorldScale] = useState(1);
  const [layoutMode, setLayoutMode] = useState(false);
  const [layout, setLayout] = useState<Record<ControlId, ControlPos>>(loadLayout);
  const [held, setHeld] = useState({ left: false, right: false, run: false, jump: false });
  const dragRef = useRef<{ id: ControlId; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        if (!lastCaptureCanvasRef.current) setTrackingState('searching');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera access failed');
      setTrackingState('idle');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const ensurePhaser = useCallback(async () => {
    if (phaserRef.current || !gameContainerRef.current) return phaserRef.current;
    const manager = new PhaserGameManager(gameContainerRef.current);
    await manager.init();
    manager.setOnPositionUpdate((pos) => onDebugUpdate({ characterPos: pos }));
    manager.setPlayerScale(playerScale);
    manager.setWorldScale(worldScale);
    phaserRef.current = manager;
    return manager;
  }, [onDebugUpdate, playerScale, worldScale]);

  // Push scale changes to Phaser
  useEffect(() => {
    phaserRef.current?.setPlayerScale(playerScale);
  }, [playerScale]);

  useEffect(() => {
    phaserRef.current?.setWorldScale(worldScale);
  }, [worldScale]);

  useEffect(() => {
    phaserRef.current?.setPaused(layoutMode);
  }, [layoutMode]);

  // Push held buttons to Phaser every frame while playing
  useEffect(() => {
    if (!hasGrid || layoutMode) return;
    const id = window.setInterval(() => {
      phaserRef.current?.setExternalInput(held.left, held.right, held.jump, held.run);
      if (held.jump) setHeld((h) => ({ ...h, jump: false })); // jump is edge-triggered
    }, 16);
    return () => clearInterval(id);
  }, [hasGrid, layoutMode, held]);

  const processCanvas = useCallback(
    async (sourceCanvas: HTMLCanvasElement, thresh: number, forceRespawn: boolean) => {
      const downsampled = downsampleToLetter(sourceCanvas, GRID_WIDTH, GRID_HEIGHT);
      const result = extractCollisionGrid(downsampled, thresh, GRID_WIDTH, GRID_HEIGHT);
      const solidCount = countSolidPixels(result.grid);
      onDebugUpdate({ gridResolution: `${GRID_WIDTH}×${GRID_HEIGHT}`, solidPixels: solidCount, threshold: thresh });
      const captureUrl = sourceCanvas.toDataURL('image/jpeg', 0.85);
      onGridReady(result.grid, result.previewCanvas.toDataURL(), captureUrl);
      const manager = await ensurePhaser();
      manager?.setCollisionGrid(result.grid, result.gridCanvas, forceRespawn);
      setHasGrid(true);
      setTrackingState('tracking');
    },
    [onDebugUpdate, onGridReady, ensurePhaser]
  );

  useEffect(() => {
    if (restoredRef.current || !savedCaptureDataUrl) return;
    restoredRef.current = true;
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      lastCaptureCanvasRef.current = canvas;
      isFirstProcessRef.current = true;
      await processCanvas(canvas, threshold, true);
      isFirstProcessRef.current = false;
    };
    img.src = savedCaptureDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCaptureDataUrl]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !videoRef.current.videoWidth) return;
    setIsCapturing(true);
    setError(null);
    try {
      const video = videoRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
      const srcAspect = vw / vh;
      let cropW: number, cropH: number, offX: number, offY: number;
      if (srcAspect > targetAspect) {
        cropH = vh; cropW = vh * targetAspect; offX = (vw - cropW) / 2; offY = 0;
      } else {
        cropW = vw; cropH = vw / targetAspect; offX = 0; offY = (vh - cropH) / 2;
      }
      const canvas = document.createElement('canvas');
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      canvas.getContext('2d')!.drawImage(video, offX, offY, cropW, cropH, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      lastCaptureCanvasRef.current = canvas;
      isFirstProcessRef.current = true;
      await processCanvas(canvas, threshold, true);
      isFirstProcessRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setIsCapturing(false);
    }
  }, [threshold, processCanvas]);

  useEffect(() => {
    if (hasGrid && lastCaptureCanvasRef.current && !isFirstProcessRef.current) {
      processCanvas(lastCaptureCanvasRef.current, threshold, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  const retakePhoto = useCallback(() => {
    if (phaserRef.current) {
      phaserRef.current.destroy();
      phaserRef.current = null;
    }
    if (gameContainerRef.current) gameContainerRef.current.innerHTML = '';
    setHasGrid(false);
    setShowThreshold(false);
    setLayoutMode(false);
    setTrackingState('searching');
    lastCaptureCanvasRef.current = null;
    isFirstProcessRef.current = true;
    restoredRef.current = true;
    onGridReady(null, null, null);
    onDebugUpdate({ gridResolution: '—', solidPixels: 0, characterPos: null });
  }, [onDebugUpdate, onGridReady]);

  const restartPlayer = useCallback(() => {
    phaserRef.current?.restartSpawn();
  }, []);

  useEffect(() => {
    let rafId: number;
    const updateFps = () => {
      const now = performance.now();
      const { frames, lastTime } = fpsRef.current;
      const elapsed = now - lastTime;
      if (elapsed >= 500) {
        onDebugUpdate({ fps: (frames / elapsed) * 1000, trackingState });
        fpsRef.current = { frames: 0, lastTime: now };
      }
      fpsRef.current.frames = frames + 1;
      rafId = requestAnimationFrame(updateFps);
    };
    if (cameraReady || hasGrid) rafId = requestAnimationFrame(updateFps);
    return () => cancelAnimationFrame(rafId);
  }, [cameraReady, hasGrid, trackingState, onDebugUpdate]);

  // ─── Touch control helpers ───
  const press = (id: ControlId, down: boolean) => {
    if (layoutMode) return;
    setHeld((h) => ({ ...h, [id]: down }));
  };

  const onControlPointerDown = (id: ControlId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (layoutMode) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        origX: layout[id].x,
        origY: layout[id].y,
      };
      return;
    }
    press(id, true);
  };

  const onControlPointerMove = (e: React.PointerEvent) => {
    if (!layoutMode || !dragRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / rect.height) * 100;
    const id = dragRef.current.id;
    setLayout((prev) => ({
      ...prev,
      [id]: {
        x: Math.max(4, Math.min(92, dragRef.current!.origX + dx)),
        y: Math.max(8, Math.min(88, dragRef.current!.origY + dy)),
      },
    }));
  };

  const onControlPointerUp = (id: ControlId) => {
    if (layoutMode && dragRef.current) {
      dragRef.current = null;
      setLayout((prev) => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(prev));
        return prev;
      });
      return;
    }
    press(id, false);
  };

  const toggleLayoutMode = () => {
    setLayoutMode((m) => {
      const next = !m;
      if (!next) {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      }
      setHeld({ left: false, right: false, run: false, jump: false });
      return next;
    });
  };

  const trackingBadge = {
    idle: { text: 'Idle', icon: XCircle, color: 'bg-ink-500/80' },
    searching: { text: 'Searching…', icon: Loader2, color: 'bg-amber-600/80' },
    tracking: { text: 'Tracking', icon: CheckCircle2, color: 'bg-green-700/80' },
    lost: { text: 'Lost', icon: XCircle, color: 'bg-red-600/80' },
  }[trackingState];

  const controlBtn = (
    id: ControlId,
    label: React.ReactNode,
    extraClass = ''
  ) => {
    const pos = layout[id];
    const isHeld = held[id];
    return (
      <button
        key={id}
        type="button"
        className={`absolute w-14 h-14 rounded-full border-2 border-white/40 flex items-center justify-center text-white font-hand font-bold text-xs select-none touch-none transition-transform ${
          layoutMode ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-transparent cursor-move' : ''
        } ${isHeld && !layoutMode ? 'scale-95 bg-white/40' : 'bg-black/50'} ${extraClass}`}
        style={{
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          transform: 'translate(-50%, -50%)',
          opacity: 0.5,
        }}
        onPointerDown={(e) => onControlPointerDown(id, e)}
        onPointerMove={onControlPointerMove}
        onPointerUp={() => onControlPointerUp(id)}
        onPointerCancel={() => onControlPointerUp(id)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full bg-ink-900 relative overflow-hidden">
      <div ref={viewportRef} className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${hasGrid ? 'opacity-20' : 'opacity-100'}`}
        />
        {!hasGrid && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 py-8">
            <div
              className="relative border-2 border-dashed border-paper-100/60 rounded-sm max-h-full"
              style={{ aspectRatio: '8.5 / 11', width: 'min(78vw, 340px)', maxHeight: '70%' }}
            >
              <span className="absolute -bottom-6 left-0 right-0 text-center text-[10px] font-hand text-paper-100/70">
                Align letter paper (8.5×11) inside frame
              </span>
            </div>
          </div>
        )}
        <div
          ref={gameContainerRef}
          className={`absolute inset-0 z-[5] ${hasGrid ? 'block' : 'hidden'}`}
          style={{ width: '100%', height: '100%' }}
        />

        {/* On-screen controls */}
        {hasGrid && (
          <div className="absolute inset-0 z-[15] pointer-events-none">
            <div className="pointer-events-auto absolute inset-0">
              {controlBtn('left', <ChevronLeft size={28} />)}
              {controlBtn('right', <ChevronRight size={28} />)}
              {controlBtn('run', 'RUN')}
              {controlBtn('jump', 'JUMP')}
            </div>
          </div>
        )}

        {/* Layout mode banner */}
        {layoutMode && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-amber-500/90 text-ink-900 text-xs font-hand font-bold px-3 py-1.5 rounded-full">
            Drag buttons to reposition · tap Pause again to resume
          </div>
        )}

        <div className="absolute top-3 left-3 right-3 flex items-center justify-between safe-top z-20">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-paper-100 text-xs font-hand font-bold ${trackingBadge.color}`}>
            <trackingBadge.icon size={14} className={trackingState === 'searching' ? 'animate-spin' : ''} />
            {trackingBadge.text}
          </div>
          <div className="flex items-center gap-2">
            {hasGrid && (
              <>
                <button
                  onClick={toggleLayoutMode}
                  className={`p-2 rounded-full transition-colors ${
                    layoutMode ? 'bg-amber-500 text-ink-900' : 'bg-ink-900/50 text-paper-100/70'
                  }`}
                  aria-label={layoutMode ? 'Resume play' : 'Pause & move controls'}
                >
                  {layoutMode ? <Play size={18} /> : <Pause size={18} />}
                </button>
                <button
                  onClick={() => setShowThreshold(!showThreshold)}
                  className={`p-2 rounded-full transition-colors ${showThreshold ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/50 text-paper-100/70'}`}
                  aria-label="Toggle threshold"
                >
                  <SlidersHorizontal size={18} />
                </button>
              </>
            )}
            <button
              onClick={() => setShowDebug(!showDebug)}
              className={`p-2 rounded-full transition-colors ${showDebug ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/50 text-paper-100/70'}`}
              aria-label="Toggle debug"
            >
              <Bug size={18} />
            </button>
          </div>
        </div>

        {showDebug && (
          <div className="absolute top-14 left-3 right-3 max-w-xs animate-fade-in z-20">
            <div className="bg-paper-300/70 backdrop-blur-md border-2 border-ink-800/20 rounded-lg p-3 space-y-2 text-xs font-hand">
              <div className="flex justify-between text-ink-700"><span>Camera:</span><span className="font-bold">{cameraReady ? 'ON' : 'OFF'}</span></div>
              <div className="flex justify-between text-ink-700"><span>Threshold:</span><span className="font-bold tabular-nums">{threshold}</span></div>
              <div className="flex justify-between text-ink-700"><span>Player size:</span><span className="font-bold tabular-nums">{playerScale.toFixed(1)}×</span></div>
              <div className="flex justify-between text-ink-700"><span>World scale:</span><span className="font-bold tabular-nums">{worldScale.toFixed(1)}×</span></div>
            </div>
          </div>
        )}

        {showThreshold && hasGrid && (
          <div className="absolute bottom-28 left-3 right-3 z-20 animate-fade-in">
            <div className="bg-paper-200/95 backdrop-blur-md border-2 border-ink-800/25 rounded-xl p-4 space-y-3 shadow-lg">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-hand font-bold text-ink-800">Threshold</label>
                  <span className="text-sm font-hand font-bold text-ink-700 tabular-nums">{threshold}</span>
                </div>
                <input type="range" min={20} max={200} value={threshold} onChange={(e) => onThresholdChange(Number(e.target.value))} className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-hand font-bold text-ink-800">Player size / hitbox</label>
                  <span className="text-sm font-hand font-bold text-ink-700 tabular-nums">{playerScale.toFixed(1)}×</span>
                </div>
                <input
                  type="range" min={0.5} max={2.5} step={0.1}
                  value={playerScale}
                  onChange={(e) => setPlayerScale(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-hand font-bold text-ink-800">World scale (speed & jump)</label>
                  <span className="text-sm font-hand font-bold text-ink-700 tabular-nums">{worldScale.toFixed(1)}×</span>
                </div>
                <input
                  type="range" min={0.4} max={2} step={0.1}
                  value={worldScale}
                  onChange={(e) => setWorldScale(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80 p-6 z-30">
            <div className="text-center space-y-3 max-w-xs">
              <XCircle size={40} className="text-red-400 mx-auto" />
              <p className="text-paper-100 font-hand text-sm">{error}</p>
              <button onClick={startCamera} className="btn-sketch text-sm">Try Again</button>
            </div>
          </div>
        )}
        {!cameraReady && !error && !hasGrid && (
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
            <span className="text-paper-100/60 text-[10px] font-hand w-10 shrink-0">Size</span>
            <input type="range" min={0.5} max={2.5} step={0.1} value={playerScale} onChange={(e) => setPlayerScale(Number(e.target.value))} className="flex-1" />
            <span className="text-paper-100/60 text-[10px] font-hand w-10 shrink-0">World</span>
            <input type="range" min={0.4} max={2} step={0.1} value={worldScale} onChange={(e) => setWorldScale(Number(e.target.value))} className="flex-1" />
          </div>
        )}
        <div className="flex items-center justify-center gap-2">
          {!hasGrid ? (
            <button onClick={capturePhoto} disabled={!cameraReady || isCapturing} className="btn-sketch flex items-center gap-2 disabled:opacity-40">
              {isCapturing ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              <span>{isCapturing ? 'Processing…' : 'Capture Paper'}</span>
            </button>
          ) : (
            <>
              <button onClick={retakePhoto} className="btn-sketch-outline flex items-center gap-1.5 text-paper-100 border-paper-100 text-sm px-3">
                <RefreshCw size={16} /> Retake
              </button>
              <button onClick={restartPlayer} className="btn-sketch flex items-center gap-1.5 text-sm px-3">
                <RotateCcw size={16} /> Restart
              </button>
              <button onClick={toggleLayoutMode} className={`flex items-center gap-1.5 text-sm px-3 rounded-lg border-2 font-hand font-bold ${
                layoutMode ? 'border-amber-400 bg-amber-500 text-ink-900' : 'border-paper-100/40 text-paper-100/80'
              }`}>
                {layoutMode ? <Play size={14} /> : <Pause size={14} />}
                {layoutMode ? 'Resume' : 'Layout'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
