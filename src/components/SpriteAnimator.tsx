import { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Eraser, Pencil, Layers, Play, Square, Download, Check } from 'lucide-react';
import type { SpriteFrame } from '@/types';

const SIZE_OPTIONS = [128, 192, 256] as const;
type CanvasSize = (typeof SIZE_OPTIONS)[number];
const FPS_OPTIONS = [4, 6, 8, 12, 24] as const;
const DEFAULT_FRAME_NAMES = ['Contact L', 'Pass L', 'Contact R', 'Pass R'];
const WALK_STORAGE_KEY = 'sketchbook-ar-active-walk';

interface Joint { x: number; y: number }
type Pose = Record<string, Joint>;

const WALK_POSES: Pose[] = [
  { head:{x:0.50,y:0.15},neck:{x:0.50,y:0.25},torso:{x:0.50,y:0.46},lShoulder:{x:0.40,y:0.29},rShoulder:{x:0.60,y:0.29},lElbow:{x:0.32,y:0.40},rElbow:{x:0.70,y:0.40},lHand:{x:0.28,y:0.52},rHand:{x:0.76,y:0.50},lHip:{x:0.44,y:0.54},rHip:{x:0.56,y:0.54},lKnee:{x:0.36,y:0.70},rKnee:{x:0.64,y:0.70},lFoot:{x:0.28,y:0.90},rFoot:{x:0.72,y:0.88} },
  { head:{x:0.50,y:0.14},neck:{x:0.50,y:0.24},torso:{x:0.50,y:0.45},lShoulder:{x:0.41,y:0.28},rShoulder:{x:0.59,y:0.28},lElbow:{x:0.36,y:0.40},rElbow:{x:0.66,y:0.38},lHand:{x:0.34,y:0.52},rHand:{x:0.72,y:0.48},lHip:{x:0.46,y:0.53},rHip:{x:0.54,y:0.53},lKnee:{x:0.48,y:0.68},rKnee:{x:0.58,y:0.72},lFoot:{x:0.48,y:0.86},rFoot:{x:0.62,y:0.90} },
  { head:{x:0.50,y:0.15},neck:{x:0.50,y:0.25},torso:{x:0.50,y:0.46},lShoulder:{x:0.40,y:0.29},rShoulder:{x:0.60,y:0.29},lElbow:{x:0.30,y:0.40},rElbow:{x:0.68,y:0.40},lHand:{x:0.24,y:0.50},rHand:{x:0.72,y:0.52},lHip:{x:0.44,y:0.54},rHip:{x:0.56,y:0.54},lKnee:{x:0.36,y:0.70},rKnee:{x:0.64,y:0.70},lFoot:{x:0.28,y:0.88},rFoot:{x:0.72,y:0.90} },
  { head:{x:0.50,y:0.14},neck:{x:0.50,y:0.24},torso:{x:0.50,y:0.45},lShoulder:{x:0.41,y:0.28},rShoulder:{x:0.59,y:0.28},lElbow:{x:0.34,y:0.38},rElbow:{x:0.64,y:0.40},lHand:{x:0.28,y:0.48},rHand:{x:0.66,y:0.52},lHip:{x:0.46,y:0.53},rHip:{x:0.54,y:0.53},lKnee:{x:0.42,y:0.72},rKnee:{x:0.52,y:0.68},lFoot:{x:0.38,y:0.90},rFoot:{x:0.52,y:0.86} },
];

function getPoseForFrame(idx: number): Pose {
  return WALK_POSES[idx % WALK_POSES.length];
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function drawStickman(ctx: CanvasRenderingContext2D, size: number, pose: Pose, color: string, lineWidth: number, alpha = 1) {
  const p = (j: Joint) => ({ x: j.x * size, y: j.y * size });
  const head = p(pose.head), neck = p(pose.neck), torso = p(pose.torso);
  const ls = p(pose.lShoulder), rs = p(pose.rShoulder), le = p(pose.lElbow), re = p(pose.rElbow);
  const lh = p(pose.lHand), rh = p(pose.rHand), lhip = p(pose.lHip), rhip = p(pose.rHip);
  const lk = p(pose.lKnee), rk = p(pose.rKnee), lf = p(pose.lFoot), rf = p(pose.rFoot);
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(head.x, head.y, size * 0.07, 0, Math.PI * 2); ctx.stroke();
  line(ctx, neck, torso); line(ctx, ls, rs); line(ctx, ls, le); line(ctx, le, lh); line(ctx, rs, re); line(ctx, re, rh);
  line(ctx, lhip, rhip); line(ctx, torso, { x: (lhip.x + rhip.x) / 2, y: (lhip.y + rhip.y) / 2 });
  line(ctx, lhip, lk); line(ctx, lk, lf); line(ctx, rhip, rk); line(ctx, rk, rf);
  ctx.restore();
}

function tintImage(src: string, color: string, alpha: number, size: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, size, size);
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = color; ctx.fillRect(0, 0, size, size);
      const out = document.createElement('canvas'); out.width = size; out.height = size;
      const octx = out.getContext('2d')!; octx.globalAlpha = alpha; octx.drawImage(c, 0, 0); resolve(out);
    };
    img.onerror = () => { const c = document.createElement('canvas'); c.width = size; c.height = size; resolve(c); };
    img.src = src;
  });
}

function createBlankFrame(name: string, size: number): SpriteFrame {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  canvas.getContext('2d')!.clearRect(0, 0, size, size);
  return { id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, imageData: canvas.toDataURL('image/png'), name };
}

function createInitialFrames(size: number): SpriteFrame[] {
  return DEFAULT_FRAME_NAMES.map((name) => createBlankFrame(name, size));
}

function wrapIndex(idx: number, len: number): number {
  return ((idx % len) + len) % len;
}

export function SpriteAnimator() {
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(128);
  const [frames, setFrames] = useState<SpriteFrame[]>(() => createInitialFrames(128));
  const [activeIdx, setActiveIdx] = useState(0);
  const [brushSize, setBrushSize] = useState(3);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [isDrawing, setIsDrawing] = useState(false);
  const [onionEnabled, setOnionEnabled] = useState(true);
  const [onionBefore, setOnionBefore] = useState(1);
  const [onionAfter, setOnionAfter] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [statusMsg, setStatusMsg] = useState('');
  const playRef = useRef<number | null>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const getCurrentImageData = useCallback(() => {
    const canvas = drawRef.current;
    return canvas ? canvas.toDataURL('image/png') : framesRef.current[activeIdx]?.imageData ?? '';
  }, [activeIdx]);

  const persistCurrent = useCallback(() => {
    const data = getCurrentImageData();
    setFrames((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], imageData: data };
      return next;
    });
    return data;
  }, [activeIdx, getCurrentImageData]);

  const redrawGuide = useCallback(async () => {
    const guide = guideRef.current;
    if (!guide || frames.length === 0) return;
    if (guide.width !== canvasSize) { guide.width = canvasSize; guide.height = canvasSize; }
    const ctx = guide.getContext('2d')!; ctx.clearRect(0, 0, canvasSize, canvasSize);
    const n = frames.length;
    if (onionEnabled && onionBefore > 0 && n > 1) {
      for (let i = 1; i <= onionBefore; i++) {
        const idx = wrapIndex(activeIdx - i, n);
        if (idx === activeIdx) continue;
        ctx.drawImage(await tintImage(frames[idx].imageData, '#22c55e', 0.35, canvasSize), 0, 0);
      }
    }
    if (onionEnabled && onionAfter > 0 && n > 1) {
      for (let i = 1; i <= onionAfter; i++) {
        const idx = wrapIndex(activeIdx + i, n);
        if (idx === activeIdx) continue;
        ctx.drawImage(await tintImage(frames[idx].imageData, '#3b82f6', 0.35, canvasSize), 0, 0);
      }
    }
    if (showSkeleton) drawStickman(ctx, canvasSize, getPoseForFrame(activeIdx), '#9ca3af', Math.max(1.5, canvasSize / 64), 0.55);
  }, [activeIdx, frames, canvasSize, onionEnabled, onionBefore, onionAfter, showSkeleton]);

  const loadFrame = useCallback((idx: number) => {
    const draw = drawRef.current;
    if (!draw || !frames[idx]) return;
    if (draw.width !== canvasSize) { draw.width = canvasSize; draw.height = canvasSize; }
    const ctx = draw.getContext('2d')!; ctx.clearRect(0, 0, canvasSize, canvasSize);
    const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, canvasSize, canvasSize); img.src = frames[idx].imageData;
  }, [frames, canvasSize]);

  useEffect(() => { loadFrame(activeIdx); redrawGuide(); }, [activeIdx, canvasSize, loadFrame, redrawGuide]);

  useEffect(() => {
    if (!isPlaying) { if (playRef.current) { clearInterval(playRef.current); playRef.current = null; } return; }
    playRef.current = window.setInterval(() => setActiveIdx((p) => (p + 1) % frames.length), 1000 / fps);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, fps, frames.length]);

  const togglePlay = () => { if (!isPlaying) persistCurrent(); setIsPlaying((p) => !p); };

  const handleSizeChange = (newSize: CanvasSize) => {
    if (newSize === canvasSize) return;
    setIsPlaying(false);
    setFrames((prev) => prev.map((f) => {
      const out = document.createElement('canvas'); out.width = newSize; out.height = newSize;
      out.getContext('2d')!.clearRect(0, 0, newSize, newSize);
      return { ...f, imageData: out.toDataURL('image/png') };
    }));
    setCanvasSize(newSize);
  };

  const getPos = (e: React.PointerEvent) => {
    const canvas = drawRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvasSize / rect.width), y: (e.clientY - rect.top) * (canvasSize / rect.height) };
  };

  const startDraw = (e: React.PointerEvent) => {
    if (isPlaying) return; e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDrawing(true); lastPos.current = getPos(e); paint(e);
  };

  const paint = (e: React.PointerEvent) => {
    if (!isDrawing && e.type !== 'pointerdown') return;
    const canvas = drawRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!; const pos = getPos(e);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize;
    if (tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#2b2b2b'; }
    if (lastPos.current) { ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke(); }
    lastPos.current = pos;
  };

  const endDraw = () => {
    if (!isDrawing) return; setIsDrawing(false); lastPos.current = null;
    const canvas = drawRef.current; if (!canvas) return;
    canvas.getContext('2d')!.globalCompositeOperation = 'source-over';
    const data = canvas.toDataURL('image/png');
    setFrames((prev) => { const next = [...prev]; next[activeIdx] = { ...next[activeIdx], imageData: data }; return next; });
  };

  const selectFrame = (idx: number) => { if (isPlaying) setIsPlaying(false); persistCurrent(); setActiveIdx(idx); };
  const addFrame = () => { if (isPlaying) setIsPlaying(false); setFrames((prev) => [...prev, createBlankFrame(`Frame ${prev.length + 1}`, canvasSize)]); setActiveIdx(frames.length); };
  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return; if (isPlaying) setIsPlaying(false);
    setFrames((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => (idx < prev ? prev - 1 : idx === prev ? Math.max(0, prev - 1) : prev));
  };

  const exportSpriteSheet = async () => {
    const currentData = persistCurrent();
    const list = frames.map((f, i) => (i === activeIdx ? { ...f, imageData: currentData } : f));
    const sheet = document.createElement('canvas');
    sheet.width = canvasSize * list.length; sheet.height = canvasSize;
    const ctx = sheet.getContext('2d')!; ctx.clearRect(0, 0, sheet.width, sheet.height);
    await Promise.all(list.map((frame, i) => new Promise<void>((resolve) => {
      const img = new Image(); img.onload = () => { ctx.drawImage(img, i * canvasSize, 0, canvasSize, canvasSize); resolve(); };
      img.onerror = () => resolve(); img.src = frame.imageData;
    })));
    const a = document.createElement('a'); a.href = sheet.toDataURL('image/png');
    a.download = `walk-sheet-${canvasSize}x${list.length}.png`; a.click();
    setStatusMsg('Sprite sheet downloaded');
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const applyWalkToCharacter = () => {
    const currentData = persistCurrent();
    const urls = frames.map((f, i) => (i === activeIdx ? currentData : f.imageData));
    try {
      localStorage.setItem(WALK_STORAGE_KEY, JSON.stringify(urls));
      setStatusMsg('Applied! Open AR Play to see the walk on the stickman.');
      setTimeout(() => setStatusMsg(''), 4000);
    } catch {
      setStatusMsg('Could not save (storage full?)');
    }
  };

  return (
    <div className="flex flex-col h-full paper-bg overflow-y-auto no-scrollbar">
      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-script font-bold text-ink-800">Sprite Animator</h2>
          <p className="text-sm font-hand text-ink-500">Draw, play, export sheet, or apply walk to the character.</p>
        </header>

        <div className="relative bg-paper-100 border-2 border-ink-800/30 rounded-lg p-3 shadow-inner">
          <div className="relative w-full" style={{ paddingBottom: '100%' }}>
            <div className="absolute inset-0 rounded bg-white" />
            <canvas ref={guideRef} width={canvasSize} height={canvasSize} className="absolute inset-0 w-full h-full rounded pointer-events-none" style={{ imageRendering: 'pixelated' }} />
            <canvas ref={drawRef} width={canvasSize} height={canvasSize} className="absolute inset-0 w-full h-full rounded touch-none cursor-crosshair" style={{ imageRendering: 'pixelated' }} onPointerDown={startDraw} onPointerMove={paint} onPointerUp={endDraw} onPointerLeave={endDraw} />
          </div>
          <div className="absolute top-2 right-2 text-[10px] font-hand bg-paper-100/90 px-1.5 py-0.5 rounded border border-ink-800/20">{canvasSize}×{canvasSize}</div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={togglePlay} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 font-hand font-bold text-sm transition-colors ${
            isPlaying ? 'border-red-500 bg-red-50 text-red-700' : 'border-ink-800 bg-ink-800 text-white'
          }`}>{isPlaying ? <Square size={14} /> : <Play size={14} />}{isPlaying ? 'Stop' : 'Play'}</button>
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-xs font-hand font-bold text-ink-600">FPS</span>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="flex-1 border-2 border-ink-800/20 rounded-lg px-2 py-1.5 text-xs font-hand bg-white">
              {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <span className="text-xs font-hand text-ink-500 tabular-nums">{activeIdx + 1}/{frames.length}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={exportSpriteSheet} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-2 border-ink-800/30 rounded-lg text-sm font-hand font-bold text-ink-700 active:scale-95">
            <Download size={16} /> Export Sheet
          </button>
          <button onClick={applyWalkToCharacter} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-2 border-ink-800 bg-ink-800 text-white rounded-lg text-sm font-hand font-bold active:scale-95">
            <Check size={16} /> Apply Walk
          </button>
        </div>
        {statusMsg && <p className="text-xs font-hand text-green-700 text-center">{statusMsg}</p>}

        <div className="space-y-1">
          <div className="flex items-center justify-between"><span className="text-xs font-hand font-bold text-ink-700">Character Size</span><span className="text-xs font-hand text-ink-500">{canvasSize}px</span></div>
          <div className="flex gap-2">{SIZE_OPTIONS.map((s) => (
            <button key={s} onClick={() => handleSizeChange(s)} className={`flex-1 py-1.5 text-xs font-hand font-bold rounded-lg border-2 transition-colors ${
              canvasSize === s ? 'border-ink-800 bg-ink-800/10 text-ink-800' : 'border-ink-800/20 text-ink-500'
            }`}>{s}</button>
          ))}</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <button onClick={() => setTool('brush')} className={`p-2 rounded-lg border-2 ${tool === 'brush' ? 'border-ink-800 bg-ink-800/10 text-ink-800' : 'border-ink-800/20 text-ink-500'}`}><Pencil size={16} /></button>
            <button onClick={() => setTool('eraser')} className={`p-2 rounded-lg border-2 ${tool === 'eraser' ? 'border-ink-800 bg-ink-800/10 text-ink-800' : 'border-ink-800/20 text-ink-500'}`}><Eraser size={16} /></button>
          </div>
          <input type="range" min={1} max={12} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="flex-1" />
          <span className="text-xs font-hand text-ink-600 tabular-nums w-6 text-right">{brushSize}</span>
        </div>

        <div className="space-y-2">
          <button onClick={() => setOnionEnabled(!onionEnabled)} className={`w-full flex items-center justify-center gap-2 p-2.5 border-2 rounded-lg ${
            onionEnabled ? 'border-green-600 bg-green-50 text-green-800' : 'border-ink-800/20 text-ink-500'
          }`}><Layers size={16} /><span className="text-sm font-hand font-bold">Onion Skin {onionEnabled ? 'On (loops)' : 'Off'}</span></button>
          {onionEnabled && (
            <div className="flex gap-3 text-xs font-hand">
              <label className="flex items-center gap-1.5 flex-1"><span className="text-green-700 font-bold">Before</span>
                <select value={onionBefore} onChange={(e) => setOnionBefore(Number(e.target.value))} className="flex-1 border border-ink-800/20 rounded px-1 py-0.5 bg-white">{[0,1,2,3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              <label className="flex items-center gap-1.5 flex-1"><span className="text-blue-600 font-bold">After</span>
                <select value={onionAfter} onChange={(e) => setOnionAfter(Number(e.target.value))} className="flex-1 border border-ink-800/20 rounded px-1 py-0.5 bg-white">{[0,1,2,3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
          )}
          <button onClick={() => setShowSkeleton(!showSkeleton)} className={`w-full flex items-center justify-center gap-2 p-2 border-2 rounded-lg text-sm font-hand font-bold ${
            showSkeleton ? 'border-ink-800/40 bg-ink-800/5 text-ink-700' : 'border-ink-800/20 text-ink-500'
          }`}>Skeleton Guide {showSkeleton ? 'On' : 'Off'}</button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-hand font-bold text-ink-700 text-sm">Frames ({frames.length})</h3>
            <button onClick={addFrame} className="flex items-center gap-1 text-sm font-hand font-bold text-ink-700"><Plus size={16} /> Add</button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
            {frames.map((frame, idx) => (
              <div key={frame.id} className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                idx === activeIdx ? 'border-ink-800 scale-105 shadow-md' : 'border-ink-800/20'
              }`} onClick={() => selectFrame(idx)}>
                <img src={frame.imageData} alt={frame.name} className="w-16 h-16 block bg-white" style={{ imageRendering: 'pixelated' }} />
                {frames.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); deleteFrame(idx); }} className="absolute top-0.5 right-0.5 bg-paper-100/90 rounded-full p-0.5">
                    <Trash2 size={10} className="text-red-500" />
                  </button>
                )}
                <span className="absolute bottom-0 left-0 right-0 text-[8px] font-hand text-center bg-paper-100/80 py-0.5 truncate px-0.5">{frame.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t-2 border-dashed border-ink-800/15 pt-4">
          <p className="text-xs font-hand text-ink-500 leading-relaxed">
            Export Sheet = horizontal PNG atlas. Apply Walk = load frames onto the AR stickman via localStorage.
          </p>
        </div>
      </div>
      <div className="flex-1" />
    </div>
  );
}
