import { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Eraser, Pencil, Layers } from 'lucide-react';
import type { SpriteFrame } from '@/types';

const SIZE_OPTIONS = [128, 192, 256] as const;
type CanvasSize = (typeof SIZE_OPTIONS)[number];

const DEFAULT_FRAME_NAMES = ['Contact L', 'Pass L', 'Contact R', 'Pass R'];

// ─── Simple stickman skeleton (normalized 0–1) ───
interface Joint { x: number; y: number }

const IDLE_POSE: Record<string, Joint> = {
  head:   { x: 0.50, y: 0.16 },
  neck:   { x: 0.50, y: 0.26 },
  torso:  { x: 0.50, y: 0.48 },
  lShoulder: { x: 0.40, y: 0.30 },
  rShoulder: { x: 0.60, y: 0.30 },
  lElbow: { x: 0.34, y: 0.42 },
  rElbow: { x: 0.66, y: 0.42 },
  lHand:  { x: 0.30, y: 0.54 },
  rHand:  { x: 0.70, y: 0.54 },
  lHip:   { x: 0.45, y: 0.55 },
  rHip:   { x: 0.55, y: 0.55 },
  lKnee:  { x: 0.43, y: 0.72 },
  rKnee:  { x: 0.57, y: 0.72 },
  lFoot:  { x: 0.40, y: 0.90 },
  rFoot:  { x: 0.60, y: 0.90 },
};

function drawStickman(
  ctx: CanvasRenderingContext2D,
  size: number,
  pose: Record<string, Joint>,
  color: string,
  lineWidth: number,
  alpha = 1
) {
  const p = (j: Joint) => ({ x: j.x * size, y: j.y * size });
  const head = p(pose.head);
  const neck = p(pose.neck);
  const torso = p(pose.torso);
  const ls = p(pose.lShoulder);
  const rs = p(pose.rShoulder);
  const le = p(pose.lElbow);
  const re = p(pose.rElbow);
  const lh = p(pose.lHand);
  const rh = p(pose.rHand);
  const lhip = p(pose.lHip);
  const rhip = p(pose.rHip);
  const lk = p(pose.lKnee);
  const rk = p(pose.rKnee);
  const lf = p(pose.lFoot);
  const rf = p(pose.rFoot);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Head
  const headR = size * 0.07;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.stroke();

  // Spine
  line(ctx, neck, torso);
  // Shoulders
  line(ctx, ls, rs);
  // Arms
  line(ctx, ls, le); line(ctx, le, lh);
  line(ctx, rs, re); line(ctx, re, rh);
  // Hips
  line(ctx, lhip, rhip);
  // Connect torso to hips
  line(ctx, torso, { x: (lhip.x + rhip.x) / 2, y: (lhip.y + rhip.y) / 2 });
  // Legs
  line(ctx, lhip, lk); line(ctx, lk, lf);
  line(ctx, rhip, rk); line(ctx, rk, rf);

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Tint an image data URL with a solid color while preserving alpha */
function tintImage(
  src: string,
  color: string,
  alpha: number,
  size: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);

      // Colorize non-transparent pixels
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // Apply overall opacity
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const octx = out.getContext('2d')!;
      octx.globalAlpha = alpha;
      octx.drawImage(c, 0, 0);
      resolve(out);
    };
    img.onerror = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      resolve(c);
    };
    img.src = src;
  });
}

function createBlankFrame(name: string, size: number): SpriteFrame {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
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

  // Onion skin settings
  const [onionEnabled, setOnionEnabled] = useState(true);
  const [onionBefore, setOnionBefore] = useState(1); // 0 = off
  const [onionAfter, setOnionAfter] = useState(1);   // 0 = off
  const [showSkeleton, setShowSkeleton] = useState(true);

  const guideRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // ─── Redraw guide layer (skeleton + onion) ───
  const redrawGuide = useCallback(async () => {
    const guide = guideRef.current;
    if (!guide) return;
    if (guide.width !== canvasSize) {
      guide.width = canvasSize;
      guide.height = canvasSize;
    }
    const ctx = guide.getContext('2d')!;
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Onion: previous frames (green)
    if (onionEnabled && onionBefore > 0) {
      for (let i = 1; i <= onionBefore; i++) {
        const idx = activeIdx - i;
        if (idx < 0) break;
        const tinted = await tintImage(frames[idx].imageData, '#22c55e', 0.35, canvasSize);
        ctx.drawImage(tinted, 0, 0);
      }
    }

    // Onion: next frames (blue)
    if (onionEnabled && onionAfter > 0) {
      for (let i = 1; i <= onionAfter; i++) {
        const idx = activeIdx + i;
        if (idx >= frames.length) break;
        const tinted = await tintImage(frames[idx].imageData, '#3b82f6', 0.35, canvasSize);
        ctx.drawImage(tinted, 0, 0);
      }
    }

    // Skeleton guide (light gray)
    if (showSkeleton) {
      drawStickman(ctx, canvasSize, IDLE_POSE, '#9ca3af', Math.max(1.5, canvasSize / 64), 0.55);
    }
  }, [activeIdx, frames, canvasSize, onionEnabled, onionBefore, onionAfter, showSkeleton]);

  // ─── Load active frame onto drawing canvas ───
  const loadFrame = useCallback(
    (idx: number) => {
      const draw = drawRef.current;
      if (!draw || !frames[idx]) return;

      if (draw.width !== canvasSize) {
        draw.width = canvasSize;
        draw.height = canvasSize;
      }

      const ctx = draw.getContext('2d')!;
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
      };
      img.src = frames[idx].imageData;
    },
    [frames, canvasSize]
  );

  useEffect(() => {
    loadFrame(activeIdx);
    redrawGuide();
  }, [activeIdx, canvasSize, loadFrame, redrawGuide]);

  // ─── Size change ───
  const handleSizeChange = (newSize: CanvasSize) => {
    if (newSize === canvasSize) return;
    setFrames((prev) =>
      prev.map((frame) => {
        const out = document.createElement('canvas');
        out.width = newSize;
        out.height = newSize;
        const octx = out.getContext('2d')!;
        octx.clearRect(0, 0, newSize, newSize);
        return { ...frame, imageData: out.toDataURL('image/png') };
      })
    );
    setCanvasSize(newSize);
  };

  // ─── Pointer ───
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
            Skeleton guide + onion skin. Draw over the template.
          </p>
        </header>

        {/* Dual Canvas */}
        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-3 shadow-inner">
          <div className="relative w-full" style={{ paddingBottom: '100%' }}>
            <div className="absolute inset-0 rounded bg-white" />
            <canvas
              ref={guideRef}
              width={canvasSize}
              height={canvasSize}
              className="absolute inset-0 w-full h-full rounded pointer-events-none"
              style={{ imageRendering: 'pixelated' }}
            />
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
          <div className="absolute top-2 right-2 text-[10px] font-hand bg-paper-100/90 px-1.5 py-0.5 rounded border border-ink-800/20">
            {canvasSize}×{canvasSize}
          </div>
        </div>

        {/* Size */}
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

        {/* Brush / Eraser */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => setTool('brush')}
              className={`p-2 rounded-lg border-2 transition-colors ${
                tool === 'brush' ? 'border-ink-800 bg-ink-800/10 text-ink-800' : 'border-ink-800/20 text-ink-500'
              }`}
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-lg border-2 transition-colors ${
                tool === 'eraser' ? 'border-ink-800 bg-ink-800/10 text-ink-800' : 'border-ink-800/20 text-ink-500'
              }`}
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

        {/* Onion + Skeleton toggles */}
        <div className="space-y-2">
          <button
            onClick={() => setOnionEnabled(!onionEnabled)}
            className={`w-full flex items-center justify-center gap-2 p-2.5 border-2 rounded-lg transition-colors ${
              onionEnabled
                ? 'border-green-600 bg-green-50 text-green-800'
                : 'border-ink-800/20 text-ink-500'
            }`}
          >
            <Layers size={16} />
            <span className="text-sm font-hand font-bold">
              Onion Skin {onionEnabled ? 'On' : 'Off'}
            </span>
          </button>

          {onionEnabled && (
            <div className="flex gap-3 text-xs font-hand">
              <label className="flex items-center gap-1.5 flex-1">
                <span className="text-green-700 font-bold">Before</span>
                <select
                  value={onionBefore}
                  onChange={(e) => setOnionBefore(Number(e.target.value))}
                  className="flex-1 border border-ink-800/20 rounded px-1 py-0.5 bg-white"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 flex-1">
                <span className="text-blue-600 font-bold">After</span>
                <select
                  value={onionAfter}
                  onChange={(e) => setOnionAfter(Number(e.target.value))}
                  className="flex-1 border border-ink-800/20 rounded px-1 py-0.5 bg-white"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <button
            onClick={() => setShowSkeleton(!showSkeleton)}
            className={`w-full flex items-center justify-center gap-2 p-2 border-2 rounded-lg transition-colors text-sm font-hand font-bold ${
              showSkeleton
                ? 'border-ink-800/40 bg-ink-800/5 text-ink-700'
                : 'border-ink-800/20 text-ink-500'
            }`}
          >
            Skeleton Guide {showSkeleton ? 'On' : 'Off'}
          </button>
        </div>

        {/* Frames */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-hand font-bold text-ink-700 text-sm">Frames ({frames.length})</h3>
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
                  idx === activeIdx ? 'border-ink-800 scale-105 shadow-md' : 'border-ink-800/20'
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
            Piece 2 done. Green = previous frames, Blue = next frames. Skeleton guide is light gray.
            Next: procedural walk poses + timeline playback.
          </p>
        </div>
      </div>
      <div className="flex-1" />
    </div>
  );
}
