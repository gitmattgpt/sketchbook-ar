import { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SpriteFrame } from '@/types';

const CANVAS_SIZE = 128;

const DEFAULT_FRAME_NAMES = ['Contact L', 'Pass L', 'Contact R', 'Pass R'];

function createBlankFrame(name: string): SpriteFrame {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  // Transparent background – white base layer will sit underneath later
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  return {
    id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    imageData: canvas.toDataURL('image/png'),
    name,
  };
}

function createInitialFrames(): SpriteFrame[] {
  return DEFAULT_FRAME_NAMES.map((name) => createBlankFrame(name));
}

export function SpriteAnimator() {
  const [frames, setFrames] = useState<SpriteFrame[]>(createInitialFrames);
  const [activeIdx, setActiveIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Load the active frame onto the canvas whenever selection changes
  const loadFrame = useCallback(
    (idx: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !frames[idx]) return;
      const ctx = canvas.getContext('2d')!;

      // Clear to transparent
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = frames[idx].imageData;
    },
    [frames]
  );

  // Initial load + when active frame changes
  useEffect(() => {
    loadFrame(activeIdx);
  }, [activeIdx, loadFrame]);

  const getCanvasPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getCanvasPos(e);
    draw(e);
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing && e.type !== 'pointerdown') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);

    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

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

    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    setFrames((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], imageData: data };
      return next;
    });
  };

  const selectFrame = (idx: number) => {
    // Save current canvas before switching
    const canvas = canvasRef.current;
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
    setFrames((prev) => [...prev, createBlankFrame(name)]);
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
            Draw frames for your character walk cycle. Select a frame, then draw.
          </p>
        </header>

        {/* Drawing canvas */}
        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-3 shadow-inner">
          <div className="relative" style={{ paddingBottom: '100%' }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="absolute inset-0 w-full h-full rounded touch-none cursor-crosshair bg-white"
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
            />
          </div>
        </div>

        {/* Brush size */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-hand font-bold text-ink-700 shrink-0">Brush</span>
          <input
            type="range"
            min={1}
            max={8}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs font-hand text-ink-600 tabular-nums w-6 text-right">{brushSize}</span>
        </div>

        {/* Frame list */}
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
            Piece 1 – Foundation. Next: onion skin, trace, guides, play controls, and walk templates.
          </p>
        </div>
      </div>

      <div className="flex-1" />
    </div>
  );
}
