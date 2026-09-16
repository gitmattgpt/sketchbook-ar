import type { CollisionGrid, ProcessedImageResult } from '@/types';

/** Letter paper 8.5×11 aspect — higher res for close-up detail */
export const GRID_WIDTH = 198;
export const GRID_HEIGHT = 256;
export const CAPTURE_WIDTH = 792;
export const CAPTURE_HEIGHT = 1024;

export function downsampleToLetter(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  outW = GRID_WIDTH,
  outH = GRID_HEIGHT
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  const sx = source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLCanvasElement).width;
  const sy = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height;
  if (!sx || !sy) return canvas;

  const targetAspect = outW / outH;
  const srcAspect = sx / sy;
  let cropW: number, cropH: number, offX: number, offY: number;

  if (srcAspect > targetAspect) {
    cropH = sy;
    cropW = sy * targetAspect;
    offX = (sx - cropW) / 2;
    offY = 0;
  } else {
    cropW = sx;
    cropH = sx / targetAspect;
    offX = 0;
    offY = (sy - cropH) / 2;
  }

  ctx.drawImage(source, offX, offY, cropW, cropH, 0, 0, outW, outH);
  return canvas;
}

/** @deprecated use downsampleToLetter */
export function downsampleToGrid(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  targetSize = GRID_HEIGHT
): HTMLCanvasElement {
  return downsampleToLetter(source, targetSize, targetSize);
}

/**
 * Expand every solid pixel into a disk of the given radius (grid cells).
 * Applied after threshold so only black ink is thickened / gaps filled.
 */
function expandSolidPixels(grid: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return grid;
  const r = Math.min(5, Math.max(0, Math.floor(radius)));
  const out = new Uint8Array(grid.length);
  const r2 = r * r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] !== 1) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

export function extractCollisionGrid(
  source: HTMLCanvasElement,
  threshold: number,
  targetW = GRID_WIDTH,
  targetH = GRID_HEIGHT,
  expandRadius = 0
): ProcessedImageResult {
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const data = imageData.data;

  let grid = new Uint8Array(targetW * targetH);

  const scaleX = source.width / targetW;
  const scaleY = source.height / targetH;

  for (let gy = 0; gy < targetH; gy++) {
    for (let gx = 0; gx < targetW; gx++) {
      let r = 0, g = 0, b = 0, count = 0;

      const sx0 = Math.floor(gx * scaleX);
      const sy0 = Math.floor(gy * scaleY);
      const sx1 = Math.max(sx0 + 1, Math.floor((gx + 1) * scaleX));
      const sy1 = Math.max(sy0 + 1, Math.floor((gy + 1) * scaleY));

      for (let py = sy0; py < sy1 && py < source.height; py++) {
        for (let px = sx0; px < sx1 && px < source.width; px++) {
          const i = (py * source.width + px) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }

      if (count > 0) {
        r /= count;
        g /= count;
        b /= count;
      }

      const brightness = (r + g + b) / 3;
      grid[gy * targetW + gx] = brightness < threshold ? 1 : 0;
    }
  }

  if (expandRadius > 0) {
    grid = expandSolidPixels(grid, targetW, targetH, expandRadius);
  }

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = targetW;
  previewCanvas.height = targetH;
  const pCtx = previewCanvas.getContext('2d')!;
  const previewImg = pCtx.createImageData(targetW, targetH);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] === 1 ? 20 : 247;
    previewImg.data[i * 4] = v;
    previewImg.data[i * 4 + 1] = v;
    previewImg.data[i * 4 + 2] = v;
    previewImg.data[i * 4 + 3] = 255;
  }
  pCtx.putImageData(previewImg, 0, 0);

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = targetW;
  gridCanvas.height = targetH;
  const gCtx = gridCanvas.getContext('2d')!;
  const gridImg = gCtx.createImageData(targetW, targetH);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1) {
      gridImg.data[i * 4] = 43;
      gridImg.data[i * 4 + 1] = 43;
      gridImg.data[i * 4 + 2] = 43;
      gridImg.data[i * 4 + 3] = 255;
    } else {
      gridImg.data[i * 4 + 3] = 0;
    }
  }
  gCtx.putImageData(gridImg, 0, 0);

  return {
    grid: {
      width: targetW,
      height: targetH,
      cellSize: 1,
      data: grid,
    },
    previewCanvas,
    gridCanvas,
  };
}

export function countSolidPixels(grid: CollisionGrid): number {
  let count = 0;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] === 1) count++;
  }
  return count;
}

export function isSolidAt(grid: CollisionGrid, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= grid.width || iy < 0 || iy >= grid.height) return false;
  return grid.data[iy * grid.width + ix] === 1;
}

export function findSpawnPoint(grid: CollisionGrid): { x: number; y: number } {
  const cx = Math.floor(grid.width / 2);

  for (let y = 0; y < grid.height; y++) {
    if (isSolidAt(grid, cx, y)) {
      return { x: cx, y: Math.max(0, y - 8) };
    }
  }

  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      if (isSolidAt(grid, x, y)) {
        return { x, y: Math.max(0, y - 8) };
      }
    }
  }

  return { x: cx, y: 16 };
}

export function generateStickmanSVG(frame: 'idle' | 'walk1' | 'walk2'): string {
  const armSwing = frame === 'idle' ? 0 : frame === 'walk1' ? 15 : -15;
  const legSwing = frame === 'idle' ? 0 : frame === 'walk1' ? 20 : -20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <g stroke="#2b2b2b" stroke-width="3" stroke-linecap="round" fill="none">
    <circle cx="32" cy="14" r="7" stroke-width="3" fill="#f7f3e8" />
    <line x1="32" y1="21" x2="32" y2="40" />
    <line x1="32" y1="26" x2="${32 - armSwing}" y2="36" />
    <line x1="32" y1="26" x2="${32 + armSwing}" y2="36" />
    <line x1="32" y1="40" x2="${32 - legSwing * 0.5}" y2="52" />
    <line x1="32" y1="40" x2="${32 + legSwing * 0.5}" y2="52" />
  </g>
</svg>`;
}
