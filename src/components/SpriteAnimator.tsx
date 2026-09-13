import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Layers,
  Eraser,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Save,
  FolderOpen,
  Play,
  Square,
  Grid3x3,
  Download,
  Undo2,
  Redo2,
  Ruler,
  Settings2,
} from 'lucide-react';
import type { SpriteFrame } from '@/types';

const CANVAS_SIZE = 128;
const STORAGE_KEY = 'sketchbook-ar-walk-cycles-v1';
const ANIM_STORAGE = 'sketchbook-ar-animations-v1';

type AnimSlot = 'walk' | 'idle' | 'jump';

interface SavedCycle {
  id: string;
  name: string;
  frames: SpriteFrame[];
  slot: AnimSlot;
  updatedAt: number;
}

interface OnionSettings {
  beforeCount: number;
  afterCount: number;
  beforeColor: string;
  afterColor: string;
  beforeOpacity: number;
  afterOpacity: number;
}

interface GuideSettings {
  color: string;
  opacity: number;
}

const WALK_TEMPLATES: { name: string; draw: (ctx: CanvasRenderingContext2D, color: string, alpha: number) => void }[] = [
  { name: 'Contact L', draw: (ctx, c, a) => stick(ctx, 64, 28, -18, 12, 22, -20, 18, -8, c, a) },
  { name: 'Down', draw: (ctx, c, a) => stick(ctx, 64, 32, -14, 8, 16, -12, 14, 4, c, a) },
  { name: 'Pass L', draw: (ctx, c, a) => stick(ctx, 64, 28, -8, 16, 10, -6, 20, -18, c, a) },
  { name: 'Up / Push', draw: (ctx, c, a) => stick(ctx, 64, 26, 6, 18, -4, 10, -16, 20, c, a) },
  { name: 'Contact R', draw: (ctx, c, a) => stick(ctx, 64, 28, 18, -12, -22, 20, -18, 8, c, a) },
  { name: 'Down R', draw: (ctx, c, a) => stick(ctx, 64, 32, 14, -8, -16, 12, -14, -4, c, a) },
  { name: 'Pass R', draw: (ctx, c, a) => stick(ctx, 64, 28, 8, -16, -10, 6, -20, 18, c, a) },
  { name: 'Up R', draw: (ctx, c, a) => stick(ctx, 64, 26, -6, -18, 4, -10, 16, -20, c, a) },
];

const DEFAULT_4 = [0, 2, 4, 6];

function stick(
  ctx: CanvasRenderingContext2D,
  cx: number, headY: number,
  armL: number, armR: number,
  legL: number, legR: number,
  legLx: number, legRx: number,
  color: string, alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, headY, 10, 0, Math.PI * 2);
  ctx.stroke();
  const hipY = headY + 28;
  ctx.beginPath();
  ctx.moveTo(cx, headY + 10);
  ctx.lineTo(cx, hipY);
  ctx.stroke();
  const shoulderY = headY + 16;
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx + armL, shoulderY + 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx + armR, shoulderY + 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + legLx + legL * 0.3, hipY + 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + legRx + legR * 0.3, hipY + 22);
  ctx.stroke();
  ctx.restore();
}

function blankInk(): string {
  const c = document.createElement('canvas');
  c.width = CANVAS_SIZE;
  c.height = CANVAS_SIZE;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f3e8';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  return c.toDataURL();
}

function createDefaultWalk(): SpriteFrame[] {
  return DEFAULT_4.map((ti) => ({
    id: `f-${ti}-${Math.random().toString(36).slice(2, 7)}`,
    imageData: blankInk(),
    name: WALK_TEMPLATES[ti].name,
  }));
}

function loadLibrary(): SavedCycle[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLibrary(cycles: SavedCycle[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cycles));
  } catch { /* ignore */ }
}

function tintImage(
  src: string,
  color: string,
  opacity: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = CANVAS_SIZE;
      c.height = CANVAS_SIZE;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // tint non-paper pixels
      const id = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const d = id.data;
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      for (let i = 0; i < d.length; i += 4) {
        const brightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (brightness < 220 && d[i + 3] > 20) {
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
          d[i + 3] = Math.round(255 * opacity);
        } else {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(id, 0, 0);
      resolve(c);
    };
    img.src = src;
  });
}

export function SpriteAnimator() {
  const [frames, setFrames] = useState<SpriteFrame[]>(() => createDefaultWalk());
  const [activeIdx, setActiveIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(3);
  const [showOnion, setShowOnion] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [eraseMode, setEraseMode] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cycleName, setCycleName] = useState('My Walk');
  const [library, setLibrary] = useState<SavedCycle[]>(() => loadLibrary());
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [animOpen, setAnimOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<AnimSlot>('walk');
  const [onionPanel, setOnionPanel] = useState(false);
  const [guidePanel, setGuidePanel] = useState(false);

  const [onion, setOnion] = useState<OnionSettings>({
    beforeCount: 1,
    afterCount: 1,
    beforeColor: '#22c55e',
    afterColor: '#3b82f6',
    beforeOpacity: 0.35,
    afterOpacity: 0.3,
  });

  const [traceColor, setTraceColor] = useState('#ef4444');
  const [traceOpacity, setTraceOpacity] = useState(0.45);
  const [guideSet, setGuideSet] = useState<GuideSettings>({ color: '#eab308', opacity: 0.55 });

  // Ink-only history per frame for undo/redo
  const historyRef = useRef<Record<string, string[]>>({});
  const histIdxRef = useRef<Record<string, number>>({});
  const [histTick, setHistTick] = useState(0);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const playTimer = useRef<number | null>(null);

  const frameId = frames[activeIdx]?.id;

  const ensureHistory = (id: string, data: string) => {
    if (!historyRef.current[id]) {
      historyRef.current[id] = [data];
      histIdxRef.current[id] = 0;
    }
  };

  const pushHistory = (id: string, data: string) => {
    ensureHistory(id, data);
    const arr = historyRef.current[id];
    const idx = histIdxRef.current[id];
    const next = arr.slice(0, idx + 1);
    next.push(data);
    if (next.length > 40) next.shift();
    historyRef.current[id] = next;
    histIdxRef.current[id] = next.length - 1;
    setHistTick((t) => t + 1);
  };

  const canUndo = frameId ? (histIdxRef.current[frameId] ?? 0) > 0 : false;
  const canRedo = frameId
    ? (histIdxRef.current[frameId] ?? 0) < (historyRef.current[frameId]?.length ?? 1) - 1
    : false;

  const undo = () => {
    if (!frameId || !canUndo) return;
    histIdxRef.current[frameId] -= 1;
    const data = historyRef.current[frameId][histIdxRef.current[frameId]];
    setFrames((prev) => {
      const n = [...prev];
      n[activeIdx] = { ...n[activeIdx], imageData: data };
      return n;
    });
    setHistTick((t) => t + 1);
  };

  const redo = () => {
    if (!frameId || !canRedo) return;
    histIdxRef.current[frameId] += 1;
    const data = historyRef.current[frameId][histIdxRef.current[frameId]];
    setFrames((prev) => {
      const n = [...prev];
      n[activeIdx] = { ...n[activeIdx], imageData: data };
      return n;
    });
    setHistTick((t) => t + 1);
  };

  const loadInk = useCallback((dataUrl: string) => {
    const canvas = inkRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.drawImage(img, 0, 0);
      composite();
    };
    img.src = dataUrl;
  }, []);

  const composite = useCallback(async () => {
    const display = displayRef.current;
    const ink = inkRef.current;
    if (!display || !ink) return;
    const ctx = display.getContext('2d')!;

    ctx.fillStyle = '#f7f3e8';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Yellow layout guides
    if (showGuides) {
      ctx.save();
      ctx.globalAlpha = guideSet.opacity;
      ctx.strokeStyle = guideSet.color;
      ctx.lineWidth = 1;
      // ground
      ctx.beginPath();
      ctx.moveTo(8, 100);
      ctx.lineTo(120, 100);
      ctx.stroke();
      // vertical center
      ctx.beginPath();
      ctx.moveTo(64, 8);
      ctx.lineTo(64, 120);
      ctx.stroke();
      // head height
      ctx.beginPath();
      ctx.moveTo(8, 28);
      ctx.lineTo(120, 28);
      ctx.stroke();
      ctx.restore();
    }

    // Red trace template
    if (showTrace) {
      const ti = frames.length === 8 ? activeIdx : DEFAULT_4[activeIdx % DEFAULT_4.length];
      WALK_TEMPLATES[ti % WALK_TEMPLATES.length].draw(ctx, traceColor, traceOpacity);
    }

    // Onion before (green)
    if (showOnion && onion.beforeCount > 0) {
      for (let i = onion.beforeCount; i >= 1; i--) {
        const fi = activeIdx - i;
        if (fi < 0) continue;
        const op = onion.beforeOpacity * (1 - (i - 1) * 0.25);
        const tinted = await tintImage(frames[fi].imageData, onion.beforeColor, Math.max(0.1, op));
        ctx.drawImage(tinted, 0, 0);
      }
    }

    // Onion after (blue)
    if (showOnion && onion.afterCount > 0) {
      for (let i = 1; i <= onion.afterCount; i++) {
        const fi = activeIdx + i;
        if (fi >= frames.length) continue;
        const op = onion.afterOpacity * (1 - (i - 1) * 0.25);
        const tinted = await tintImage(frames[fi].imageData, onion.afterColor, Math.max(0.1, op));
        ctx.drawImage(tinted, 0, 0);
      }
    }

    // Current ink on top
    ctx.drawImage(ink, 0, 0);
  }, [showGuides, guideSet, showTrace, traceColor, traceOpacity, showOnion, onion, frames, activeIdx]);

  useEffect(() => {
    const f = frames[activeIdx];
    if (!f) return;
    ensureHistory(f.id, f.imageData);
    loadInk(f.imageData);
  }, [activeIdx, frames, loadInk]);

  useEffect(() => {
    composite();
  }, [composite, histTick]);

  useEffect(() => {
    if (!playing) {
      if (playTimer.current) window.clearInterval(playTimer.current);
      return;
    }
    playTimer.current = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % frames.length);
    }, 140);
    return () => {
      if (playTimer.current) window.clearInterval(playTimer.current);
    };
  }, [playing, frames.length]);

  const getPos = (e: React.PointerEvent) => {
    const c = displayRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS_SIZE,
      y: ((e.clientY - r.top) / r.height) * CANVAS_SIZE,
    };
  };

  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    displayRef.current?.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getPos(e);
    paint(e);
  };

  const paint = (e: React.PointerEvent) => {
    if (!isDrawing && e.type !== 'pointerdown') return;
    const ink = inkRef.current;
    if (!ink) return;
    const ctx = ink.getContext('2d')!;
    const pos = getPos(e);

    if (eraseMode) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 3;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = brushSize;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPos.current = pos;
    ctx.globalCompositeOperation = 'source-over';
    composite();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;
    const ink = inkRef.current;
    if (!ink || !frameId) return;
    const data = ink.toDataURL();
    pushHistory(frameId, data);
    setFrames((prev) => {
      const n = [...prev];
      n[activeIdx] = { ...n[activeIdx], imageData: data };
      return n;
    });
  };

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 2200);
  };

  const addFrame = () => {
    const ti = frames.length % WALK_TEMPLATES.length;
    const f: SpriteFrame = {
      id: `f-${Date.now()}`,
      imageData: blankInk(),
      name: WALK_TEMPLATES[ti].name,
    };
    setFrames((p) => [...p, f]);
    setActiveIdx(frames.length);
  };

  const insertFrame = () => {
    const ti = activeIdx % WALK_TEMPLATES.length;
    const f: SpriteFrame = {
      id: `f-${Date.now()}`,
      imageData: blankInk(),
      name: WALK_TEMPLATES[ti].name,
    };
    setFrames((p) => {
      const n = [...p];
      n.splice(activeIdx + 1, 0, f);
      return n;
    });
    setActiveIdx(activeIdx + 1);
  };

  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return;
    setFrames((p) => p.filter((_, i) => i !== idx));
    setActiveIdx(Math.max(0, Math.min(activeIdx, frames.length - 2)));
  };

  const moveFrame = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= frames.length) return;
    setFrames((p) => {
      const n = [...p];
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
    setActiveIdx(j);
  };

  const clearFrame = () => {
    const data = blankInk();
    if (frameId) pushHistory(frameId, data);
    setFrames((p) => {
      const n = [...p];
      n[activeIdx] = { ...n[activeIdx], imageData: data };
      return n;
    });
  };

  const saveNamed = () => {
    const name = cycleName.trim() || 'Untitled';
    const entry: SavedCycle = {
      id: `c-${Date.now()}`,
      name,
      frames: frames.map((f) => ({ ...f })),
      slot: activeSlot,
      updatedAt: Date.now(),
    };
    const next = [entry, ...library.filter((c) => !(c.name === name && c.slot === activeSlot))];
    setLibrary(next);
    saveLibrary(next);
    flash(`Saved “${name}” (${activeSlot})`);
  };

  const exportSlot = () => {
    try {
      const key =
        activeSlot === 'walk'
          ? 'sketchbook-ar-active-walk'
          : activeSlot === 'idle'
            ? 'sketchbook-ar-active-idle'
            : 'sketchbook-ar-active-jump';
      localStorage.setItem(key, JSON.stringify(frames.map((f) => f.imageData)));
      // also store which slots exist
      const meta = JSON.parse(localStorage.getItem(ANIM_STORAGE) || '{}');
      meta[activeSlot] = true;
      localStorage.setItem(ANIM_STORAGE, JSON.stringify(meta));
      flash(`${activeSlot} animation set for AR Play`);
    } catch {
      flash('Could not export');
    }
  };

  const ColorRow = ({
    label,
    color,
    opacity,
    onColor,
    onOpacity,
  }: {
    label: string;
    color: string;
    opacity: number;
    onColor: (c: string) => void;
    onOpacity: (o: number) => void;
  }) => (
    <div className="flex items-center gap-2 text-xs font-hand">
      <span className="w-16 text-ink-600 shrink-0">{label}</span>
      <input type="color" value={color} onChange={(e) => onColor(e.target.value)} className="w-8 h-8 rounded border border-ink-800/20" />
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={opacity}
        onChange={(e) => onOpacity(Number(e.target.value))}
        className="flex-1"
      />
      <span className="tabular-nums w-8 text-ink-500">{Math.round(opacity * 100)}%</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full paper-bg overflow-y-auto no-scrollbar">
      <div className="max-w-md mx-auto w-full px-4 py-4 space-y-3 pb-10">
        <header className="space-y-0.5">
          <h2 className="text-2xl font-script font-bold text-ink-800">Animator</h2>
          <p className="text-xs font-hand text-ink-500">
            Green = previous · Blue = next · Red = trace · Yellow = layout guides
          </p>
        </header>

        {/* Canvas */}
        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-2 shadow-inner">
          <canvas ref={inkRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="hidden" />
          <div className="relative w-full" style={{ paddingBottom: '100%' }}>
            <canvas
              ref={displayRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="absolute inset-0 w-full h-full rounded touch-none cursor-crosshair"
              onPointerDown={startDraw}
              onPointerMove={paint}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
            />
          </div>
          <div className="absolute top-3 left-3 text-[10px] font-hand font-bold text-ink-600 bg-paper-100/90 px-1.5 py-0.5 rounded">
            {frames[activeIdx]?.name ?? `Frame ${activeIdx + 1}`}
          </div>
        </div>

        {/* Undo / redo / brush */}
        <div className="flex items-center gap-2">
          <button onClick={undo} disabled={!canUndo} className="p-2 border-2 border-ink-800/20 rounded-lg disabled:opacity-30" aria-label="Undo">
            <Undo2 size={16} />
          </button>
          <button onClick={redo} disabled={!canRedo} className="p-2 border-2 border-ink-800/20 rounded-lg disabled:opacity-30" aria-label="Redo">
            <Redo2 size={16} />
          </button>
          <input type="range" min={1} max={10} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="flex-1" />
          <button
            onClick={() => setEraseMode(!eraseMode)}
            className={`p-2 rounded-lg border-2 ${eraseMode ? 'border-red-500 bg-red-50 text-red-600' : 'border-ink-800/20'}`}
          >
            <Eraser size={16} />
          </button>
        </div>

        {/* Layer toggles */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => setShowOnion(!showOnion)}
            onContextMenu={(e) => { e.preventDefault(); setOnionPanel(!onionPanel); }}
            className={`flex flex-col items-center gap-0.5 p-2 border-2 rounded-lg text-[10px] font-hand font-bold ${
              showOnion ? 'border-green-600 bg-green-50 text-green-800' : 'border-ink-800/20 text-ink-500'
            }`}
          >
            <Layers size={14} />
            Onion
          </button>
          <button
            onClick={() => setShowTrace(!showTrace)}
            className={`flex flex-col items-center gap-0.5 p-2 border-2 rounded-lg text-[10px] font-hand font-bold ${
              showTrace ? 'border-red-500 bg-red-50 text-red-700' : 'border-ink-800/20 text-ink-500'
            }`}
          >
            <Grid3x3 size={14} />
            Trace
          </button>
          <button
            onClick={() => setShowGuides(!showGuides)}
            onContextMenu={(e) => { e.preventDefault(); setGuidePanel(!guidePanel); }}
            className={`flex flex-col items-center gap-0.5 p-2 border-2 rounded-lg text-[10px] font-hand font-bold ${
              showGuides ? 'border-yellow-500 bg-yellow-50 text-yellow-800' : 'border-ink-800/20 text-ink-500'
            }`}
          >
            <Ruler size={14} />
            Guides
          </button>
        </div>

        <button
          onClick={() => setOnionPanel(!onionPanel)}
          className="w-full flex items-center justify-center gap-1 text-[11px] font-hand text-ink-500"
        >
          <Settings2 size={12} /> Onion & guide colors
          {onionPanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {onionPanel && (
          <div className="space-y-2 p-3 border-2 border-ink-800/15 rounded-lg bg-paper-100/80">
            <p className="text-[10px] font-hand font-bold text-ink-700">Onion skin</p>
            <ColorRow
              label="Before"
              color={onion.beforeColor}
              opacity={onion.beforeOpacity}
              onColor={(c) => setOnion((o) => ({ ...o, beforeColor: c }))}
              onOpacity={(o) => setOnion((s) => ({ ...s, beforeOpacity: o }))}
            />
            <ColorRow
              label="After"
              color={onion.afterColor}
              opacity={onion.afterOpacity}
              onColor={(c) => setOnion((o) => ({ ...o, afterColor: c }))}
              onOpacity={(o) => setOnion((s) => ({ ...s, afterOpacity: o }))}
            />
            <div className="flex items-center gap-3 text-xs font-hand">
              <label className="flex items-center gap-1">
                Before
                <select
                  value={onion.beforeCount}
                  onChange={(e) => setOnion((o) => ({ ...o, beforeCount: Number(e.target.value) }))}
                  className="border rounded px-1"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                After
                <select
                  value={onion.afterCount}
                  onChange={(e) => setOnion((o) => ({ ...o, afterCount: Number(e.target.value) }))}
                  className="border rounded px-1"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[10px] font-hand font-bold text-ink-700 pt-1">Trace (red silhouette)</p>
            <ColorRow label="Trace" color={traceColor} opacity={traceOpacity} onColor={setTraceColor} onOpacity={setTraceOpacity} />
            <p className="text-[10px] font-hand font-bold text-ink-700 pt-1">Layout guides</p>
            <ColorRow
              label="Guides"
              color={guideSet.color}
              opacity={guideSet.opacity}
              onColor={(c) => setGuideSet((g) => ({ ...g, color: c }))}
              onOpacity={(o) => setGuideSet((g) => ({ ...g, opacity: o }))}
            />
          </div>
        )}

        {/* Playback */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setPlaying(!playing)} className="flex items-center gap-1 px-3 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold">
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? 'Stop' : 'Play'}
          </button>
          <button onClick={insertFrame} className="px-2 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold flex items-center gap-1">
            <Plus size={14} /> Insert
          </button>
          <button onClick={addFrame} className="px-2 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold flex items-center gap-1">
            <Plus size={14} /> Add
          </button>
          <button onClick={clearFrame} className="ml-auto text-xs font-hand text-ink-500">Clear</button>
        </div>

        {/* Frames */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-hand font-bold text-ink-700 text-sm">Frames ({frames.length})</h3>
            <div className="flex gap-1">
              <button onClick={() => moveFrame(activeIdx, -1)} disabled={activeIdx === 0} className="p-1.5 border border-ink-800/20 rounded disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => moveFrame(activeIdx, 1)} disabled={activeIdx >= frames.length - 1} className="p-1.5 border border-ink-800/20 rounded disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {frames.map((frame, idx) => (
              <div
                key={frame.id}
                onClick={() => { setPlaying(false); setActiveIdx(idx); }}
                className={`relative shrink-0 rounded-lg overflow-hidden border-2 ${idx === activeIdx ? 'border-ink-800 scale-105 shadow-md' : 'border-ink-800/20'}`}
              >
                <img src={frame.imageData} alt={frame.name} className="w-14 h-14 block bg-paper-100" />
                {frames.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteFrame(idx); }}
                    className="absolute top-0.5 right-0.5 bg-paper-100/90 rounded-full p-0.5"
                  >
                    <Trash2 size={10} className="text-red-500" />
                  </button>
                )}
                <span className="absolute bottom-0 left-0 right-0 text-[8px] font-hand text-center bg-paper-100/80 py-0.5 truncate px-0.5">
                  {frame.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Animations menu (collapsed) */}
        <div className="border-2 border-ink-800/15 rounded-lg overflow-hidden">
          <button
            onClick={() => setAnimOpen(!animOpen)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-paper-200/60 text-sm font-hand font-bold text-ink-800"
          >
            Animations
            {animOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {animOpen && (
            <div className="p-3 space-y-2 bg-paper-100/50">
              <p className="text-[10px] font-hand text-ink-500">Choose slot, then export for AR Play (left/right walk uses Walk).</p>
              <div className="grid grid-cols-3 gap-2">
                {(['walk', 'idle', 'jump'] as AnimSlot[]).map((slot) => (
                  <button
                    key={slot}
                    onClick={() => setActiveSlot(slot)}
                    className={`py-2 rounded-lg border-2 text-xs font-hand font-bold capitalize ${
                      activeSlot === slot ? 'border-ink-800 bg-ink-800 text-paper-100' : 'border-ink-800/20'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
              <button
                onClick={exportSlot}
                className="w-full flex items-center justify-center gap-2 p-2.5 border-2 border-green-700/40 bg-green-50 rounded-lg text-sm font-hand font-bold text-green-800"
              >
                <Download size={16} />
                Use as {activeSlot} in AR Play
              </button>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="space-y-2 border-t-2 border-dashed border-ink-800/15 pt-3">
          <h3 className="font-hand font-bold text-ink-700 text-sm flex items-center gap-1.5">
            <Save size={14} /> Save
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={cycleName}
              onChange={(e) => setCycleName(e.target.value)}
              className="flex-1 px-3 py-2 border-2 border-ink-800/20 rounded-lg text-sm font-hand bg-paper-100"
              placeholder="Name"
            />
            <button onClick={saveNamed} className="btn-sketch text-xs px-3">Save</button>
          </div>
          {statusMsg && <p className="text-xs font-hand text-center text-green-700">{statusMsg}</p>}
        </div>

        {/* Templates */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setFrames(createDefaultWalk());
              setActiveIdx(0);
              flash('4-frame walk template');
            }}
            className="p-2.5 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold text-left"
          >
            4-frame walk
          </button>
          <button
            onClick={() => {
              setFrames(
                WALK_TEMPLATES.map((t, i) => ({
                  id: `f8-${i}-${Date.now()}`,
                  imageData: blankInk(),
                  name: t.name,
                }))
              );
              setActiveIdx(0);
              flash('8-frame full cycle');
            }}
            className="p-2.5 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold text-left"
          >
            8-frame full cycle
          </button>
        </div>

        {/* Library */}
        <div className="space-y-2">
          <h3 className="font-hand font-bold text-ink-700 text-sm flex items-center gap-1.5">
            <FolderOpen size={14} /> Saved
          </h3>
          {library.length === 0 ? (
            <p className="text-xs font-hand text-ink-400">No saves yet.</p>
          ) : (
            library.map((c) => (
              <div key={c.id} className="flex items-center gap-2 p-2 border border-ink-800/15 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-hand font-bold truncate">{c.name}</p>
                  <p className="text-[10px] text-ink-400">{c.frames.length}f · {c.slot}</p>
                </div>
                <button
                  onClick={() => {
                    setFrames(c.frames.map((f) => ({ ...f })));
                    setActiveIdx(0);
                    setActiveSlot(c.slot);
                    setCycleName(c.name);
                    flash(`Loaded ${c.name}`);
                  }}
                  className="text-[11px] font-hand font-bold px-2 py-1 border rounded"
                >
                  Load
                </button>
                <button
                  onClick={() => {
                    const next = library.filter((x) => x.id !== c.id);
                    setLibrary(next);
                    saveLibrary(next);
                  }}
                  className="p-1 text-red-500"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
