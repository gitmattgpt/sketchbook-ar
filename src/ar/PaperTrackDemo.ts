/**
 * AR track-test demo.
 *
 * Tracker source = ORIGINAL camera capture (full-color ~792x1024), NEVER the
 * thresholded / expanded collision grid (198x256).
 */

import * as THREE from 'three';

export const TRACK_MAX_EDGE = 640;

export type TrackStatus = 'idle' | 'compiling' | 'searching' | 'found' | 'lost' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMind = any;

let mindModules: { MindARThree: AnyMind; Compiler: AnyMind } | null = null;

async function loadMindAR(): Promise<{ MindARThree: AnyMind; Compiler: AnyMind }> {
  if (mindModules) return mindModules;

  // Prefer ESM builds from jsDelivr (avoids npm install / node-gyp issues)
  const threeMod = await import(
    /* @vite-ignore */
    'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.esm.js'
  );
  const imageMod = await import(
    /* @vite-ignore */
    'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.esm.js'
  );

  const MindARThree = threeMod.MindARThree ?? threeMod.default?.MindARThree ?? threeMod.default;
  const Compiler = imageMod.Compiler ?? imageMod.default?.Compiler ?? imageMod.default;

  if (!MindARThree || !Compiler) {
    throw new Error('MindAR modules failed to load from CDN');
  }
  mindModules = { MindARThree, Compiler };
  return mindModules;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load capture image for tracking'));
    img.src = dataUrl;
  });
}

/** Resize ORIGINAL photo only (still full color, not grid). */
function prepareTrackImage(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, TRACK_MAX_EDGE / Math.max(w, h));
  const outW = Math.max(32, Math.round(w * scale));
  const outH = Math.max(32, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  canvas.getContext('2d')!.drawImage(img, 0, 0, outW, outH);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mindarThree: any = null;
  private cube: THREE.Mesh | null = null;
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

  async compileFromOriginalCapture(originalCaptureDataUrl: string): Promise<ArrayBuffer> {
    this.status('compiling', 'Building tracker from original photo...');
    const { Compiler } = await loadMindAR();
    const full = await loadImageFromDataUrl(originalCaptureDataUrl);
    const prepared = prepareTrackImage(full);
    const trackImg = await canvasToImage(prepared);

    const compiler = new Compiler();
    await compiler.compileImageTargets([trackImg], (progress: number) => {
      this.status('compiling', `Compiling tracker ${Math.round(progress)}%`);
    });
    return await compiler.exportData();
  }

  async start(container: HTMLElement, originalCaptureDataUrl: string): Promise<void> {
    await this.stop();
    this.container = container;
    this.running = true;

    try {
      const { MindARThree } = await loadMindAR();
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

      const geometry = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const materials = [
        new THREE.MeshBasicMaterial({ color: 0xe74c3c }),
        new THREE.MeshBasicMaterial({ color: 0xc0392b }),
        new THREE.MeshBasicMaterial({ color: 0x2ecc71 }), // +Y up (green)
        new THREE.MeshBasicMaterial({ color: 0x27ae60 }),
        new THREE.MeshBasicMaterial({ color: 0x3498db }),
        new THREE.MeshBasicMaterial({ color: 0x2980b9 }),
      ];
      this.cube = new THREE.Mesh(geometry, materials);
      this.cube.position.set(0, 0.2, 0);
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
        if (this.cube?.visible) this.cube.rotation.y += 0.03;
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
      await this.mindarThree?.stop?.();
    } catch {
      /* ignore */
    }
    this.mindarThree = null;
    this.cube = null;
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
