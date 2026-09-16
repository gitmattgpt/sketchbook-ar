import { Camera, Settings2, Brush } from 'lucide-react';
import type { TabId } from '@/types';

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: typeof Camera }[] = [
  { id: 'play', label: 'AR Play', icon: Camera },
  { id: 'setup', label: 'Level Setup', icon: Settings2 },
  { id: 'animator', label: 'Animator', icon: Brush },
];

export function TabNav({ activeTab, onTabChange }: TabNavProps) {
  return (
    <nav className="flex items-center justify-around bg-paper-200 border-b-2 border-ink-800/20 safe-top px-1 py-1 shrink-0">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all duration-200 ${
              active
                ? 'bg-ink-800 text-paper-100'
                : 'text-ink-600 active:scale-95'
            }`}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
            <span className="text-xs font-hand font-bold tracking-wide">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
