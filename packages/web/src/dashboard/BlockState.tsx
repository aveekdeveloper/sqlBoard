import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export function BlockLoading({ variant = 'chart' }: { variant?: 'chart' | 'metric' | 'table' | 'text' }) {
  if (variant === 'metric') {
    return (
      <div className="flex h-full flex-col justify-center gap-3 px-1">
        <div className="skeleton h-2.5 w-20" />
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-2 w-24" />
      </div>
    );
  }

  if (variant === 'text') {
    return (
      <div className="space-y-3 px-1 py-1">
        <div className="skeleton h-3.5 w-2/5" />
        <div className="skeleton h-2.5 w-full" />
        <div className="skeleton h-2.5 w-11/12" />
        <div className="skeleton h-2.5 w-3/4" />
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className="flex h-full flex-col gap-2 px-1 py-1">
        <div className="skeleton h-8 w-full" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton h-6 w-full opacity-80" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full items-end justify-center gap-2 px-4 pb-6">
      {[46, 72, 38, 58, 86, 52, 66, 44].map((height, index) => (
        <div
          key={index}
          className="skeleton w-full max-w-[42px] rounded-t-[4px]"
          style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  );
}

export function BlockError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-signal-soft text-signal">
        <AlertTriangle size={16} strokeWidth={1.8} />
      </div>
      <div className="text-[13px] font-medium text-ink">Could not load this block</div>
      <div className="max-h-16 overflow-auto text-[11.5px] leading-relaxed text-ink-muted">
        {message}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}

export function BlockEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f1eee7] text-ink-faint">
        <Inbox size={16} strokeWidth={1.7} />
      </div>
      <div className="text-[13px] font-medium text-ink-soft">{title}</div>
      {hint && <div className="max-w-[260px] text-[11.5px] leading-relaxed text-ink-faint">{hint}</div>}
    </div>
  );
}
