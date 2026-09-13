import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Layers,
  Eraser,
  ChevronLeft,
  ChevronRight,
  Save,
  FolderOpen,
  Play,
  Square,
  Grid3x3,
  Download,
} from 'lucide-react';
import type { SpriteFrame } from '@/types';

const CANVAS_SIZE = 128;
const STORAGE_KEY = 'sketchbook-ar-walk-cycles-v1';

interface SavedCycle {
  id: string;
  name: string;
  frames: SpriteFrame[];
  updatedAt: number;
}

/** Stick-figure pose guides matching classic walk-cycle keypoints */
const WALK_TEMPLATES: { name: string; draw: (ctx: CanvasRenderingContext2D) => void }[] = [
  {
    name: 'Contact L',
    draw: (ctx) => {
      stick(ctx, 64, 28, -18, 12, 22, -20, 18, -8);
    },
  },
  {
    name: 'Down',
    draw: (ctx) => {
      stick(ctx, 64, 32, -14, 8, 16, -12, 14, 4);
    },
  },
  {
    name: 'Pass L',
    draw: (ctx) => {
      stick(ctx, 64, 28, -8, 16, 10, -6, 20, -18);
    },
  },
  {
    name: 'Up / Push',
    draw: (ctx) => {
      stick(ctx, 64, 26, 6, 18, -4, 10, -16, 20);
    },
  },
  {
    name: 'Contact R',
    draw: (ctx) => {
      stick(ctx, 64, 28, 18, -12, -22, 20, -18, 8);
    },
  },
  {
    name: 'Down R',
    draw: (ctx) => {
      stick(ctx, 64, 32, 14, -8, -16, 12, -14, -4);
    },
  },
  {
    name: 'Pass R',
    draw: (ctx) => {
      stick(ctx, 64, 28, 8, -16, -10, 6, -20, 18);
    },
  },
  {
    name: 'Up R',
    draw: (ctx) => {
      stick(ctx, 64, 26, -6, -18, 4, -10, 16, -20);
    },
  },
];

/** Simple 4-frame starter set (every other pose) */
const DEFAULT_4 = [0, 2, 4, 6];

function stick(
  ctx: CanvasRenderingContext2D,
  cx: number,
  headY: number,
  armL: number,
  armR: number,
  legL: number,
  legR: number,
  legLx = 0,
  legRx = 0
) {
  ctx.strokeStyle = 'rgba(100, 140, 180, 0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // head
  ctx.beginPath();
  ctx.arc(cx, headY, 10, 0, Math.PI * 2);
  ctx.stroke();

  // body
  const hipY = headY + 28;
  ctx.beginPath();
  ctx.moveTo(cx, headY + 10);
  ctx.lineTo(cx, hipY);
  ctx.stroke();

  // arms
  const shoulderY = headY + 16;
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx + armL, shoulderY + 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx + armR, shoulderY + 16);
  ctx.stroke();

  // legs
  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + legLx + legL * 0.3, hipY + 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + legRx + legR * 0.3, hipY + 22);
  ctx.stroke();
}

function drawGuide(ctx: CanvasRenderingContext2D, templateIdx: number) {
  // light grid
  ctx.strokeStyle = 'rgba(120, 160, 200, 0.2)';
  ctx.lineWidth = 1;
  for (let i = 32; i < CANVAS_SIZE; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, CANVAS_SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(CANVAS_SIZE, i);
    ctx.stroke();
  }
  const t = WALK_TEMPLATES[templateIdx % WALK_TEMPLATES.length];
  t.draw(ctx);
}

function blankWithGuide(name: string, templateIdx: number, withGuide: boolean): SpriteFrame {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f3e8';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (withGuide) drawGuide(ctx, templateIdx);
  return {
    id: `frame-${Date.now()}-${templateIdx}-${Math.random().toString(36).slice(2, 6)}`,
    imageData: canvas.toDataURL(),
    name,
  };
}

function createDefaultWalkCycle(): SpriteFrame[] {
  return DEFAULT_4.map((ti, i) =>
    blankWithGuide(WALK_TEMPLATES[ti].name, ti, true)
  );
}

function loadLibrary(): SavedCycle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedCycle[];
  } catch {
    return [];
  }
}

function saveLibrary(cycles: SavedCycle[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cycles));
  } catch {
    /* ignore */
  }
}

interface SpriteAnimatorProps {
  /** Called when user exports a cycle for in-game use */
  onExportWalkCycle?: (frames: SpriteFrame[]) => void;
}

export function SpriteAnimator({ onExportWalkCycle }: SpriteAnimatorProps) {
  const [frames, setFrames] = useState<SpriteFrame[]>(() => createDefaultWalkCycle());
  const [activeIdx, setActiveIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(3);
  const [showOnionSkin, setShowOnionSkin] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [eraseMode, setEraseMode] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cycleName, setCycleName] = useState('My Walk');
  const [library, setLibrary] = useState<SavedCycle[]>(() => loadLibrary());
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const playTimer = useRef<number | null>(null);

  const compositeFrame = useCallback(
    (idx: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !frames[idx]) return;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#f7f3e8';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Trace guide under drawing
      if (showGuides) {
        const templateIdx = DEFAULT_4[idx % DEFAULT_4.length] ?? idx;
        // Prefer matching template by frame order in 8-pose set if length is 8
        const ti = frames.length === 8 ? idx : DEFAULT_4[idx % DEFAULT_4.length];
        drawGuide(ctx, ti);
      }

      // Onion skin previous
      if (showOnionSkin && idx > 0) {
        const prev = new Image();
        prev.onload = () => {
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.drawImage(prev, 0, 0);
          ctx.restore();
          // redraw current on top after onion
          const cur = new Image();
          cur.onload = () => ctx.drawImage(cur, 0, 0);
          cur.src = frames[idx].imageData;
        };
        prev.src = frames[idx - 1].imageData;
        return;
      }

      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = frames[idx].imageData;
    },
    [frames, showOnionSkin, showGuides]
  );

  useEffect(() => {
    compositeFrame(activeIdx);
  }, [activeIdx, compositeFrame, showOnionSkin, showGuides]);

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

  const getCanvasPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getCanvasPos(e);
    paint(e);
  };

  const paint = (e: React.PointerEvent) => {
    if (!isDrawing && e.type !== 'pointerdown') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);

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
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Save only ink — strip guides by exporting as drawn (guides redrawn each load)
    // For true separate layers we'd keep ink-only canvas; for v1 save full visible
    // Rebuild ink: clear, no guide, redraw from previous frame image + new strokes is hard.
    // Practical approach: save current composite WITHOUT guides for storage:
    const tmp = document.createElement('canvas');
    tmp.width = CANVAS_SIZE;
    tmp.height = CANVAS_SIZE;
    const tctx = tmp.getContext('2d')!;
    tctx.fillStyle = '#f7f3e8';
    tctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    // Use what's on the main canvas but user may have drawn over guides — OK for tracing workflow
    tctx.drawImage(canvas, 0, 0);

    const data = tmp.toDataURL();
    setFrames((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], imageData: data };
      return next;
    });
  };

  const addFrame = () => {
    const ti = frames.length % WALK_TEMPLATES.length;
    setFrames((prev) => [...prev, blankWithGuide(WALK_TEMPLATES[ti].name, ti, showGuides)]);
    setActiveIdx(frames.length);
  };

  const insertFrame = () => {
    const ti = activeIdx % WALK_TEMPLATES.length;
    const frame = blankWithGuide(WALK_TEMPLATES[ti].name, ti, showGuides);
    setFrames((prev) => {
      const next = [...prev];
      next.splice(activeIdx + 1, 0, frame);
      return next;
    });
    setActiveIdx(activeIdx + 1);
  };

  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return;
    setFrames((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx(Math.max(0, Math.min(activeIdx, frames.length - 2)));
  };

  const moveFrame = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= frames.length) return;
    setFrames((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setActiveIdx(j);
  };

  const clearFrame = () => {
    const ti = frames.length === 8 ? activeIdx : DEFAULT_4[activeIdx % DEFAULT_4.length];
    const blank = blankWithGuide(frames[activeIdx]?.name ?? 'Frame', ti, showGuides);
    setFrames((prev) => {
      const next = [...prev];
      next[activeIdx] = blank;
      return next;
    });
  };

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 2000);
  };

  const saveNamed = () => {
    const name = cycleName.trim() || 'Untitled Walk';
    const entry: SavedCycle = {
      id: `cycle-${Date.now()}`,
      name,
      frames: frames.map((f) => ({ ...f })),
      updatedAt: Date.now(),
    };
    const next = [entry, ...library.filter((c) => c.name !== name)];
    setLibrary(next);
    saveLibrary(next);
    flash(`Saved “${name}”`);
  };

  const loadCycle = (cycle: SavedCycle) => {
    setFrames(cycle.frames.map((f) => ({ ...f })));
    setActiveIdx(0);
    setCycleName(cycle.name);
    setPlaying(false);
    flash(`Loaded “${cycle.name}”`);
  };

  const deleteCycle = (id: string) => {
    const next = library.filter((c) => c.id !== id);
    setLibrary(next);
    saveLibrary(next);
  };

  const loadDefault4 = () => {
    setFrames(createDefaultWalkCycle());
    setActiveIdx(0);
    setCycleName('Default Walk');
    flash('Loaded 4-frame walk template');
  };

  const loadFull8 = () => {
    setFrames(WALK_TEMPLATES.map((t, i) => blankWithGuide(t.name, i, true)));
    setActiveIdx(0);
    setCycleName('Full Walk Cycle');
    flash('Loaded 8-frame walk template');
  };

  const exportToGame = () => {
    onExportWalkCycle?.(frames);
    // Also stash for Phaser to pick up
    try {
      localStorage.setItem(
        'sketchbook-ar-active-walk',
        JSON.stringify(frames.map((f) => f.imageData))
      );
    } catch {
      /* ignore */
    }
    flash('Walk cycle set for in-game character');
  };

  return (
    <div className="flex flex-col h-full paper-bg overflow-y-auto no-scrollbar">
      <div className="max-w-md mx-auto w-full px-4 py-4 space-y-4 pb-8">
        <header className="space-y-1">
          <h2 className="text-2xl font-script font-bold text-ink-800">Walk Cycle</h2>
          <p className="text-xs font-hand text-ink-500">
            Trace the guide, toggle onion skin, save named cycles, export to the stickman.
          </p>
        </header>

        {/* Canvas */}
        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-2 shadow-inner">
          <div className="relative w-full" style={{ paddingBottom: '100%' }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="absolute inset-0 w-full h-full rounded touch-none cursor-crosshair"
              onPointerDown={startDraw}
              onPointerMove={paint}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
            />
          </div>
          <div className="absolute top-3 left-3 text-[10px] font-hand font-bold text-ink-500 bg-paper-100/80 px-1.5 py-0.5 rounded">
            {frames[activeIdx]?.name ?? `Frame ${activeIdx + 1}`}
          </div>
        </div>

        {/* Brush + erase */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-hand font-bold text-ink-700 shrink-0">Brush</span>
          <input
            type="range"
            min={1}
            max={10}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs font-hand text-ink-600 tabular-nums w-5">{brushSize}</span>
          <button
            onClick={() => setEraseMode(!eraseMode)}
            className={`p-2 rounded-lg border-2 ${eraseMode ? 'border-red-500 bg-red-50 text-red-600' : 'border-ink-800/20 text-ink-500'}`}
            aria-label="Eraser"
          >
            <Eraser size={16} />
          </button>
        </div>

        {/* Toggles */}
        <div className="flex gap-2">
          <label className={`flex-1 flex items-center justify-center gap-1.5 p-2 border-2 rounded-lg text-xs font-hand font-bold cursor-pointer ${
            showOnionSkin ? 'border-ink-800 bg-ink-800/10' : 'border-ink-800/20 text-ink-500'
          }`}>
            <input
              type="checkbox"
              className="sr-only"
              checked={showOnionSkin}
              onChange={(e) => setShowOnionSkin(e.target.checked)}
            />
            <Layers size={14} />
            Onion skin
          </label>
          <label className={`flex-1 flex items-center justify-center gap-1.5 p-2 border-2 rounded-lg text-xs font-hand font-bold cursor-pointer ${
            showGuides ? 'border-ink-800 bg-ink-800/10' : 'border-ink-800/20 text-ink-500'
          }`}>
            <input
              type="checkbox"
              className="sr-only"
              checked={showGuides}
              onChange={(e) => setShowGuides(e.target.checked)}
            />
            <Grid3x3 size={14} />
            Trace guide
          </label>
        </div>

        {/* Playback + frame ops */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlaying(!playing)}
            className="flex items-center gap-1 px-3 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold"
          >
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? 'Stop' : 'Play'}
          </button>
          <button onClick={insertFrame} className="flex items-center gap-1 px-2 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold">
            <Plus size={14} /> Insert
          </button>
          <button onClick={addFrame} className="flex items-center gap-1 px-2 py-2 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold">
            <Plus size={14} /> Add
          </button>
          <button onClick={clearFrame} className="ml-auto text-xs font-hand text-ink-500 px-2">
            Clear frame
          </button>
        </div>

        {/* Frame strip */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-hand font-bold text-ink-700 text-sm">Frames ({frames.length})</h3>
            <div className="flex gap-1">
              <button
                onClick={() => moveFrame(activeIdx, -1)}
                disabled={activeIdx === 0}
                className="p-1.5 border border-ink-800/20 rounded disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => moveFrame(activeIdx, 1)}
                disabled={activeIdx >= frames.length - 1}
                className="p-1.5 border border-ink-800/20 rounded disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {frames.map((frame, idx) => (
              <div
                key={frame.id}
                className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                  idx === activeIdx ? 'border-ink-800 scale-105 shadow-md' : 'border-ink-800/20'
                }`}
                onClick={() => {
                  setPlaying(false);
                  setActiveIdx(idx);
                }}
              >
                <img src={frame.imageData} alt={frame.name} className="w-14 h-14 block bg-paper-100" />
                {frames.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFrame(idx);
                    }}
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

        {/* Save / export */}
        <div className="space-y-2 border-t-2 border-dashed border-ink-800/15 pt-3">
          <h3 className="font-hand font-bold text-ink-700 text-sm flex items-center gap-1.5">
            <Save size={14} /> Save & library
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={cycleName}
              onChange={(e) => setCycleName(e.target.value)}
              placeholder="Cycle name"
              className="flex-1 px-3 py-2 border-2 border-ink-800/20 rounded-lg text-sm font-hand bg-paper-100"
            />
            <button onClick={saveNamed} className="btn-sketch text-xs px-3 py-2">
              Save
            </button>
          </div>
          <button
            onClick={exportToGame}
            className="w-full flex items-center justify-center gap-2 p-2.5 border-2 border-green-700/40 bg-green-50 rounded-lg text-sm font-hand font-bold text-green-800"
          >
            <Download size={16} />
            Use this walk in AR Play
          </button>
          {statusMsg && (
            <p className="text-xs font-hand text-center text-green-700">{statusMsg}</p>
          )}
        </div>

        {/* Templates */}
        <div className="space-y-2">
          <h3 className="font-hand font-bold text-ink-700 text-sm">Walk templates</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={loadDefault4}
              className="p-2.5 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold text-left"
            >
              4-frame walk
              <span className="block text-[10px] font-normal text-ink-500">Contact · Pass · Contact · Pass</span>
            </button>
            <button
              onClick={loadFull8}
              className="p-2.5 border-2 border-ink-800/20 rounded-lg text-xs font-hand font-bold text-left"
            >
              8-frame full cycle
              <span className="block text-[10px] font-normal text-ink-500">Matches classic guide</span>
            </button>
          </div>
        </div>

        {/* Library */}
        <div className="space-y-2">
          <h3 className="font-hand font-bold text-ink-700 text-sm flex items-center gap-1.5">
            <FolderOpen size={14} /> Saved cycles
          </h3>
          {library.length === 0 ? (
            <p className="text-xs font-hand text-ink-400">No saved cycles yet — draw and Save above.</p>
          ) : (
            <div className="space-y-1.5">
              {library.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 p-2 border border-ink-800/15 rounded-lg bg-paper-100/80"
                >
                  <div className="flex -space-x-1">
                    {c.frames.slice(0, 3).map((f) => (
                      <img key={f.id} src={f.imageData} className="w-8 h-8 rounded border border-paper-200" alt="" />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-hand font-bold text-ink-800 truncate">{c.name}</p>
                    <p className="text-[10px] font-hand text-ink-400">{c.frames.length} frames</p>
                  </div>
                  <button
                    onClick={() => loadCycle(c)}
                    className="text-[11px] font-hand font-bold text-ink-700 px-2 py-1 border border-ink-800/20 rounded"
                  >
                    Load
                  </button>
                  <button onClick={() => deleteCycle(c.id)} className="p-1 text-red-500">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
