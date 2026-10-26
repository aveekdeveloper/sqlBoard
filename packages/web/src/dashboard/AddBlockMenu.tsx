import { useEffect, useRef, useState } from 'react';
import { BarChart3, Gauge, Plus, Table2, Type as TypeIcon } from 'lucide-react';
import { BLOCK_META, BLOCK_TYPES, type DashboardBlockType } from './model.js';

const ICONS = {
  chart: BarChart3,
  metric: Gauge,
  table: Table2,
  text: TypeIcon,
} as const;

export default function AddBlockMenu({
  onSelect,
  disabled,
}: {
  onSelect: (type: DashboardBlockType) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-ink px-2.5 text-[11px] font-medium text-surface transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} strokeWidth={2.2} />
        Add block
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-[286px] rounded-lg border border-line bg-surface p-1.5 shadow-lift">
          <div className="px-2 pb-1.5 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Block type
          </div>
          {BLOCK_TYPES.map((type) => {
            const Icon = ICONS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSelect(type);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[#f4f1ea]"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#f1eee7] text-ink-soft">
                  <Icon size={13} strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-ink">
                    {BLOCK_META[type].label}
                  </span>
                  <span className="block text-[10px] leading-snug text-ink-faint">
                    {BLOCK_META[type].description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
