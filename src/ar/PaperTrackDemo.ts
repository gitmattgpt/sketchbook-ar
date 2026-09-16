/**
 * AR track-test demo.
 *
 * IMPORTANT: The tracker is compiled from the ORIGINAL camera capture
 * (full-color letter photo, typically 792×1024), NEVER from the
 * thresholded / pixel-expanded collision grid (198×256).
 *
 * Resolution notes:
 * - Capture source: CAPTURE_WIDTH × CAPTURE_HEIGHT (792 × 1024)
 * - Game collision grid: GRID 198 × 256 (separate pipeline only)
 * - For compile speed we may downscale the ORIGINAL photo so the
 *   longest edge is ≤ TRACK_MAX_EDGE while keeping aspect and color.
 */

import * as THREE from 'three';

// MindAR ships without perfect TS types for all entry points
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error mind-ar has no bundled types for this path
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error mind-ar compiler entry
import { Compiler } from 'mind-ar/dist/mindar-image.prod.js';

/** Max edge length used when compiling (still from original photo, not grid). */
export const TRACK_MAX_EDGE = 640;

export type TrackStatus = 'idle' | 'compiling' | 'searching' | 'found' | 'lost' | 'error';

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load capture image for tracking'));
    img.src = dataUrl;
  });
}

/**
 * Resize ORIGINAL capture for compile only — never use processed grid.
 * Preserves aspect ratio and full color information from the photo.
 */
function prepareTrackImage(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, TRACK_MAX_EDGE / Math.max(w, h));
  const outW = Math.max(32, Math.round(w * scale));
  const outH = Math.max(32, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, outW, outH);
  return canvas;
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Track image encode failed'));
    img.src = canvas.toDataURL('image/jpeg', 0.92);
  });
}

export class PaperTrackDemo {
  private container: HTMLElement | null = null;
  private mindarThree: InstanceType<typeof MindARThree> | null = null;
  private cube: THREE.Mesh | null = null;
  private anchorGroup: THREE.Group | null = null;
  private raf = 0;
  private mindBlobUrl: string | null = null;
  private running = false;
  private targetVisible = false;
  private onStatus: ((s: TrackStatus, detail?: string) => void) | null = null;

  setStatusHandler(cb: (s: TrackStatus, detail?: string) => void) {
    this.onStatus = cb;
  }

  private status(s: TrackStatus, detail?: string) {
    this.onStatus?.(s, detail);
  }

  /**
   * Compile tracker features from the ORIGINAL capture data URL
   * (jpeg from camera crop — not threshold/grid).
   */
  async compileFromOriginalCapture(originalCaptureDataUrl: string): Promise<ArrayBuffer> {
    this.status('compiling', 'Building tracker from original photo…');
    const full = await loadImageFromDataUrl(originalCaptureDataUrl);
    const prepared = prepareTrackImage(full);
    const trackImg = await canvasToImage(prepared);

    const compiler = new Compiler();
    await compiler.compileImageTargets([trackImg], (progress: number) => {
      this.status('compiling', `Compiling tracker ${Math.round(progress)}%`);
    });
    const buffer: ArrayBuffer = await compiler.exportData();
    return buffer;
  }

  async start(container: HTMLElement, originalCaptureDataUrl: string): Promise<void> {
    await this.stop();
    this.container = container;
    this.running = true;

    try {
      const buffer = await this.compileFromOriginalCapture(originalCaptureDataUrl);
      if (!this.running) return;

      const blob = new Blob([buffer]);
      this.mindBlobUrl = URL.createObjectURL(blob);

      this.mindarThree = new MindARThree({
        container,
        imageTargetSrc: this.mindBlobUrl,
        filterMinCF: 0.001,
        filterBeta: 1000,
      });

      const anchor = this.mindarThree.addAnchor(0);
      this.anchorGroup = anchor.group;

      // Cube: clear faces so axis is obvious; spins on Y (vertical)
      const geometry = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const materials = [
        new THREE.MeshBasicMaterial({ color: 0xe74c3c }), // +X red
        new THREE.MeshBasicMaterial({ color: 0xc0392b }), // -X
        new THREE.MeshBasicMaterial({ color: 0x2ecc71 }), // +Y green (up)
        new THREE.MeshBasicMaterial({ color: 0x27ae60 }), // -Y
        new THREE.MeshBasicMaterial({ color: 0x3498db }), // +Z blue
        new THREE.MeshBasicMaterial({ color: 0x2980b9 }), // -Z
      ];
      this.cube = new THREE.Mesh(geometry, materials);
      this.cube.position.set(0, 0.2, 0); // slightly above paper plane
      this.cube.visible = false;
      anchor.group.add(this.cube);

      anchor.onTargetFound = () => {
        this.targetVisible = true;
        if (this.cube) this.cube.visible = true;
        this.status('found');
      };
      anchor.onTargetLost = () => {
        this.targetVisible = false;
        if (this.cube) this.cube.visible = false;
        this.status('lost');
      };

      this.status('searching', 'Point camera at the same paper drawing');
      await this.mindarThree.start();

      const { renderer, scene, camera } = this.mindarThree;
      const tick = () => {
        if (!this.running) return;
        this.raf = requestAnimationFrame(tick);
        if (this.cube && this.cube.visible) {
          this.cube.rotation.y += 0.03; // continuous Y-axis spin
        }
        renderer.render(scene, camera);
      };
      tick();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AR start failed';
      this.status('error', msg);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.targetVisible = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    try {
      await this.mindarThree?.stop();
    } catch {
      /* ignore */
    }
    this.mindarThree = null;
    this.cube = null;
    this.anchorGroup = null;
    if (this.mindBlobUrl) {
      URL.revokeObjectURL(this.mindBlobUrl);
      this.mindBlobUrl = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.status('idle');
  }

  isFound(): boolean {
    return this.targetVisible;
  }
}
