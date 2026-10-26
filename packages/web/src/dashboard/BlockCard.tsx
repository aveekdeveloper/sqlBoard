import {
  BarChart3,
  Gauge,
  GripVertical,
  Pencil,
  Table2,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import type { DashboardBlockType, ManifestItem } from './model.js';
import { resolveConnectionName } from './model.js';
import BlockBody from './BlockBody.js';

const ICONS: Record<DashboardBlockType, typeof BarChart3> = {
  chart: BarChart3,
  metric: Gauge,
  table: Table2,
  text: TypeIcon,
};

const TYPE_LABEL: Record<DashboardBlockType, string> = {
  chart: 'Chart',
  metric: 'KPI',
  table: 'Table',
  text: 'Note',
};

export function BlockCard({
  item,
  editing,
  draggable,
  connections,
  onEdit,
  onDelete,
  bodyClassName = '',
}: {
  item: ManifestItem;
  editing: boolean;
  draggable?: boolean;
  connections: Array<{ id: number; name: string }>;
  onEdit?: () => void;
  onDelete?: () => void;
  bodyClassName?: string;
}) {
  const showHandle = draggable ?? editing;
  const Icon = ICONS[item.blockType];
  const meta =
    item.blockType === 'text'
      ? 'Markdown note'
      : resolveConnectionName(item.connectionId, connections);
  const contentPadding =
    bodyClassName ||
    (item.blockType === 'metric'
      ? 'px-4 pb-3'
      : item.blockType === 'text'
        ? 'px-4 pb-3'
        : 'px-2.5 pb-2.5');

  return (
    <div className={`dash-card ${editing ? 'is-editing' : ''}`}>
      <header className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-line/70 px-2.5">
        {showHandle && (
          <button
            type="button"
            className="block-drag-handle block-no-drag -ml-0.5 flex h-7 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-[#f1eee7] hover:text-ink-soft"
            title="Drag to move"
            aria-label={`Move ${item.title}`}
          >
            <GripVertical size={14} strokeWidth={1.8} />
          </button>
        )}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[#f1eee7] text-ink-soft">
          <Icon size={13} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-4 tracking-[-0.005em] text-ink">
            {item.title}
          </div>
          <div className="truncate text-[9.5px] leading-3 text-ink-faint">
            {TYPE_LABEL[item.blockType]} · {meta}
          </div>
        </div>
        {editing && (
          <div className="block-no-drag flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onEdit}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-[#f1eee7] hover:text-ink"
              title="Edit block"
              aria-label={`Edit ${item.title}`}
            >
              <Pencil size={13} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-signal-soft hover:text-signal"
              title="Delete block"
              aria-label={`Delete ${item.title}`}
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </header>
      <div className={`min-h-0 flex-1 ${contentPadding}`}>
        <BlockBody item={item} />
      </div>
    </div>
  );
}
