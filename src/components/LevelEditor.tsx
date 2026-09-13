import { Trash2, Plus, Flag, AlertTriangle, Info } from 'lucide-react';
import type { Hazard, LevelConfig } from '@/types';

interface LevelEditorProps {
  config: LevelConfig;
  onConfigChange: (config: LevelConfig) => void;
  gridPreview: string | null;
}

const HAZARD_TYPES: { type: Hazard['type']; label: string; color: string }[] = [
  { type: 'spike', label: 'Spikes', color: '#c0392b' },
  { type: 'pit', label: 'Pit', color: '#2c3e50' },
  { type: 'lava', label: 'Lava', color: '#e67e22' },
];

export function LevelEditor({ config, onConfigChange, gridPreview }: LevelEditorProps) {
  const addHazard = (type: Hazard['type']) => {
    const newHazard: Hazard = {
      id: `hazard-${Date.now()}`,
      x: 64,
      y: 64,
      width: 12,
      height: 4,
      type,
    };
    onConfigChange({ ...config, hazards: [...config.hazards, newHazard] });
  };

  const removeHazard = (id: string) => {
    onConfigChange({ ...config, hazards: config.hazards.filter((h) => h.id !== id) });
  };

  const setGoal = () => {
    onConfigChange({ ...config, goal: config.goal ? null : { x: 100, y: 40 } });
  };

  return (
    <div className="flex flex-col h-full paper-bg overflow-y-auto no-scrollbar">
      <div className="max-w-md mx-auto w-full px-5 py-6 space-y-6">
        <header className="space-y-1">
          <h2 className="text-2xl font-script font-bold text-ink-800">Level Setup</h2>
          <p className="text-sm font-hand text-ink-500">
            Place hazards and goals on your paper world. These will appear when playing in AR.
          </p>
        </header>

        {gridPreview && (
          <section className="space-y-2">
            <h3 className="font-hand font-bold text-ink-700 text-sm flex items-center gap-2">
              <Info size={14} /> Current Level Preview
            </h3>
            <div className="relative bg-paper-100 border-2 border-ink-800/20 rounded-lg overflow-hidden">
              <img src={gridPreview} alt="Level grid preview" className="w-full block" />
              {config.goal && (
                <div
                  className="absolute w-4 h-4 border-2 border-green-700 bg-green-500/40 rounded-sm"
                  style={{
                    left: `${(config.goal.x / 128) * 100}%`,
                    top: `${(config.goal.y / 128) * 100}%`,
                  }}
                />
              )}
              {config.hazards.map((h) => (
                <div
                  key={h.id}
                  className="absolute border-2 rounded-sm"
                  style={{
                    left: `${((h.x - h.width / 2) / 128) * 100}%`,
                    top: `${((h.y - h.height / 2) / 128) * 100}%`,
                    width: `${(h.width / 128) * 100}%`,
                    height: `${(h.height / 128) * 100}%`,
                    backgroundColor: HAZARD_TYPES.find((t) => t.type === h.type)?.color + '40',
                    borderColor: HAZARD_TYPES.find((t) => t.type === h.type)?.color,
                  }}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="font-hand font-bold text-ink-700 text-sm">Hazards</h3>
          <div className="grid grid-cols-3 gap-2">
            {HAZARD_TYPES.map(({ type, label, color }) => (
              <button
                key={type}
                onClick={() => addHazard(type)}
                className="flex flex-col items-center gap-1.5 p-3 border-2 border-ink-800/20 rounded-lg active:bg-paper-200 transition-colors"
              >
                <AlertTriangle size={20} style={{ color }} />
                <span className="text-xs font-hand font-bold text-ink-700">{label}</span>
              </button>
            ))}
          </div>

          {config.hazards.length > 0 && (
            <div className="space-y-2">
              {config.hazards.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 bg-paper-200/60 border border-ink-800/15 rounded-lg p-2.5"
                >
                  <div
                    className="w-5 h-5 rounded shrink-0"
                    style={{ backgroundColor: HAZARD_TYPES.find((t) => t.type === h.type)?.color }}
                  />
                  <span className="text-sm font-hand text-ink-700 capitalize">{h.type}</span>
                  <span className="text-xs font-hand text-ink-400 ml-auto tabular-nums">
                    ({h.x}, {h.y})
                  </span>
                  <button
                    onClick={() => removeHazard(h.id)}
                    className="text-red-500 active:scale-90 transition-transform"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-hand font-bold text-ink-700 text-sm">Goal</h3>
          <button
            onClick={setGoal}
            className={`w-full flex items-center justify-center gap-2 p-3 border-2 rounded-lg transition-colors ${
              config.goal
                ? 'border-green-700 bg-green-500/15 text-green-800'
                : 'border-ink-800/20 text-ink-600'
            }`}
          >
            <Flag size={18} />
            <span className="font-hand font-bold text-sm">
              {config.goal ? 'Goal set — tap to remove' : 'Set goal position'}
            </span>
          </button>
        </section>

        <div className="border-t-2 border-dashed border-ink-800/15 pt-4">
          <p className="text-xs font-hand text-ink-500 leading-relaxed">
            Phase 2 will add draggable hazard placement directly on the live AR feed,
            moving zones with physics, and win/lose conditions.
          </p>
        </div>
      </div>
    </div>
  );
}
