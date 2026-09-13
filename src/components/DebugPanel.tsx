import { Gauge, Crosshair, Grid3x3, Activity, Sliders } from 'lucide-react';
import type { DebugInfo } from '@/types';

interface DebugPanelProps {
  info: DebugInfo;
  onThresholdChange: (value: number) => void;
  threshold: number;
}

export function DebugPanel({ info, onThresholdChange, threshold }: DebugPanelProps) {
  const stateColor = {
    idle: 'text-ink-400',
    searching: 'text-amber-600',
    tracking: 'text-green-600',
    lost: 'text-red-600',
  }[info.trackingState];

  return (
    <div className="bg-paper-300/60 backdrop-blur-sm border-2 border-ink-800/20 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2 text-ink-800">
        <Gauge size={16} />
        <h3 className="font-hand font-bold text-sm">Debug Info</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-hand">
        <Stat icon={Activity} label="FPS" value={info.fps.toFixed(0)} />
        <Stat icon={Crosshair} label="Track" value={info.trackingState} valueClass={stateColor} />
        <Stat icon={Grid3x3} label="Grid" value={info.gridResolution} />
        <Stat icon={Sliders} label="Pixels" value={info.solidPixels.toString()} />
      </div>

      {info.characterPos && (
        <div className="text-xs font-hand text-ink-600">
          Character: ({info.characterPos.x.toFixed(0)}, {info.characterPos.y.toFixed(0)})
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-hand font-bold text-ink-700">
            Threshold
          </label>
          <span className="text-xs font-hand text-ink-600 tabular-nums">
            {threshold}
          </span>
        </div>
        <input
          type="range"
          min={20}
          max={200}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-[10px] font-hand text-ink-500 leading-tight">
          Lower = more collision pixels. Higher = only darkest strokes.
        </p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, valueClass = '' }: {
  icon: typeof Gauge;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-paper-100/70 rounded px-2 py-1.5">
      <Icon size={12} className="text-ink-500 shrink-0" />
      <span className="text-ink-500">{label}</span>
      <span className={`ml-auto font-bold tabular-nums ${valueClass || 'text-ink-800'}`}>
        {value}
      </span>
    </div>
  );
}
