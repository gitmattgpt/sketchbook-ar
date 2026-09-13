export type TabId = 'play' | 'setup' | 'animator';

export type TrackingState = 'idle' | 'searching' | 'tracking' | 'lost';

export interface TrackingData {
  visible: boolean;
  corners: { x: number; y: number }[];
  origin: { x: number; y: number };
  scale: number;
  rotation: number;
}

export interface CollisionGrid {
  width: number;
  height: number;
  cellSize: number;
  data: Uint8Array;
}

export interface SpriteFrame {
  id: string;
  imageData: string;
  name: string;
}

/** Paint brush modes for the finger-paint level editor */
export type PaintTool = 'safe' | 'damage' | 'spawn' | 'goal' | 'erase';

export interface LevelConfig {
  threshold: number;
  hazards: Hazard[];
  goal: { x: number; y: number } | null;
  spawn: { x: number; y: number } | null;
  /** Optional paint overlay data URLs (safe / damage highlighter layers) */
  safePaintDataUrl?: string | null;
  damagePaintDataUrl?: string | null;
}

export interface Hazard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'spike' | 'pit' | 'lava';
}

export interface ProcessedImageResult {
  grid: CollisionGrid;
  previewCanvas: HTMLCanvasElement;
  gridCanvas: HTMLCanvasElement;
}

export interface DebugInfo {
  fps: number;
  trackingState: TrackingState;
  gridResolution: string;
  solidPixels: number;
  characterPos: { x: number; y: number } | null;
  threshold: number;
}
