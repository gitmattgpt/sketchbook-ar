import { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Flag, MapPin, Shield, Skull, Trash2 } from 'lucide-react';
import type { LevelConfig, PaintTool } from '@/types';
import { GRID_WIDTH, GRID_HEIGHT } from '@/utils/imageProcessor';

interface LevelEditorProps {
  config: LevelConfig;
  onConfigChange: (config: LevelConfig) => void;
  gridPreview: string | null;
}

const TOOLS: {
  id: PaintTool;
  label: string;
  color: string;
  swatch: string;
  hint: string;
  icon: typeof Shield;
}[] = [
  {
    id: 'safe',
    label: 'Safe',
    color: 'rgba(46, 204, 113, 0.55)',
    swatch: '#2ecc71',
    hint: 'Paint walk-safe areas',
    icon: Shield,
  },
  {
    id: 'damage',
    label: 'Damage',
    color: 'rgba(231, 76, 60, 0.55)',
    swatch: '#e74c3c',
    hint: 'Paint hurt zones',
    icon: Skull,
  },
  {
    id: 'spawn',
    label: 'Start',
    color: '#3498db',
    swatch: '#3498db',
    hint: 'Tap to set spawn',
    icon: MapPin,
  },
  {
    id: 'goal',
    label: 'Goal',
    color: '#f1c40f',
    swatch: '#f1c40f',
    hint: 'Tap to set goal',
    icon: Flag,
  },
  {
    id: 'erase',
    label: 'Erase',
    color: 'rgba(0,0,0,0.15)',
    swatch: '#bdc3c7',
    hint: 'Erase paint',
    icon: Eraser,
  },
];

const BRUSH_RADIUS = 10;

export function LevelEditor({ config, onConfigChange, gridPreview }: LevelEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const safeRef = useRef<HTMLCanvasElement>(null);
  const damageRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [tool, setTool] = useState<PaintTool>('safe');
  const [brushSize, setBrushSize] = useState(BRUSH_RADIUS);

  // Draw map preview onto base canvas
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !gridPreview) return;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f7f3e8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = gridPreview;
  }, [gridPreview]);

  // Restore saved paint layers
  useEffect(() => {
    const loadLayer = (canvas: HTMLCanvasElement | null, url?: string | null) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!url) return;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = url;
    };
    loadLayer(safeRef.current, config.safePaintDataUrl);
    loadLayer(damageRef.current, config.damagePaintDataUrl);
    // only on mount / when urls change from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.safePaintDataUrl, config.damagePaintDataUrl]);

  const persistPaint = useCallback(() => {
    onConfigChange({
      ...config,
      safePaintDataUrl: safeRef.current?.toDataURL('image/png') ?? null,
      damagePaintDataUrl: damageRef.current?.toDataURL('image/png') ?? null,
    });
  }, [config, onConfigChange]);

  const canvasPoint = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const paintAt = (x: number, y: number, from: { x: number; y: number } | null) => {
    const target =
      tool === 'safe' || (tool === 'erase' && true)
        ? tool === 'damage'
          ? damageRef.current
          : safeRef.current
        : tool === 'damage'
          ? damageRef.current
          : null;

    // For erase, clear on both layers
    if (tool === 'erase') {
      [safeRef.current, damageRef.current].forEach((c) => {
        if (!c) return;
        const ctx = c.getContext('2d')!;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize * 2;
        ctx.beginPath();
        if (from) {
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      });
      return;
    }

    if (tool === 'safe' || tool === 'damage') {
      const canvas = tool === 'safe' ? safeRef.current : damageRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const color = TOOLS.find((t) => t.id === tool)!.color;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize * 2;
      ctx.beginPath();
      if (from) {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const canvas = safeRef.current;
    if (!canvas) return;

    const pt = canvasPoint(e, canvas);

    if (tool === 'spawn') {
      onConfigChange({ ...config, spawn: { x: pt.x, y: pt.y } });
      return;
    }
    if (tool === 'goal') {
      onConfigChange({ ...config, goal: { x: pt.x, y: pt.y } });
      return;
    }

    drawing.current = true;
    lastPt.current = pt;
    paintAt(pt.x, pt.y, null);
  };

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = safeRef.current;
    if (!canvas) return;
    const pt = canvasPoint(e, canvas);
    paintAt(pt.x, pt.y, lastPt.current);
    lastPt.current = pt;
  };

  const handleEnd = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPt.current = null;
    if (tool === 'safe' || tool === 'damage' || tool === 'erase') {
      persistPaint();
    }
  };

  const clearAllPaint = () => {
    [safeRef.current, damageRef.current].forEach((c) => {
      if (!c) return;
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    });
    onConfigChange({
      ...config,
      safePaintDataUrl: null,
      damagePaintDataUrl: null,
      spawn: null,
      goal: null,
    });
  };

  if (!gridPreview) {
    return (
      <div className="flex flex-col h-full paper-bg items-center justify-center px-6 text-center">
        <p className="font-hand text-ink-600 text-sm leading-relaxed">
          Capture a paper map in <strong>AR Play</strong> first, then come back here to paint safe zones, damage, start, and goal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full paper-bg overflow-hidden">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h2 className="text-xl font-script font-bold text-ink-800">Level Paint</h2>
        <p className="text-xs font-hand text-ink-500">
          {TOOLS.find((t) => t.id === tool)?.hint ?? 'Paint on the map'}
        </p>
      </div>

      {/* Canvas stack */}
      <div className="flex-1 min-h-0 px-3 flex items-center justify-center">
        <div
          ref={containerRef}
          className="relative w-full max-w-md border-2 border-ink-800/25 rounded-lg overflow-hidden bg-paper-100 touch-none shadow-sm"
          style={{ aspectRatio: `${GRID_WIDTH} / ${GRID_HEIGHT}` }}
        >
          <canvas
            ref={baseRef}
            width={GRID_WIDTH}
            height={GRID_HEIGHT}
            className="absolute inset-0 w-full h-full"
          />
          <canvas
            ref={safeRef}
            width={GRID_WIDTH}
            height={GRID_HEIGHT}
            className="absolute inset-0 w-full h-full"
          />
          <canvas
            ref={damageRef}
            width={GRID_WIDTH}
            height={GRID_HEIGHT}
            className="absolute inset-0 w-full h-full"
          />
          {/* Interaction layer */}
          <canvas
            width={GRID_WIDTH}
            height={GRID_HEIGHT}
            className="absolute inset-0 w-full h-full z-10"
            style={{ touchAction: 'none' }}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
          />

          {/* Spawn marker */}
          {config.spawn && (
            <div
              className="absolute z-20 pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(config.spawn.x / GRID_WIDTH) * 100}%`,
                top: `${(config.spawn.y / GRID_HEIGHT) * 100}%`,
              }}
            >
              <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white shadow flex items-center justify-center">
                <MapPin size={14} className="text-white" />
              </div>
            </div>
          )}

          {/* Goal marker */}
          {config.goal && (
            <div
              className="absolute z-20 pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(config.goal.x / GRID_WIDTH) * 100}%`,
                top: `${(config.goal.y / GRID_HEIGHT) * 100}%`,
              }}
            >
              <div className="w-6 h-6 rounded-full bg-yellow-400 border-2 border-white shadow flex items-center justify-center">
                <Flag size={14} className="text-ink-800" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Brush size */}
      {(tool === 'safe' || tool === 'damage' || tool === 'erase') && (
        <div className="px-4 py-1.5 flex items-center gap-3 shrink-0">
          <span className="text-[10px] font-hand text-ink-500 w-10">Size</span>
          <input
            type="range"
            min={4}
            max={28}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-[10px] font-hand text-ink-600 tabular-nums w-6">{brushSize}</span>
        </div>
      )}

      {/* Palette */}
      <div className="px-3 py-2 shrink-0 border-t border-ink-800/10 bg-paper-200/80">
        <div className="flex items-stretch justify-between gap-1.5">
          {TOOLS.map(({ id, label, swatch, icon: Icon }) => {
            const active = tool === id;
            return (
              <button
                key={id}
                onClick={() => setTool(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border-2 transition-all ${
                  active
                    ? 'border-ink-800 bg-paper-100 scale-105 shadow-sm'
                    : 'border-transparent bg-paper-100/50'
                }`}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center border border-black/10"
                  style={{ backgroundColor: swatch }}
                >
                  <Icon size={14} className={id === 'goal' ? 'text-ink-800' : 'text-white'} />
                </span>
                <span className="text-[10px] font-hand font-bold text-ink-700">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] font-hand text-ink-500">
            {config.spawn ? 'Start set' : 'No start'} · {config.goal ? 'Goal set' : 'No goal'}
          </p>
          <button
            onClick={clearAllPaint}
            className="flex items-center gap-1 text-[11px] font-hand font-bold text-red-600 px-2 py-1 rounded active:bg-red-50"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}
