import { useState, useCallback, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { TabNav } from '@/components/TabNav';
import { CameraARView } from '@/components/CameraARView';
import { LevelEditor } from '@/components/LevelEditor';
import { SpriteAnimator } from '@/components/SpriteAnimator';
import { DebugPanel } from '@/components/DebugPanel';
import type { TabId, DebugInfo, CollisionGrid, LevelConfig } from '@/types';

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
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('play');
  const [threshold, setThreshold] = useState(120);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(DEFAULT_DEBUG);
  const [grid, setGrid] = useState<CollisionGrid | null>(null);
  const [gridPreviewUrl, setGridPreviewUrl] = useState<string | null>(null);
  const [levelConfig, setLevelConfig] = useState<LevelConfig>(DEFAULT_LEVEL);
  const [showIntro, setShowIntro] = useState(true);

  const handleDebugUpdate = useCallback((partial: Partial<DebugInfo>) => {
    setDebugInfo((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleGridReady = useCallback((newGrid: CollisionGrid | null, previewUrl: string | null) => {
    setGrid(newGrid);
    setGridPreviewUrl(previewUrl);
  }, []);

  const handleThresholdChange = useCallback((value: number) => {
    setThreshold(value);
    setLevelConfig((prev) => ({ ...prev, threshold: value }));
    handleDebugUpdate({ threshold: value });
  }, [handleDebugUpdate]);

  useEffect(() => {
    if (grid) {
      handleDebugUpdate({ trackingState: 'tracking' });
    }
  }, [grid, handleDebugUpdate]);

  return (
    <div className="fixed inset-0 flex flex-col bg-paper-100 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 bg-paper-200 border-b-2 border-ink-800/15 safe-top">
        <div className="flex items-center gap-2">
          <BookOpen size={22} className="text-ink-800" strokeWidth={2.5} />
          <div>
            <h1 className="text-lg font-script font-bold text-ink-800 leading-none">Sketchbook AR</h1>
            <p className="text-[10px] font-hand text-ink-500 leading-none mt-0.5">Paper Worlds</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-hand text-ink-500">Phase 1</span>
          <div className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse-soft" />
        </div>
      </header>

      {showIntro && (
        <IntroOverlay onClose={() => setShowIntro(false)} />
      )}

      <main className="flex-1 relative overflow-hidden">
        {activeTab === 'play' && (
          <div className="absolute inset-0 flex">
            <div className="flex-1 relative">
              <CameraARView
                threshold={threshold}
                levelConfig={levelConfig}
                onDebugUpdate={handleDebugUpdate}
                onGridReady={handleGridReady}
              />
            </div>
            <div className="w-72 hidden lg:block overflow-y-auto no-scrollbar p-3 paper-bg-margin">
              <DebugPanel
                info={debugInfo}
                threshold={threshold}
                onThresholdChange={handleThresholdChange}
              />
              <div className="mt-3 p-3 bg-paper-300/60 border-2 border-ink-800/20 rounded-lg">
                <h4 className="font-hand font-bold text-sm text-ink-800 mb-1">How to Play</h4>
                <ol className="text-xs font-hand text-ink-600 space-y-1 list-decimal list-inside">
                  <li>Draw lines on paper with dark pencil/marker</li>
                  <li>Point camera at paper & tap "Capture Paper"</li>
                  <li>Adjust threshold to isolate your ink strokes</li>
                  <li>Tap screen sides to walk, center to jump</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <LevelEditor
            config={levelConfig}
            onConfigChange={setLevelConfig}
            gridPreview={gridPreviewUrl}
          />
        )}

        {activeTab === 'animator' && (
          <SpriteAnimator />
        )}
      </main>

      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
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
            <li>Capture & adjust the threshold slider</li>
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
