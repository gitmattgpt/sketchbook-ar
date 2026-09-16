import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Camera, Loader2, Bug, CheckCircle2, XCircle,
  SlidersHorizontal, RotateCcw, Pause, Play, ChevronLeft, ChevronRight, Box,
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
import { PaperTrackDemo, type TrackStatus } from '@/ar/PaperTrackDemo';

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
interface ControlPos { x: number; y: number }

const DEFAULT_LAYOUT: Record<ControlId, ControlPos> = {
  left: { x: 8, y: 72 },
  right: { x: 22, y: 72 },
  run: { x: 72, y: 72 },
  jump: { x: 86, y: 72 },
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
  const arContainerRef = useRef<HTMLDivElement>(null);
  const phaserRef = useRef<PhaserGameManager | null>(null);
  const trackDemoRef = useRef<PaperTrackDemo | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** ORIGINAL full-color capture — NEVER the threshold grid. Used as AR tracker source. */
  const originalCaptureUrlRef = useRef<string | null>(null);
  const lastCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isFirstProcessRef = useRef(true);
  const restoredRef = useRef(false);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now() });
  const heldRef = useRef({ left: false, right: false, run: false, jump: false });
  const layoutModeRef = useRef(false);

  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const [showDebug, setShowDebug] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hasGrid, setHasGrid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [playerScale, setPlayerScale] = useState(1);
  const [worldScale, setWorldScale] = useState(1);
  const [expandRadius, setExpandRadius] = useState(0);
  const [layoutMode, setLayoutMode] = useState(false);
  const [layout, setLayout] = useState(loadLayout);
  const [held, setHeld] = useState({ left: false, right: false, run: false, jump: false });
  const [arTestMode, setArTestMode] = useState(false);
  const [arStatus, setArStatus] = useState<TrackStatus>('idle');
  const [arDetail, setArDetail] = useState('');
  const dragRef = useRef<{ id: ControlId; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  layoutModeRef.current = layoutMode;
  heldRef.current = held;

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
    manager.setLevelPoints(levelConfig.spawn, levelConfig.goal);
    phaserRef.current = manager;
    return manager;
  }, [onDebugUpdate, playerScale, worldScale, levelConfig.spawn, levelConfig.goal]);

  useEffect(() => { phaserRef.current?.setPlayerScale(playerScale); }, [playerScale]);
  useEffect(() => { phaserRef.current?.setWorldScale(worldScale); }, [worldScale]);
  useEffect(() => { phaserRef.current?.setPaused(layoutMode || arTestMode); }, [layoutMode, arTestMode]);
  useEffect(() => { phaserRef.current?.setLevelPoints(levelConfig.spawn, levelConfig.goal); }, [levelConfig.spawn, levelConfig.goal]);

  useEffect(() => {
    if (!hasGrid || arTestMode) return;
    let raf = 0;
    const tick = () => {
      if (!layoutModeRef.current) {
        const h = heldRef.current;
        phaserRef.current?.setExternalInput(h.left, h.right, h.jump, h.run);
        if (h.jump) {
          heldRef.current = { ...h, jump: false };
          setHeld((prev) => (prev.jump ? { ...prev, jump: false } : prev));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasGrid, arTestMode]);

  const processCanvas = useCallback(
    async (sourceCanvas: HTMLCanvasElement, thresh: number, expand: number, forceRespawn: boolean) => {
      // sourceCanvas is the ORIGINAL letter crop (full color) — save as tracker source
      const originalUrl = sourceCanvas.toDataURL('image/jpeg', 0.92);
      originalCaptureUrlRef.current = originalUrl;

      const downsampled = downsampleToLetter(sourceCanvas, GRID_WIDTH, GRID_HEIGHT);
      const result = extractCollisionGrid(downsampled, thresh, GRID_WIDTH, GRID_HEIGHT, expand);
      const solidCount = countSolidPixels(result.grid);
      onDebugUpdate({ gridResolution: `${GRID_WIDTH}\u00d7${GRID_HEIGHT}`, solidPixels: solidCount, threshold: thresh });
      onGridReady(result.grid, result.previewCanvas.toDataURL(), originalUrl);
      const manager = await ensurePhaser();
      manager?.setLevelPoints(levelConfig.spawn, levelConfig.goal);
      manager?.setCollisionGrid(result.grid, result.gridCanvas, forceRespawn);
      setHasGrid(true);
      setTrackingState('tracking');
    },
    [onDebugUpdate, onGridReady, ensurePhaser, levelConfig.spawn, levelConfig.goal]
  );

  useEffect(() => {
    if (restoredRef.current || !savedCaptureDataUrl) return;
    restoredRef.current = true;
    originalCaptureUrlRef.current = savedCaptureDataUrl;
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      lastCaptureCanvasRef.current = canvas;
      isFirstProcessRef.current = true;
      await processCanvas(canvas, threshold, expandRadius, true);
      isFirstProcessRef.current = false;
    };
    img.src = savedCaptureDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCaptureDataUrl]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      trackDemoRef.current?.stop();
    };
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
      await processCanvas(canvas, threshold, expandRadius, true);
      isFirstProcessRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setIsCapturing(false);
    }
  }, [threshold, expandRadius, processCanvas]);

  useEffect(() => {
    if (hasGrid && lastCaptureCanvasRef.current && !isFirstProcessRef.current) {
      processCanvas(lastCaptureCanvasRef.current, threshold, expandRadius, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, expandRadius]);

  const exitArTest = useCallback(async () => {
    await trackDemoRef.current?.stop();
    trackDemoRef.current = null;
    setArTestMode(false);
    setArStatus('idle');
    setArDetail('');
    await startCamera();
  }, [startCamera]);

  const enterArTest = useCallback(async () => {
    const original = originalCaptureUrlRef.current;
    if (!original || !arContainerRef.current) {
      setError('Capture paper first — tracker needs the original photo');
      return;
    }
    setShowFilters(false);
    setLayoutMode(false);
    setArTestMode(true);
    stopCamera();

    const demo = new PaperTrackDemo();
    trackDemoRef.current = demo;
    demo.setStatusHandler((s, detail) => {
      setArStatus(s);
      setArDetail(detail ?? '');
    });
    try {
      await demo.start(arContainerRef.current, original);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AR track test failed');
      await exitArTest();
    }
  }, [stopCamera, exitArTest]);

  const toggleArTest = () => {
    if (arTestMode) void exitArTest();
    else void enterArTest();
  };

  const retakePhoto = useCallback(() => {
    void trackDemoRef.current?.stop();
    trackDemoRef.current = null;
    setArTestMode(false);
    if (phaserRef.current) {
      phaserRef.current.destroy();
      phaserRef.current = null;
    }
    if (gameContainerRef.current) gameContainerRef.current.innerHTML = '';
    setHasGrid(false);
    setShowFilters(false);
    setLayoutMode(false);
    setTrackingState('searching');
    lastCaptureCanvasRef.current = null;
    originalCaptureUrlRef.current = null;
    isFirstProcessRef.current = true;
    restoredRef.current = true;
    onGridReady(null, null, null);
    onDebugUpdate({ gridResolution: '\u2014', solidPixels: 0, characterPos: null });
    void startCamera();
  }, [onDebugUpdate, onGridReady, startCamera]);

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
    if ((cameraReady || hasGrid) && !arTestMode) rafId = requestAnimationFrame(updateFps);
    return () => cancelAnimationFrame(rafId);
  }, [cameraReady, hasGrid, trackingState, onDebugUpdate, arTestMode]);

  const press = (id: ControlId, down: boolean) => {
    if (layoutModeRef.current || arTestMode) return;
    setHeld((h) => {
      const next = { ...h, [id]: down };
      heldRef.current = next;
      return next;
    });
  };

  const onControlPointerDown = (id: ControlId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (layoutMode) {
      dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX: layout[id].x, origY: layout[id].y };
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
      if (!next) localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      const cleared = { left: false, right: false, run: false, jump: false };
      heldRef.current = cleared;
      setHeld(cleared);
      return next;
    });
  };

  const trackingBadge = {
    idle: { text: 'Idle', icon: XCircle, color: 'bg-ink-500/80' },
    searching: { text: 'Searching\u2026', icon: Loader2, color: 'bg-amber-600/80' },
    tracking: { text: 'Tracking', icon: CheckCircle2, color: 'bg-green-700/80' },
    lost: { text: 'Lost', icon: XCircle, color: 'bg-red-600/80' },
  }[trackingState];

  const arBadge = (() => {
    if (arStatus === 'found') return { text: 'Paper found', color: 'bg-green-700/90' };
    if (arStatus === 'compiling') return { text: arDetail || 'Compiling\u2026', color: 'bg-amber-600/90' };
    if (arStatus === 'searching' || arStatus === 'lost') return { text: arDetail || 'Point at paper', color: 'bg-amber-600/90' };
    if (arStatus === 'error') return { text: arDetail || 'Error', color: 'bg-red-600/90' };
    return { text: 'AR test', color: 'bg-ink-500/90' };
  })();

  const controlBtn = (id: ControlId, label: React.ReactNode) => {
    const pos = layout[id];
    const isHeld = held[id];
    return (
      <button
        key={id}
        type="button"
        className={`absolute w-14 h-14 rounded-full border-2 border-white/40 flex items-center justify-center text-white font-hand font-bold text-xs select-none touch-none ${
          layoutMode ? 'ring-2 ring-amber-400 cursor-move' : ''
        } ${isHeld && !layoutMode ? 'scale-95 bg-white/40' : 'bg-black/50'}`}
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', opacity: 0.5 }}
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
        {/* Normal game camera / map — hidden in AR test mode */}
        {!arTestMode && (
          <>
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
                    Align letter paper (8.5\u00d711) inside frame
                  </span>
                </div>
              </div>
            )}
            <div
              ref={gameContainerRef}
              className={`absolute inset-0 z-[5] ${hasGrid ? 'block' : 'hidden'}`}
              style={{ width: '100%', height: '100%' }}
            />
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
          </>
        )}

        {/* AR track-test layer: MindAR owns camera; cube only when paper found */}
        <div
          ref={arContainerRef}
          className={`absolute inset-0 z-[6] ${arTestMode ? 'block' : 'hidden'}`}
          style={{ width: '100%', height: '100%' }}
        />

        {layoutMode && !arTestMode && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-amber-500/90 text-ink-900 text-xs font-hand font-bold px-3 py-1.5 rounded-full">
            Drag buttons \u00b7 tap Pause to resume
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-center z-20 gap-1.5">
          {hasGrid && !arTestMode && (
            <>
              <button onClick={retakePhoto} className="p-2 rounded-full bg-ink-900/60 text-paper-100" aria-label="Retake">
                <Camera size={18} />
              </button>
              <button onClick={restartPlayer} className="p-2 rounded-full bg-ink-900/60 text-paper-100" aria-label="Restart">
                <RotateCcw size={18} />
              </button>
            </>
          )}
          <div className="flex-1 flex justify-center">
            {arTestMode ? (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-paper-100 text-xs font-hand font-bold ${arBadge.color}`}>
                {(arStatus === 'compiling' || arStatus === 'searching') && <Loader2 size={14} className="animate-spin" />}
                {arStatus === 'found' && <CheckCircle2 size={14} />}
                {arBadge.text}
              </div>
            ) : (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-paper-100 text-xs font-hand font-bold ${trackingBadge.color}`}>
                <trackingBadge.icon size={14} className={trackingState === 'searching' ? 'animate-spin' : ''} />
                {trackingBadge.text}
              </div>
            )}
          </div>
          {hasGrid && (
            <button
              onClick={toggleArTest}
              className={`p-2 rounded-full ${arTestMode ? 'bg-amber-500 text-ink-900' : 'bg-ink-900/60 text-paper-100'}`}
              aria-label="AR track test"
              title="AR track test (cube on original paper photo)"
            >
              <Box size={18} />
            </button>
          )}
          {hasGrid && !arTestMode && (
            <>
              <button
                onClick={toggleLayoutMode}
                className={`p-2 rounded-full ${layoutMode ? 'bg-amber-500 text-ink-900' : 'bg-ink-900/60 text-paper-100'}`}
                aria-label={layoutMode ? 'Resume' : 'Pause layout'}
              >
                {layoutMode ? <Play size={18} /> : <Pause size={18} />}
              </button>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-full ${showFilters ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/60 text-paper-100'}`}
                aria-label="Filters"
              >
                <SlidersHorizontal size={18} />
              </button>
            </>
          )}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`p-2 rounded-full ${showDebug ? 'bg-ink-800 text-paper-100' : 'bg-ink-900/50 text-paper-100/70'}`}
            aria-label="Debug"
          >
            <Bug size={18} />
          </button>
        </div>

        {arTestMode && (
          <div className="absolute bottom-6 left-3 right-3 z-20 text-center">
            <p className="text-xs font-hand text-paper-100/90 bg-ink-900/70 rounded-lg px-3 py-2 inline-block">
              Tracker = original photo ({CAPTURE_WIDTH}\u00d7{CAPTURE_HEIGHT}), not threshold map.
              Green face = up. Cube only when paper is found.
            </p>
          </div>
        )}

        {showDebug && !arTestMode && (
          <div className="absolute top-14 left-3 right-3 max-w-xs z-20">
            <div className="bg-paper-300/70 backdrop-blur-md border-2 border-ink-800/20 rounded-lg p-3 space-y-2 text-xs font-hand">
              <div className="flex justify-between text-ink-700"><span>Threshold:</span><span className="font-bold">{threshold}</span></div>
              <div className="flex justify-between text-ink-700"><span>Expand:</span><span className="font-bold">{expandRadius}</span></div>
              <div className="flex justify-between text-ink-700"><span>Capture:</span><span className="font-bold">{CAPTURE_WIDTH}\u00d7{CAPTURE_HEIGHT}</span></div>
              <div className="flex justify-between text-ink-700"><span>Grid:</span><span className="font-bold">{GRID_WIDTH}\u00d7{GRID_HEIGHT}</span></div>
            </div>
          </div>
        )}

        {showFilters && hasGrid && !arTestMode && (
          <div className="absolute bottom-4 left-3 right-3 z-20">
            <div className="bg-paper-200/95 backdrop-blur-md border-2 border-ink-800/25 rounded-xl p-4 space-y-3 shadow-lg">
              <div className="space-y-1">
                <div className="flex justify-between"><label className="text-sm font-hand font-bold text-ink-800">Threshold</label><span className="text-sm font-hand font-bold">{threshold}</span></div>
                <input type="range" min={20} max={200} value={threshold} onChange={(e) => onThresholdChange(Number(e.target.value))} className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between"><label className="text-sm font-hand font-bold text-ink-800">Line thickness</label><span className="text-sm font-hand font-bold">{expandRadius}</span></div>
                <input type="range" min={0} max={5} step={1} value={expandRadius} onChange={(e) => setExpandRadius(Number(e.target.value))} className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between"><label className="text-sm font-hand font-bold text-ink-800">Player size</label><span className="text-sm font-hand font-bold">{playerScale.toFixed(1)}\u00d7</span></div>
                <input type="range" min={0.5} max={2.5} step={0.1} value={playerScale} onChange={(e) => setPlayerScale(Number(e.target.value))} className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between"><label className="text-sm font-hand font-bold text-ink-800">World scale</label><span className="text-sm font-hand font-bold">{worldScale.toFixed(1)}\u00d7</span></div>
                <input type="range" min={0.4} max={2} step={0.1} value={worldScale} onChange={(e) => setWorldScale(Number(e.target.value))} className="w-full" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80 p-6 z-30">
            <div className="text-center space-y-3 max-w-xs">
              <XCircle size={40} className="text-red-400 mx-auto" />
              <p className="text-paper-100 font-hand text-sm">{error}</p>
              <button onClick={() => { setError(null); void startCamera(); }} className="btn-sketch text-sm">Try Again</button>
            </div>
          </div>
        )}

        {!cameraReady && !error && !hasGrid && !arTestMode && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900 z-30">
            <div className="text-center space-y-3">
              <Loader2 size={32} className="text-paper-100/60 animate-spin mx-auto" />
              <p className="text-paper-100/60 font-hand text-sm">Starting camera\u2026</p>
            </div>
          </div>
        )}

        {!hasGrid && !arTestMode && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center z-10">
            <button onClick={capturePhoto} disabled={!cameraReady || isCapturing} className="btn-sketch flex items-center gap-2 disabled:opacity-40">
              {isCapturing ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              <span>{isCapturing ? 'Processing\u2026' : 'Capture Paper'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
