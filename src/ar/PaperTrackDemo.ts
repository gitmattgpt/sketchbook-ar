/**
 * AR track-test demo.
 *
 * Tracker source = ORIGINAL camera capture (full-color ~792x1024), NEVER the
 * thresholded / expanded collision grid (198x256).
 */

import * as THREE from 'three';

export const TRACK_MAX_EDGE = 640;

/** Minimum matching feature points for a "usable" target (heuristic). */
const MIN_FEATURES_OK = 80;
const MIN_FEATURES_WEAK = 30;

export type TrackStatus =
  | 'idle'
  | 'loading'
  | 'compiling'
  | 'searching'
  | 'found'
  | 'lost'
  | 'weak_target'
  | 'error';

export interface TrackQuality {
  featureCount: number;
  level: 'good' | 'weak' | 'poor';
  message: string;
  tips: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMind = any;

let mindModules: { MindARThree: AnyMind; Compiler: AnyMind } | null = null;

function countFeatures(data: AnyMind): number {
  try {
    const td = data?.trackingData;
    if (Array.isArray(td) && td[0]?.points) return td[0].points.length;
    if (td?.points) return td.points.length;
    const md = data?.matchingData;
    const m0 = Array.isArray(md) ? md[0] : md;
    if (m0) {
      const max = m0.maximaPoints?.length ?? 0;
      const min = m0.minimaPoints?.length ?? 0;
      return max + min;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function rateQuality(featureCount: number): TrackQuality {
  if (featureCount >= MIN_FEATURES_OK) {
    return {
      featureCount,
      level: 'good',
      message: `Good target (${featureCount} features)`,
      tips: ['Point the camera at the same paper.', 'Keep the full page in view.'],
    };
  }
  if (featureCount >= MIN_FEATURES_WEAK) {
    return {
      featureCount,
      level: 'weak',
      message: `Weak target (${featureCount} features) — tracking may fail`,
      tips: [
        'Add more dark ink / detail on the page',
        'Draw X marks or shapes near the corners',
        'Avoid large blank areas',
        'Or print a high-contrast picture and capture that',
      ],
    };
  }
  return {
    featureCount,
    level: 'poor',
    message: `Not enough detail (${featureCount} features) for tracking`,
    tips: [
      'This photo is too plain for the tracker',
      'Draw denser lines, patterns, or X in each corner',
      'Retake a sharper, well-lit photo of the page',
      'Or use a printed image with lots of contrast',
    ],
  };
}

async function loadMindAR(): Promise<{ MindARThree: AnyMind; Compiler: AnyMind }> {
  if (mindModules) return mindModules;

  // MindAR's Three build expects THREE on window in some builds
  (window as unknown as { THREE: typeof THREE }).THREE = THREE;

  try {
    const threeMod = await import(
      /* @vite-ignore */
      'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.esm.js'
    );
    const imageMod = await import(
      /* @vite-ignore */
      'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.esm.js'
    );

    const MindARThree =
      threeMod.MindARThree ?? threeMod.default?.MindARThree ?? threeMod.default;
    const Compiler =
      imageMod.Compiler ?? imageMod.default?.Compiler ?? imageMod.default;

    if (!MindARThree || !Compiler) {
      throw new Error('MindAR exports missing (CDN load incomplete)');
    }
    mindModules = { MindARThree, Compiler };
    return mindModules;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`MindAR failed to load: ${msg}`);
  }
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
  private lastQuality: TrackQuality | null = null;
  private onStatus: ((s: TrackStatus, detail?: string, quality?: TrackQuality | null) => void) | null =
    null;

  setStatusHandler(
    cb: (s: TrackStatus, detail?: string, quality?: TrackQuality | null) => void
  ) {
    this.onStatus = cb;
  }

  private status(s: TrackStatus, detail?: string, quality?: TrackQuality | null) {
    this.onStatus?.(s, detail, quality ?? this.lastQuality);
  }

  getLastQuality(): TrackQuality | null {
    return this.lastQuality;
  }

  async compileFromOriginalCapture(originalCaptureDataUrl: string): Promise<ArrayBuffer> {
    this.status('compiling', 'Building tracker from original photo...');
    const { Compiler } = await loadMindAR();
    const full = await loadImageFromDataUrl(originalCaptureDataUrl);
    const prepared = prepareTrackImage(full);
    const trackImg = await canvasToImage(prepared);

    const compiler = new Compiler();
    const dataList = await compiler.compileImageTargets([trackImg], (progress: number) => {
      this.status('compiling', `Compiling tracker ${Math.round(progress)}%`);
    });

    const first = Array.isArray(dataList) ? dataList[0] : dataList;
    const featureCount = countFeatures(first);
    this.lastQuality = rateQuality(featureCount);

    if (this.lastQuality.level === 'poor') {
      this.status('weak_target', this.lastQuality.message, this.lastQuality);
    } else if (this.lastQuality.level === 'weak') {
      this.status('weak_target', this.lastQuality.message, this.lastQuality);
    } else {
      this.status('compiling', this.lastQuality.message, this.lastQuality);
    }

    const buffer: ArrayBuffer = await compiler.exportData();
    return buffer;
  }

  async start(container: HTMLElement, originalCaptureDataUrl: string): Promise<void> {
    await this.stop();
    this.container = container;
    this.running = true;
    this.lastQuality = null;

    try {
      this.status('loading', 'Loading AR engine...');
      const { MindARThree } = await loadMindAR();
      if (!this.running) return;

      const buffer = await this.compileFromOriginalCapture(originalCaptureDataUrl);
      if (!this.running) return;

      // Still start tracking even on weak targets so user can try;
      // poor targets get a strong warning but we attempt anyway.
      const blob = new Blob([buffer]);
      this.mindBlobUrl = URL.createObjectURL(blob);

      this.mindarThree = new MindARThree({
        container,
        imageTargetSrc: this.mindBlobUrl,
        filterMinCF: 0.001,
        filterBeta: 1000,
        warmupTolerance: 3,
        missTolerance: 5,
      });

      const anchor = this.mindarThree.addAnchor(0);

      const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const materials = [
        new THREE.MeshBasicMaterial({ color: 0xe74c3c }),
        new THREE.MeshBasicMaterial({ color: 0xc0392b }),
        new THREE.MeshBasicMaterial({ color: 0x2ecc71 }),
        new THREE.MeshBasicMaterial({ color: 0x27ae60 }),
        new THREE.MeshBasicMaterial({ color: 0x3498db }),
        new THREE.MeshBasicMaterial({ color: 0x2980b9 }),
      ];
      this.cube = new THREE.Mesh(geometry, materials);
      this.cube.position.set(0, 0.25, 0);
      this.cube.visible = false;
      anchor.group.add(this.cube);

      // Helper ring on the paper plane so "found" is obvious even if cube is hard to see
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.42, 32),
        new THREE.MeshBasicMaterial({
          color: 0x2ecc71,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      anchor.group.add(ring);

      anchor.onTargetFound = () => {
        this.targetVisible = true;
        if (this.cube) this.cube.visible = true;
        ring.visible = true;
        this.status('found', 'Paper found — cube should be on the page', this.lastQuality);
      };
      anchor.onTargetLost = () => {
        this.targetVisible = false;
        if (this.cube) this.cube.visible = false;
        ring.visible = false;
        this.status('lost', 'Paper lost — point camera at the drawing again', this.lastQuality);
      };

      const searchMsg =
        this.lastQuality?.level === 'poor'
          ? 'Searching (target looks too plain — may never lock)'
          : this.lastQuality?.level === 'weak'
            ? 'Searching (weak target — hold steady on the page)'
            : 'Point camera at the same paper drawing';

      this.status('searching', searchMsg, this.lastQuality);
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
      this.status('error', msg, this.lastQuality);
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
