import type { CollisionGrid, ProcessedImageResult } from '@/types';

const GRID_SIZE = 128;

export function downsampleToGrid(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  targetSize = GRID_SIZE
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  const sx = source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLCanvasElement).width;
  const sy = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height;
  if (!sx || !sy) return canvas;

  const minDim = Math.min(sx, sy);
  const offX = (sx - minDim) / 2;
  const offY = (sy - minDim) / 2;

  ctx.drawImage(source, offX, offY, minDim, minDim, 0, 0, targetSize, targetSize);
  return canvas;
}

export function extractCollisionGrid(
  source: HTMLCanvasElement,
  threshold: number,
  targetSize = GRID_SIZE
): ProcessedImageResult {
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const data = imageData.data;

  const grid = new Uint8Array(targetSize * targetSize);

  const scaleX = source.width / targetSize;
  const scaleY = source.height / targetSize;

  for (let gy = 0; gy < targetSize; gy++) {
    for (let gx = 0; gx < targetSize; gx++) {
      let r = 0, g = 0, b = 0, count = 0;

      const sx0 = Math.floor(gx * scaleX);
      const sy0 = Math.floor(gy * scaleY);
      const sx1 = Math.floor((gx + 1) * scaleX);
      const sy1 = Math.floor((gy + 1) * scaleY);

      for (let py = sy0; py < sy1; py++) {
        for (let px = sx0; px < sx1; px++) {
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
      grid[gy * targetSize + gx] = brightness < threshold ? 1 : 0;
    }
  }

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = targetSize;
  previewCanvas.height = targetSize;
  const pCtx = previewCanvas.getContext('2d')!;
  const previewImg = pCtx.createImageData(targetSize, targetSize);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] === 1 ? 20 : 247;
    previewImg.data[i * 4] = v;
    previewImg.data[i * 4 + 1] = v;
    previewImg.data[i * 4 + 2] = v;
    previewImg.data[i * 4 + 3] = 255;
  }
  pCtx.putImageData(previewImg, 0, 0);

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = targetSize;
  gridCanvas.height = targetSize;
  const gCtx = gridCanvas.getContext('2d')!;
  const gridImg = gCtx.createImageData(targetSize, targetSize);
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
      width: targetSize,
      height: targetSize,
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
      return { x: cx, y: Math.max(0, y - 6) };
    }
  }

  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      if (isSolidAt(grid, x, y)) {
        return { x, y: Math.max(0, y - 6) };
      }
    }
  }

  return { x: cx, y: 10 };
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
