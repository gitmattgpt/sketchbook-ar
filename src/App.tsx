import { useState, useCallback, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { TabNav } from '@/components/TabNav';
import { CameraARView } from '@/components/CameraARView';
import { LevelEditor } from '@/components/LevelEditor';
import { SpriteAnimator } from '@/components/SpriteAnimator';
import { DebugPanel } from '@/components/DebugPanel';
import type { TabId, DebugInfo, CollisionGrid, LevelConfig } from '@/types';

const STORAGE_KEY = 'sketchbook-ar-session-v1';

const DEFAULT_DEBUG: DebugInfo = {
  fps: 0,
  trackingState: 'idle',
  gridResolution: '—',
  solidPixels: 0,
  characterPos: null,
  threshold: 120,
};

const DEFAULT_LEVEL: LevelConfig = {
  threshold: 120,
  hazards: [],
  goal: null,
  spawn: null,
};

interface SavedSession {
  captureDataUrl: string | null;
  threshold: number;
  levelConfig: LevelConfig;
  gridPreviewUrl: string | null;
}

function loadSession(): Partial<SavedSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SavedSession;
  } catch {
    return {};
  }
}

function saveSession(data: SavedSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota or private mode — ignore
  }
}

export default function App() {
  const saved = loadSession();

  const [activeTab, setActiveTab] = useState<TabId>('play');
  const [threshold, setThreshold] = useState(saved.threshold ?? 120);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    ...DEFAULT_DEBUG,
    threshold: saved.threshold ?? 120,
  });
  const [grid, setGrid] = useState<CollisionGrid | null>(null);
  const [gridPreviewUrl, setGridPreviewUrl] = useState<string | null>(saved.gridPreviewUrl ?? null);
  const [levelConfig, setLevelConfig] = useState<LevelConfig>({
    ...DEFAULT_LEVEL,
    ...(saved.levelConfig ?? {}),
    spawn: saved.levelConfig?.spawn ?? null,
    goal: saved.levelConfig?.goal ?? null,
  });
  const [captureDataUrl, setCaptureDataUrl] = useState<string | null>(saved.captureDataUrl ?? null);
  const [showIntro, setShowIntro] = useState(!saved.captureDataUrl);

  const handleDebugUpdate = useCallback((partial: Partial<DebugInfo>) => {
    setDebugInfo((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleGridReady = useCallback(
    (newGrid: CollisionGrid | null, previewUrl: string | null, captureUrl?: string | null) => {
      setGrid(newGrid);
      setGridPreviewUrl(previewUrl);

      if (captureUrl !== undefined) {
        setCaptureDataUrl(captureUrl);
      }

      const nextCapture = captureUrl !== undefined ? captureUrl : captureDataUrl;
      if (nextCapture || previewUrl) {
        saveSession({
          captureDataUrl: nextCapture,
          threshold,
          levelConfig,
          gridPreviewUrl: previewUrl,
        });
      } else if (newGrid === null) {
        saveSession({
          captureDataUrl: null,
          threshold,
          levelConfig,
          gridPreviewUrl: null,
        });
        setCaptureDataUrl(null);
      }
    },
    [captureDataUrl, threshold, levelConfig]
  );

  const handleThresholdChange = useCallback(
    (value: number) => {
      setThreshold(value);
      setLevelConfig((prev) => {
        const next = { ...prev, threshold: value };
        saveSession({
          captureDataUrl,
          threshold: value,
          levelConfig: next,
          gridPreviewUrl,
        });
        return next;
      });
      handleDebugUpdate({ threshold: value });
    },
    [handleDebugUpdate, captureDataUrl, gridPreviewUrl]
  );

  const handleLevelConfigChange = useCallback(
    (config: LevelConfig) => {
      setLevelConfig(config);
      saveSession({
        captureDataUrl,
        threshold,
        levelConfig: config,
        gridPreviewUrl,
      });
    },
    [captureDataUrl, threshold, gridPreviewUrl]
  );

  useEffect(() => {
    if (grid) {
      handleDebugUpdate({ trackingState: 'tracking' });
    }
  }, [grid, handleDebugUpdate]);

  return (
    <div className="fixed inset-0 flex flex-col bg-paper-100 overflow-hidden">
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />

      {showIntro && <IntroOverlay onClose={() => setShowIntro(false)} />}

      <main className="flex-1 relative overflow-hidden">
        <div className={`absolute inset-0 flex ${activeTab === 'play' ? '' : 'invisible pointer-events-none'}`} aria-hidden={activeTab !== 'play'}>
          <div className="flex-1 relative">
            <CameraARView
              threshold={threshold}
              levelConfig={levelConfig}
              onDebugUpdate={handleDebugUpdate}
              onGridReady={handleGridReady}
              onThresholdChange={handleThresholdChange}
              savedCaptureDataUrl={captureDataUrl}
            />
          </div>
          <div className="w-72 hidden lg:block overflow-y-auto no-scrollbar p-3 paper-bg-margin">
            <DebugPanel
              info={debugInfo}
              threshold={threshold}
              onThresholdChange={handleThresholdChange}
            />
          </div>
        </div>

        <div className={`absolute inset-0 ${activeTab === 'setup' ? '' : 'invisible pointer-events-none'}`} aria-hidden={activeTab !== 'setup'}>
          <LevelEditor
            config={levelConfig}
            onConfigChange={handleLevelConfigChange}
            gridPreview={gridPreviewUrl}
          />
        </div>

        <div className={`absolute inset-0 ${activeTab === 'animator' ? '' : 'invisible pointer-events-none'}`} aria-hidden={activeTab !== 'animator'}>
          <SpriteAnimator />
        </div>
      </main>

      {/* Empty bottom safe area — room for future on-screen buttons */}
      <div className="safe-bottom shrink-0 h-2 bg-transparent" />
    </div>
  );
}

function IntroOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-900/70 backdrop-blur-sm animate-fade-in">
      <div className="max-w-sm mx-4 paper-bg-margin rounded-2xl border-2 border-ink-800/30 p-6 space-y-4 animate-slide-up">
        <div className="flex items-center gap-2">
          <BookOpen size={28} className="text-ink-800" />
          <h2 className="text-2xl font-script font-bold text-ink-800">Sketchbook AR</h2>
        </div>
        <p className="text-sm font-hand text-ink-600 leading-relaxed">
          Draw a world on paper, then bring it to life in augmented reality.
          Your pencil strokes become solid ground for a stickman character to walk on.
        </p>
        <div className="space-y-2 text-xs font-hand text-ink-600">
          <p className="font-bold text-ink-800">Quick Start:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Draw dark lines on white paper</li>
            <li>Point your camera at the paper</li>
            <li>Capture & adjust threshold and line thickness</li>
            <li>Walk and jump on your hand-drawn world</li>
          </ol>
        </div>
        <p className="text-[10px] font-hand text-ink-500">
          Best experienced on iPhone Safari with camera permission enabled.
        </p>
        <button onClick={onClose} className="btn-sketch w-full text-sm">
          Let's Draw
        </button>
      </div>
    </div>
  );
}
