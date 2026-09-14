import { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Eraser, Pencil } from 'lucide-react';
import type { SpriteFrame } from '@/types';

const SIZE_OPTIONS = [128, 192, 256] as const;
type CanvasSize = (typeof SIZE_OPTIONS)[number];

const DEFAULT_FRAME_NAMES = ['Contact L', 'Pass L', 'Contact R', 'Pass R'];

function createBlankFrame(name: string, size: number): SpriteFrame {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size); // transparent
  return {
    id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    imageData: canvas.toDataURL('image/png'),
    name,
  };
}

function createInitialFrames(size: number): SpriteFrame[] {
  return DEFAULT_FRAME_NAMES.map((name) => createBlankFrame(name, size));
}

export function SpriteAnimator() {
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(128);
  const [frames, setFrames] = useState<SpriteFrame[]>(() => createInitialFrames(128));
  const [activeIdx, setActiveIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(3);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [isDrawing, setIsDrawing] = useState(false);

  // Layer A – guide (template + future onion skins). Not interactive.
  const guideRef = useRef<HTMLCanvasElement>(null);
  // Layer B – user drawing (ink only). Receives all pointer input.
  const drawRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // ─── Resize all frame canvases when size slider changes ───
  const handleSizeChange = (newSize: CanvasSize) => {
    if (newSize === canvasSize) return;

    // Scale existing frame imageData to the new resolution
    setFrames((prev) =>
      prev.map((frame) => {
        const src = document.createElement('canvas');
        const img = new Image();
        // Synchronous path using a temporary canvas
        const tmp = document.createElement('canvas');
        tmp.width = canvasSize;
        tmp.height = canvasSize;
        const tctx = tmp.getContext('2d')!;
        // We need the current pixels – for simplicity we recreate blank
        // (full resize of existing drawings can be improved later)
        const out = document.createElement('canvas');
        out.width = newSize;
        out.height = newSize;
        const octx = out.getContext('2d')!;
        octx.clearRect(0, 0, newSize, newSize);
        return {
          ...frame,
          imageData: out.toDataURL('image/png'),
        };
      })
    );

    setCanvasSize(newSize);
  };

  // ─── Load active frame onto drawing canvas ───
  const loadFrame = useCallback(
    (idx: number) => {
      const draw = drawRef.current;
      const guide = guideRef.current;
      if (!draw || !frames[idx]) return;

      // Resize canvases if needed
      if (draw.width !== canvasSize) {
        draw.width = canvasSize;
        draw.height = canvasSize;
      }
      if (guide && guide.width !== canvasSize) {
        guide.width = canvasSize;
        guide.height = canvasSize;
      }

      const ctx = draw.getContext('2d')!;
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
      };
      img.src = frames[idx].imageData;

      // Clear guide for now (skeleton + onion will be drawn here later)
      if (guide) {
        const gctx = guide.getContext('2d')!;
        gctx.clearRect(0, 0, canvasSize, canvasSize);
      }
    },
    [frames, canvasSize]
  );

  useEffect(() => {
    loadFrame(activeIdx);
  }, [activeIdx, canvasSize, loadFrame]);

  // ─── Pointer helpers ───
  const getPos = (e: React.PointerEvent) => {
    const canvas = drawRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasSize / rect.width),
      y: (e.clientY - rect.top) * (canvasSize / rect.height),
    };
  };

  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getPos(e);
    paint(e);
  };

  const paint = (e: React.PointerEvent) => {
    if (!isDrawing && e.type !== 'pointerdown') return;
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#2b2b2b';
    }

    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPos.current = pos;
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPos.current = null;

    const canvas = drawRef.current;
    if (!canvas) return;
    // Reset composite so future ops are normal
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';

    const data = canvas.toDataURL('image/png');
    setFrames((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], imageData: data };
      return next;
    });
  };

  const selectFrame = (idx: number) => {
    // Persist current drawing before switching
    const canvas = drawRef.current;
    if (canvas) {
      const data = canvas.toDataURL('image/png');
      setFrames((prev) => {
        const next = [...prev];
        next[activeIdx] = { ...next[activeIdx], imageData: data };
        return next;
      });
    }
    setActiveIdx(idx);
  };

  const addFrame = () => {
    const name = `Frame ${frames.length + 1}`;
    setFrames((prev) => [...prev, createBlankFrame(name, canvasSize)]);
    setActiveIdx(frames.length);
  };

  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return;
    setFrames((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => {
      if (idx < prev) return prev - 1;
      if (idx === prev) return Math.max(0, prev - 1);
      return prev;
    });
  };

  return (
    <div className="flex flex-col h-full paper-bg overflow-y-auto no-scrollbar">
      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-script font-bold text-ink-800">Sprite Animator</h2>
          <p className="text-sm font-hand text-ink-500">
            Dual-canvas editor. Draw on the top layer. Guide layer sits underneath.
          </p>
        </header>

        {/* ── Dual Canvas Stack ── */}
        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-3 shadow-inner">
          <div className="relative w-full" style={{ paddingBottom: '100%' }}>
            {/* White paper background */}
            <div className="absolute inset-0 rounded bg-white" />

            {/* Layer A – Guide (template + onion). pointer-events none */}
            <canvas
              ref={guideRef}
              width={canvasSize}
              height={canvasSize}
              className="absolute inset-0 w-full h-full rounded pointer-events-none"
              style={{ imageRendering: 'pixelated' }}
            />

            {/* Layer B – Drawing (ink only) */}
            <canvas
              ref={drawRef}
              width={canvasSize}
              height={canvasSize}
              className="absolute inset-0 w-full h-full rounded touch-none cursor-crosshair"
              style={{ imageRendering: 'pixelated' }}
              onPointerDown={startDraw}
              onPointerMove={paint}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
            />
          </div>

          {/* Size badge */}
          <div className="absolute top-2 right-2 text-[10px] font-hand bg-paper-100/90 px-1.5 py-0.5 rounded border border-ink-800/20">
            {canvasSize}×{canvasSize}
          </div>
        </div>

        {/* ── Size Slider ── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-hand font-bold text-ink-700">Character Size</span>
            <span className="text-xs font-hand text-ink-500">{canvasSize}px</span>
          </div>
          <div className="flex gap-2">
            {SIZE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSizeChange(s)}
                className={`flex-1 py-1.5 text-xs font-hand font-bold rounded-lg border-2 transition-colors ${
                  canvasSize === s
                    ? 'border-ink-800 bg-ink-800/10 text-ink-800'
                    : 'border-ink-800/20 text-ink-500'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Brush / Eraser ── */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => setTool('brush')}
              className={`p-2 rounded-lg border-2 transition-colors ${
                tool === 'brush'
                  ? 'border-ink-800 bg-ink-800/10 text-ink-800'
                  : 'border-ink-800/20 text-ink-500'
              }`}
              title="Brush"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-lg border-2 transition-colors ${
                tool === 'eraser'
                  ? 'border-ink-800 bg-ink-800/10 text-ink-800'
                  : 'border-ink-800/20 text-ink-500'
              }`}
              title="Eraser"
            >
              <Eraser size={16} />
            </button>
          </div>

          <input
            type="range"
            min={1}
            max={12}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs font-hand text-ink-600 tabular-nums w-6 text-right">{brushSize}</span>
        </div>

        {/* ── Frame List ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-hand font-bold text-ink-700 text-sm">
              Frames ({frames.length})
            </h3>
            <button
              onClick={addFrame}
              className="flex items-center gap-1 text-sm font-hand font-bold text-ink-700 active:scale-95 transition-transform"
            >
              <Plus size={16} /> Add
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
            {frames.map((frame, idx) => (
              <div
                key={frame.id}
                className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                  idx === activeIdx
                    ? 'border-ink-800 scale-105 shadow-md'
                    : 'border-ink-800/20'
                }`}
                onClick={() => selectFrame(idx)}
              >
                <img
                  src={frame.imageData}
                  alt={frame.name}
                  className="w-16 h-16 block bg-white"
                  style={{ imageRendering: 'pixelated' }}
                />
                {frames.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFrame(idx);
                    }}
                    className="absolute top-0.5 right-0.5 bg-paper-100/90 rounded-full p-0.5 active:scale-90"
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

        <div className="border-t-2 border-dashed border-ink-800/15 pt-4">
          <p className="text-xs font-hand text-ink-500 leading-relaxed">
            Dual-canvas ready. Next: skeleton guide layer + onion skin (prev/next).
          </p>
        </div>
      </div>

      <div className="flex-1" />
    </div>
  );
}
