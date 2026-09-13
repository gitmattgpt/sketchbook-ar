/**
 * MindAR loader: loads MindAR script dynamically and manages compiler + tracker.
 * MindAR is loaded from CDN since it's a large library not available as npm package
 * that works well with Vite's bundling (it uses raw WebGL + Three.js internally).
 */

const MINDAR_CDN = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
const MINDAR_THREE_CDN = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

let mindarLoaded = false;
let mindarLoading: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureMindARLoaded(): Promise<void> {
  if (mindarLoaded) return;
  if (mindarLoading) return mindarLoading;

  mindarLoading = (async () => {
    await loadScript(MINDAR_CDN);
    await loadScript(MINDAR_THREE_CDN);
    mindarLoaded = true;
  })();

  return mindarLoading;
}

export interface MindARController {
  stop: () => Promise<void>;
  targetIndex: number;
}

/**
 * Compile an image into a MindAR target file and start tracking.
 * Returns a controller that can be stopped.
 */
export async function startTrackingWithImage(
  videoElement: HTMLVideoElement,
  targetImage: string | HTMLImageElement,
  onTargetFound: () => void,
  onTargetLost: () => void,
  onTargetUpdate: (matrix: number[]) => void
): Promise<MindARController> {
  await ensureMindARLoaded();

  const MindAR = (window as any).MINDAR;
  if (!MindAR || !MindAR.Image) {
    throw new Error('MindAR not available after loading');
  }

  const compiler = new MindAR.Image.Compiler();
  await compiler.compileImage(targetImage);
  const target = compiler.getData();

  const tracker = new MindAR.Image.Tracker(videoElement);
  await tracker.addTarget(target);

  const targetIndex = 0;

  tracker.addEventListener('targetFound', () => onTargetFound());
  tracker.addEventListener('targetLost', () => onTargetLost());
  tracker.addEventListener('targetUpdate', (evt: any) => {
    if (evt.detail && evt.detail.matrix) {
      onTargetUpdate(evt.detail.matrix as number[]);
    }
  });

  await tracker.start();

  return {
    stop: async () => {
      tracker.removeEventListener('targetFound', onTargetFound);
      tracker.removeEventListener('targetLost', onTargetLost);
      tracker.removeEventListener('targetUpdate', onTargetUpdate);
      await tracker.stop();
    },
    targetIndex,
  };
}

/**
 * Low-pass filter for smooth interpolation of tracking coordinates.
 * Reduces camera jitter on mobile devices.
 */
export class LowPassFilter {
  private smoothed: number | null = null;
  private alpha: number;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }

  filter(value: number): number {
    if (this.smoothed === null) {
      this.smoothed = value;
    } else {
      this.smoothed = this.smoothed + this.alpha * (value - this.smoothed);
    }
    return this.smoothed;
  }

  reset() {
    this.smoothed = null;
  }

  setAlpha(alpha: number) {
    this.alpha = alpha;
  }
}

export interface SmoothedTracking {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  visible: boolean;
}

export class TrackingSmoother {
  private xFilter = new LowPassFilter(0.25);
  private yFilter = new LowPassFilter(0.25);
  private scaleFilter = new LowPassFilter(0.2);
  private rotFilter = new LowPassFilter(0.3);
  private lastUpdate = 0;
  private visibleTimeout: number | null = null;

  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
    this.scaleFilter.reset();
    this.rotFilter.reset();
  }

  update(visible: boolean, x: number, y: number, scale: number, rotation: number): SmoothedTracking {
    const now = performance.now();
    if (visible) {
      this.visibleTimeout = now + 500;
    }

    const stillVisible = now < (this.visibleTimeout ?? 0);

    return {
      x: this.xFilter.filter(x),
      y: this.yFilter.filter(y),
      scale: this.scaleFilter.filter(scale),
      rotation: this.rotFilter.filter(rotation),
      visible: stillVisible,
    };
  }
}
