import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { Loader2 } from 'lucide-react';
import { Button, Dialog, Field, TextInput } from './ui.js';

function countChangedLines(base: string, current: string): { added: number; removed: number } {
  const parts = diffLines(base, current);
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const lines = part.value.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1).length;
    if (part.added) added += lines;
    if (part.removed) removed += lines;
  }
  return { added, removed };
}

export default function CommitDialog({
  open,
  onClose,
  onCommit,
  committing,
  dashboardName,
  baseCode,
  code,
  dirty,
  latestVersion,
}: {
  open: boolean;
  onClose: () => void;
  onCommit: (message: string) => void;
  committing: boolean;
  dashboardName: string;
  baseCode: string;
  code: string;
  dirty: boolean;
  latestVersion: number;
}) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setMessage(dirty ? `Update ${dashboardName}` : `Checkpoint ${dashboardName}`);
  }, [open, dirty, dashboardName]);

  const stats = useMemo(
    () => (open ? countChangedLines(baseCode, code) : { added: 0, removed: 0 }),
    [open, baseCode, code],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={dirty ? 'Commit changes' : 'Commit checkpoint'}
      description={
        dirty
          ? 'Writes the draft to the dashboard and records a manual version.'
          : 'Records the current dashboard state as a new manual version.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onCommit(message.trim() || 'Update dashboard')}
            disabled={committing || message.trim().length === 0}
          >
            {committing && <Loader2 size={12} className="animate-spin" />}
            {committing ? 'Committing…' : `Commit as v${latestVersion + 1}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Commit message">
          <TextInput
            autoFocus
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !committing && message.trim()) {
                onCommit(message.trim());
              }
            }}
            maxLength={200}
            placeholder="Describe what changed"
          />
        </Field>

        <div className="rounded-lg border border-line bg-[#fbf9f4] p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            <span>Working tree</span>
            <span className="tabular">v{latestVersion + 1}</span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[12px]">
            {dirty ? (
              <>
                <span className="inline-flex items-center gap-1 text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" />+{stats.added} lines
                </span>
                <span className="inline-flex items-center gap-1 text-signal">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal" />−{stats.removed} lines
                </span>
              </>
            ) : (
              <span className="text-ink-muted">
                No manifest changes. This will snapshot the current dashboard.
              </span>
            )}
          </div>
        </div>

        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          Layout drags are saved immediately and do not create versions. Content changes stay in the
          draft until you commit or apply.
        </p>
      </div>
    </Dialog>
  );
}
